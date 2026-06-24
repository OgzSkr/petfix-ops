import { readDb } from '../../db/store.js';
import { readEnvFile } from '../../env.js';
import { paths, resolveRuntimeConfig } from '../../config.js';
import { HZLMRKTOPS_BUYBOX_CHANNEL_IDS } from '../../hzlmrktops/constants.js';
import {
  packageFromGetirOpsRow,
  packageFromUberOpsRow,
  packageFromYemeksepetiOpsRow
} from '../../channels/ops-orders-bridge.js';
import {
  analyzeOrderPackages,
  buildOrderStats,
  orderDateTimezoneForChannel,
  resolveRealUtcOrderDateRange
} from '../../order-profitability.js';
import { costScopeForChannel } from '../../cost-scopes.js';
import { profitAnalysisSettingsForChannel } from '../../profit-constants.js';
import { resolveMatchingModeForChannel } from '../../product-matching/resolve.js';
import {
  computeProfitConfidence,
  summarizeProfitConfidence,
  isProfitKpiIncluded,
  labelProfitConfidence
} from '../../production/profit-confidence.js';
import { getChannel } from '../../channels/registry.js';

export function buildProfitFootnote(summary = {}) {
  const counts = summary.counts || {};
  const parts = [];

  if (counts.missing_cost) {
    parts.push(`${counts.missing_cost} sipariş maliyet eksik`);
  }
  if (counts.missing_mapping) {
    parts.push(`${counts.missing_mapping} sipariş eşleşme eksik`);
  }
  if (counts.invalid_data) {
    parts.push(`${counts.invalid_data} geçersiz veri`);
  }
  if (summary.kpiIncluded) {
    parts.push(`${summary.kpiIncluded} güvenilir sipariş`);
  } else if (summary.total && !parts.length) {
    parts.push(`${summary.total} sipariş analiz edildi`);
  }

  const lead = parts.length ? parts.join(' · ') : 'Bu dönemde kâr analizi yok';
  return `${lead} · net kâr yalnızca güvenilir siparişlerden`;
}

const BUYBOX_TO_OPS = Object.freeze({
  'uber-eats': 'trendyol_go',
  getir: 'getir',
  yemeksepeti: 'yemeksepeti'
});

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function orderFilterSql(liveOnly, alias = 'o') {
  const clauses = [
    `${alias}.branch_id = $1`,
    `${alias}.status NOT IN ('cancelled', 'failed')`
  ];
  if (liveOnly) clauses.push(`${alias}.shadow_mode = FALSE`);
  return clauses.join(' AND ');
}

function packageFromOpsRow(buyboxChannelId, row) {
  if (buyboxChannelId === 'yemeksepeti') return packageFromYemeksepetiOpsRow(row);
  if (buyboxChannelId === 'uber-eats') return packageFromUberOpsRow(row);
  if (buyboxChannelId === 'getir') return packageFromGetirOpsRow(row);
  return null;
}

async function fetchBranchOpsPackages(pool, {
  branchId,
  buyboxChannelId,
  since,
  until = null,
  liveOnly = true,
  completedOnly = false,
  status = ''
} = {}) {
  const opsChannel = BUYBOX_TO_OPS[buyboxChannelId];
  if (!opsChannel) return [];

  const params = [branchId, opsChannel, since.toISOString()];
  let timeClause = `${orderFilterSql(liveOnly)} AND o.channel = $2 AND o.ordered_at >= $3`;
  const normalizedStatus = String(status || '').trim();
  if (normalizedStatus) {
    params.push(normalizedStatus);
    timeClause += ` AND o.status = $${params.length}`;
  } else if (completedOnly) {
    timeClause += ` AND o.status = 'completed'`;
  }
  if (until) {
    params.push(until.toISOString());
    timeClause += ` AND o.ordered_at < $${params.length}`;
  }

  const result = await pool.query(
    `SELECT o.external_id, o.display_id, o.status, o.channel_status, o.ordered_at,
            o.ingest_source, o.raw_payload, o.customer_masked, o.delivery_mode,
            o.benimpos_sales_code,
            COALESCE(
              json_agg(
                json_build_object(
                  'barcode', l.barcode,
                  'title', l.title,
                  'quantity', l.quantity,
                  'unit_price', l.unit_price,
                  'channel_product_id', l.channel_product_id
                )
                ORDER BY l.line_index
              ) FILTER (WHERE l.id IS NOT NULL),
              '[]'::json
            ) AS lines
     FROM ops_orders o
     LEFT JOIN ops_order_lines l ON l.order_id = o.id
     WHERE ${timeClause}
     GROUP BY o.id
     ORDER BY o.ordered_at DESC`,
    params
  );

  const packages = [];
  for (const row of result.rows) {
    const pkg = packageFromOpsRow(buyboxChannelId, row);
    if (pkg) packages.push(pkg);
  }
  return packages;
}

