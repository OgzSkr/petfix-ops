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
  orderDateTimezoneForChannel
} from '../../order-profitability.js';
import { costScopeForChannel } from '../../cost-scopes.js';
import { profitAnalysisSettingsForChannel } from '../../profit-constants.js';
import { resolveMatchingModeForChannel } from '../../product-matching/resolve.js';
import {
  computeProfitConfidence,
  summarizeProfitConfidence
} from '../../production/profit-confidence.js';

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
  liveOnly = true
}) {
  const opsChannel = BUYBOX_TO_OPS[buyboxChannelId];
  if (!opsChannel) return [];

  const params = [branchId, opsChannel, since.toISOString()];
  let timeClause = `${orderFilterSql(liveOnly)} AND o.channel = $2 AND o.ordered_at >= $3`;
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
  matchingConfig = null
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

  const db = await readDb();
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