const MAX_PROFIT_REPORT_DAYS = 30;
const PROFIT_REPORT_FALLBACK_SINCE = new Date('2020-01-01T00:00:00.000Z');

export { MAX_PROFIT_REPORT_DAYS };

export async function queryBranchOldestOrderSince(pool, {
  branchId,
  liveOnly = true
} = {}) {
  if (!pool || !branchId) return PROFIT_REPORT_FALLBACK_SINCE;
  const result = await pool.query(
    `SELECT MIN(o.ordered_at) AS oldest
     FROM ops_orders o
     WHERE ${orderFilterSql(liveOnly)}`,
    [branchId]
  );
  const oldest = result.rows[0]?.oldest;
  return oldest ? new Date(oldest) : PROFIT_REPORT_FALLBACK_SINCE;
}

export async function queryDistinctOrderStatuses(pool, {
  branchId,
  since,
  until = null,
  liveOnly = true,
  channel = 'all'
} = {}) {
  if (!pool || !branchId || !since) return [];
  const opsChannel = resolveBuyboxChannels(channel).length === 1
    ? BUYBOX_TO_OPS[resolveBuyboxChannels(channel)[0]]
    : null;
  const params = [branchId, since.toISOString()];
  let timeClause = `${orderFilterSql(liveOnly)} AND o.ordered_at >= $2`;
  if (opsChannel) {
    params.push(opsChannel);
    timeClause += ` AND o.channel = $${params.length}`;
  }
  if (until) {
    params.push(until.toISOString());
    timeClause += ` AND o.ordered_at < $${params.length}`;
  }
  const result = await pool.query(
    `SELECT DISTINCT o.status
     FROM ops_orders o
     WHERE ${timeClause}
     ORDER BY o.status`,
    params
  );
  return result.rows.map((row) => String(row.status || '').trim()).filter(Boolean);
}

export async function resolveOrderProfitReportWindow(pool, {
  branchId,
  liveOnly = true,
  days = 7,
  period = null,
  startDate = null,
  endDate = null,
  range = null
} = {}) {
  const normalizedPeriod = String(period || '').trim().toLowerCase();
  const daysToken = String(days ?? '').trim().toLowerCase();

  if (String(range || '').trim().toLowerCase() === 'all' || normalizedPeriod === 'all' || daysToken === 'all') {
    const window = resolveRealUtcOrderDateRange({ days: MAX_PROFIT_REPORT_DAYS });
    return {
      mode: 'days',
      days: MAX_PROFIT_REPORT_DAYS,
      periodLabel: `Son ${MAX_PROFIT_REPORT_DAYS} gün`,
      since: new Date(window.startDate),
      until: new Date(Number(window.endDate) + 1)
    };
  }

  if (startDate) {
    const window = resolveRealUtcOrderDateRange({ startDate, endDate: endDate || startDate });
    const since = new Date(window.startDate);
    const until = new Date(Number(window.endDate) + 1);
    const maxUntil = new Date(since);
    maxUntil.setUTCDate(maxUntil.getUTCDate() + MAX_PROFIT_REPORT_DAYS);
    if (until > maxUntil) {
      return {
        error: `Tarih aralığı en fazla ${MAX_PROFIT_REPORT_DAYS} gün olabilir.`
      };
    }
    return {
      mode: 'custom',
      days: null,
      periodLabel: 'Özel tarih',
      since,
      until
    };
  }

  if (normalizedPeriod === 'today' || Number(days) === 0) {
    const window = resolveRealUtcOrderDateRange({ days: 1 });
    return {
      mode: 'today',
      days: 0,
      periodLabel: 'Bugün',
      since: new Date(window.startDate),
      until: new Date(Number(window.endDate) + 1)
    };
  }

  const span = Math.min(MAX_PROFIT_REPORT_DAYS, Math.max(1, Number(days) || 7));
  const window = resolveRealUtcOrderDateRange({ days: span });
  return {
    mode: 'days',
    days: span,
    periodLabel: `${span} gün`,
    since: new Date(window.startDate),
    until: new Date(Number(window.endDate) + 1)
  };
}

function resolveBuyboxChannels(channelFilter) {
  const normalized = String(channelFilter || 'all').trim();
  if (!normalized || normalized === 'all') return [...HZLMRKTOPS_BUYBOX_CHANNEL_IDS];
  if (BUYBOX_TO_OPS[normalized]) return [normalized];
  return [];
}

function aggregateProductCost(rows = []) {
  let total = 0;
  for (const row of rows) {
    total += Number(row.productCost) || 0;
  }
  return roundMoney(total);
}

async function resolveProfitMatchingConfig() {
  const platformEnv = await readEnvFile(paths.platformEnv);
  const runtime = resolveRuntimeConfig(platformEnv);
  return {
    productMatchingMode: runtime.productMatchingMode,
    productMatchingModeByChannel: runtime.productMatchingModeByChannel || {}
  };
}

export async function buildOpsReportsProfit(pool, {
  branchId,
  since,
  until = null,
  liveOnly = true,
  channel = 'all',
  matchingConfig = null,
  db: injectedDb = null
} = {}) {
  if (!pool || !branchId || !since) {
    return {
      totalSales: 0,
      totalProfit: 0,
      productCost: 0,
      profitRate: 0,
      avgProfit: 0,
      kpiCount: 0,
      excludedFromKpi: 0,
      profitable: 0,
      loss: 0,
      zero: 0
    };
  }

  const db = injectedDb || await readDb();
  const matching = matchingConfig || await resolveProfitMatchingConfig();
  const buyboxChannels = resolveBuyboxChannels(channel);
  const allRows = [];

  for (const buyboxChannelId of buyboxChannels) {
    const packages = await fetchBranchOpsPackages(pool, {
      branchId,
      buyboxChannelId,
      since,
      until,
      liveOnly
    });
    if (!packages.length) continue;
    const productMatchingMode = resolveMatchingModeForChannel(
      matching.productMatchingMode,
      buyboxChannelId,
      matching.productMatchingModeByChannel
    );
    const rows = analyzeOrderPackages(packages, db, {
      ...profitAnalysisSettingsForChannel(buyboxChannelId),
      costScope: costScopeForChannel(buyboxChannelId),
      orderDateTimezone: orderDateTimezoneForChannel(buyboxChannelId),
      channelId: buyboxChannelId,
      productMatchingMode
    }).map((row) => ({
      ...row,
      profitConfidence: computeProfitConfidence(row)
    }));
    allRows.push(...rows);
  }

  const stats = buildOrderStats(allRows);
  const confidence = summarizeProfitConfidence(allRows);
  return {
    ...stats,
    productCost: aggregateProductCost(allRows),
    confidence: confidence.counts,
    ordersAnalyzed: confidence.total,
    ordersInKpi: confidence.kpiIncluded,
    ordersExcluded: confidence.kpiExcluded,
    footnote: buildProfitFootnote(confidence)
  };
}

function mapProfitReportListRow(row, channelMeta) {
  return {
    orderNumber: row.orderNumber || '',
    orderDate: row.orderDate || '',
    orderDateMs: row.orderDateMs || 0,
    channel: row.channel || '',
    channelLabel: channelMeta(row.channel)?.label || row.channel || '—',
    status: row.status || '',
    salesAmount: roundMoney(row.salesAmount),
    netProfit: roundMoney(row.netProfit),
    profitRate: roundMoney(row.profitRate),
    profitMargin: roundMoney(row.profitMargin),
    productCost: roundMoney(row.productCost),
    commissionAmount: roundMoney(row.commissionAmount),
    profitConfidence: row.profitConfidence,
    profitConfidenceLabel: labelProfitConfidence(row.profitConfidence)
  };
}

function mapProfitReportDetailRow(row, channelMeta) {
  return {
    ...mapProfitReportListRow(row, channelMeta),
    customerName: row.customerName || '',
    deliveryMethod: row.deliveryMethod || '',
    ingestSource: row.ingestSource || '',
    extraCost: roundMoney(row.extraCost),
    serviceFee: roundMoney(row.serviceFee),
    stopajAmount: roundMoney(row.stopajAmount),
    salesVat: roundMoney(row.salesVat),
    purchaseVat: roundMoney(row.purchaseVat),
    commissionVat: roundMoney(row.commissionVat),
    shippingVat: roundMoney(row.shippingVat),
    serviceFeeVat: roundMoney(row.serviceFeeVat),
    payableVat: roundMoney(row.payableVat),
    carriedForwardVat: roundMoney(row.carriedForwardVat),
    shippingCost: roundMoney(row.shippingCost),
    dataWarnings: row.dataWarnings || [],
    matchingWarnings: row.matchingWarnings || [],
    lines: (row.lines || []).map((line) => ({
      title: line.title || '',
      barcode: line.barcode || '',
      quantity: line.quantity,
      unitPrice: roundMoney(line.unitPrice),
      lineTotal: roundMoney(line.lineTotal ?? line.amount),
      mappingStatus: line.mappingStatus || ''
    }))
  };
}

async function loadIncludedProfitRows(pool, {
  branchId,
  since,
  until = null,
  liveOnly = true,
  channel = 'all',
  status = '',
  reliableOnly = false,
  matchingConfig = null,
  db: injectedDb = null
} = {}) {
  if (!pool || !branchId || !since) {
    return { analyzedRows: [], included: [], reliable: [] };
  }

  const db = injectedDb || await readDb();
  const matching = matchingConfig || await resolveProfitMatchingConfig();
  const buyboxChannels = resolveBuyboxChannels(channel);
  const analyzedRows = [];

  for (const buyboxChannelId of buyboxChannels) {
    const packages = await fetchBranchOpsPackages(pool, {
      branchId,
      buyboxChannelId,
      since,
      until,
      liveOnly,
      completedOnly: false,
      status
    });
    if (!packages.length) continue;

    const productMatchingMode = resolveMatchingModeForChannel(
      matching.productMatchingMode,
      buyboxChannelId,
      matching.productMatchingModeByChannel
    );
    const rows = analyzeOrderPackages(packages, db, {
      ...profitAnalysisSettingsForChannel(buyboxChannelId),
      costScope: costScopeForChannel(buyboxChannelId),
      orderDateTimezone: orderDateTimezoneForChannel(buyboxChannelId),
      channelId: buyboxChannelId,
      productMatchingMode
    }).map((row) => ({
      ...row,
      profitConfidence: computeProfitConfidence(row)
    }));
    analyzedRows.push(...rows);
  }

  const reliable = analyzedRows.filter((row) => isProfitKpiIncluded(row));
  const included = reliableOnly ? reliable : analyzedRows;
  return { analyzedRows, included, reliable };
}

/** Kâr raporu — kayıtlı siparişler; güvenilir olmayan satırlar Veri sütununda işaretlenir. */
export async function buildOpsOrderProfitabilityReport(pool, {
  branchId,
  since,
  until = null,
  liveOnly = true,
  channel = 'all',
  status = '',
  reliableOnly = false,
  matchingConfig = null,
  db: injectedDb = null,
  page = 1,
  limit = 25,
  periodLabel = ''
} = {}) {
  const { analyzedRows, included, reliable } = await loadIncludedProfitRows(pool, {
    branchId,
    since,
    until,
    liveOnly,
    channel,
    status,
    reliableOnly,
    matchingConfig,
    db: injectedDb
  });

  if (!analyzedRows.length && !included.length) {
    return {
      rows: [],
      summary: { total: 0, included: 0, excluded: 0, unreliable: 0 },
      page: 1,
      limit: Math.max(1, Math.min(Number(limit) || 25, 100)),
      total: 0,
      totalPages: 1,
      periodLabel
    };
  }

  const unreliable = analyzedRows.length - reliable.length;
  const channelMeta = (id) => getChannel(id);
  const sorted = included.sort((a, b) => (Number(b.orderDateMs) || 0) - (Number(a.orderDateMs) || 0));
  const total = sorted.length;
  const pageLimit = Math.max(1, Math.min(Number(limit) || 25, 100));
  const pageNum = Math.max(1, Number(page) || 1);
  const totalPages = Math.max(1, Math.ceil(total / pageLimit));
  const safePage = Math.min(pageNum, totalPages);
  const offset = (safePage - 1) * pageLimit;

  const rows = sorted
    .slice(offset, offset + pageLimit)
    .map((row) => mapProfitReportListRow(row, channelMeta));

  return {
    rows,
    summary: {
      total: analyzedRows.length,
      included: included.length,
      reliable: reliable.length,
      excluded: unreliable,
      unreliable,
      activeExcludedNote: unreliable > 0
        ? `${unreliable} siparişte kâr verisi eksik veya güvenilir değil — yine de listelenir.`
        : 'Tüm listelenen siparişlerde kâr verisi mevcut.'
    },
    page: safePage,
    limit: pageLimit,
    total,
    totalPages,
    periodLabel
  };
}

export async function fetchOpsOrderProfitDetail(pool, {
  branchId,
  orderNumber,
  channel = 'all',
  since,
  until = null,
  liveOnly = true,
  status = '',
  matchingConfig = null,
  db: injectedDb = null
} = {}) {
  const target = String(orderNumber || '').trim();
  if (!pool || !branchId || !since || !target) {
    return { ok: false, error: 'Geçersiz istek' };
  }

  const { included } = await loadIncludedProfitRows(pool, {
    branchId,
    since,
    until,
    liveOnly,
    channel,
    status,
    reliableOnly: false,
    matchingConfig,
    db: injectedDb
  });

  const channelMeta = (id) => getChannel(id);
  const hit = included.find((row) => String(row.orderNumber || '').trim() === target);
  if (!hit) {
    return { ok: false, error: 'Sipariş bulunamadı' };
  }

  return {
    ok: true,
    row: mapProfitReportDetailRow(hit, channelMeta)
  };
}
