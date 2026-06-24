import { readDb } from '../../db/store.js';
import { ensureProductMatching } from '../../product-matching/schema.js';
import { resolveRealUtcOrderDateRange } from '../../order-profitability.js';
import { buildOpsReportsProfit, buildOpsOrderProfitabilityReport, fetchOpsOrderProfitDetail, resolveOrderProfitReportWindow, queryDistinctOrderStatuses } from './ops-reports-profit.js';

const CHANNEL_LABELS = {
  getir: 'Getir',
  yemeksepeti: 'Yemeksepeti',
  trendyol_go: 'Uber / TGO'
};

const BUYBOX_TO_OPS = Object.freeze({
  'uber-eats': 'trendyol_go',
  getir: 'getir',
  yemeksepeti: 'yemeksepeti'
});

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function pctChange(current, previous) {
  const cur = Number(current) || 0;
  const prev = Number(previous) || 0;
  if (!prev) return cur ? 100 : 0;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

export function resolveReportPeriod({ days = 7, period = null } = {}) {
  const normalizedPeriod = String(period || '').trim().toLowerCase();
  const spanDays = Number(days);

  if (normalizedPeriod === 'today' || spanDays === 0) {
    const { startDate, endDate } = resolveRealUtcOrderDateRange({ days: 1 });
    const currentStart = new Date(startDate);
    const end = new Date(endDate);
    const previousStart = new Date(currentStart);
    previousStart.setDate(previousStart.getDate() - 1);
    const previousEnd = new Date(currentStart);
    return {
      mode: 'today',
      days: 0,
      periodLabel: 'Bugün',
      currentStart,
      previousStart,
      previousEnd,
      end
    };
  }

  const span = Math.max(1, Math.min(spanDays || 7, 90));
  const end = new Date();
  const currentStart = new Date(end);
  currentStart.setDate(currentStart.getDate() - span);
  const previousStart = new Date(currentStart);
  previousStart.setDate(previousStart.getDate() - span);
  return {
    mode: 'days',
    days: span,
    periodLabel: `${span} gün`,
    currentStart,
    previousStart,
    previousEnd: currentStart,
    end
  };
}

function resolveOpsChannel(channelFilter) {
  const normalized = String(channelFilter || 'all').trim();
  if (!normalized || normalized === 'all') return null;
  return BUYBOX_TO_OPS[normalized] || null;
}

function orderFilterSql(liveOnly, alias = 'o', channel = null) {
  const clauses = [
    `${alias}.branch_id = $1`,
    `${alias}.status NOT IN ('cancelled', 'failed')`
  ];
  if (liveOnly) clauses.push(`${alias}.shadow_mode = FALSE`);
  if (channel) clauses.push(`${alias}.channel = '${channel}'`);
  return clauses.join(' AND ');
}

async function queryOrderStats(pool, { branchId, since, until = null, liveOnly = true, channel = null }) {
  const params = [branchId, since.toISOString()];
  let timeClause = `${orderFilterSql(liveOnly, 'o', channel)} AND o.ordered_at >= $2`;
  if (until) {
    params.push(until.toISOString());
    timeClause += ` AND o.ordered_at < $${params.length}`;
  }

  const result = await pool.query(
    `SELECT
       COUNT(DISTINCT o.id)::int AS order_count,
       COALESCE(SUM(l.quantity * COALESCE(l.unit_price, 0)), 0)::float AS revenue,
       COALESCE(AVG(order_totals.total), 0)::float AS avg_basket
     FROM ops_orders o
     LEFT JOIN ops_order_lines l ON l.order_id = o.id
     LEFT JOIN LATERAL (
       SELECT SUM(l2.quantity * COALESCE(l2.unit_price, 0)) AS total
       FROM ops_order_lines l2
       WHERE l2.order_id = o.id
     ) order_totals ON TRUE
     WHERE ${timeClause}`,
    params
  );
  const row = result.rows[0] || {};
  return {
    orderCount: Number(row.order_count || 0),
    revenue: roundMoney(row.revenue),
    avgBasket: roundMoney(row.avg_basket)
  };
}

async function queryPickingAvgMinutes(pool, { branchId, since, liveOnly = true, channel = null }) {
  const result = await pool.query(
    `SELECT AVG(EXTRACT(EPOCH FROM (picking_completed_at - ordered_at)) / 60.0)::float AS avg_minutes
     FROM ops_orders o
     WHERE ${orderFilterSql(liveOnly, 'o', channel)}
       AND o.ordered_at >= $2
       AND o.picking_completed_at IS NOT NULL`,
    [branchId, since.toISOString()]
  );
  const avg = Number(result.rows[0]?.avg_minutes);
  return Number.isFinite(avg) ? Math.round(avg) : null;
}

async function querySalesSeries(pool, { branchId, since, liveOnly = true, channel = null, hourly = false }) {
  if (hourly) {
    const result = await pool.query(
      `SELECT
         EXTRACT(HOUR FROM o.ordered_at AT TIME ZONE 'Europe/Istanbul')::int AS hour,
         COUNT(DISTINCT o.id)::int AS orders,
         COALESCE(SUM(l.quantity * COALESCE(l.unit_price, 0)), 0)::float AS revenue
       FROM ops_orders o
       LEFT JOIN ops_order_lines l ON l.order_id = o.id
       WHERE ${orderFilterSql(liveOnly, 'o', channel)} AND o.ordered_at >= $2
       GROUP BY 1
       ORDER BY 1 ASC`,
      [branchId, since.toISOString()]
    );
    return result.rows.map((row) => ({
      day: null,
      hour: Number(row.hour),
      orders: Number(row.orders || 0),
      revenue: roundMoney(row.revenue)
    }));
  }

  const result = await pool.query(
    `SELECT
       DATE(o.ordered_at AT TIME ZONE 'Europe/Istanbul') AS day,
       COUNT(DISTINCT o.id)::int AS orders,
       COALESCE(SUM(l.quantity * COALESCE(l.unit_price, 0)), 0)::float AS revenue
     FROM ops_orders o
     LEFT JOIN ops_order_lines l ON l.order_id = o.id
     WHERE ${orderFilterSql(liveOnly, 'o', channel)} AND o.ordered_at >= $2
     GROUP BY 1
     ORDER BY 1 ASC`,
    [branchId, since.toISOString()]
  );
  return result.rows.map((row) => ({
    day: row.day,
    orders: Number(row.orders || 0),
    revenue: roundMoney(row.revenue)
  }));
}

async function queryChannelBreakdown(pool, { branchId, since, liveOnly = true, channel = null }) {
  const result = await pool.query(
    `SELECT
       o.channel,
       COUNT(DISTINCT o.id)::int AS orders,
       COALESCE(SUM(l.quantity * COALESCE(l.unit_price, 0)), 0)::float AS revenue
     FROM ops_orders o
     LEFT JOIN ops_order_lines l ON l.order_id = o.id
     WHERE ${orderFilterSql(liveOnly, 'o', channel)} AND o.ordered_at >= $2
     GROUP BY o.channel
     ORDER BY revenue DESC`,
    [branchId, since.toISOString()]
  );
  return result.rows.map((row) => ({
    channel: row.channel,
    channelLabel: CHANNEL_LABELS[row.channel] || row.channel,
    orders: Number(row.orders || 0),
    revenue: roundMoney(row.revenue)
  }));
}

async function queryHourlyDensity(pool, { branchId, since, liveOnly = true, channel = null }) {
  const result = await pool.query(
    `SELECT
       EXTRACT(HOUR FROM o.ordered_at AT TIME ZONE 'Europe/Istanbul')::int AS hour,
       COUNT(*)::int AS orders
     FROM ops_orders o
     WHERE ${orderFilterSql(liveOnly, 'o', channel)} AND o.ordered_at >= $2
     GROUP BY 1
     ORDER BY 1 ASC`,
    [branchId, since.toISOString()]
  );
  const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, orders: 0 }));
  for (const row of result.rows) {
    byHour[Number(row.hour)] = { hour: Number(row.hour), orders: Number(row.orders || 0) };
  }
  return byHour;
}

async function queryHeatmap(pool, { branchId, since, liveOnly = true, channel = null }) {
  const result = await pool.query(
    `SELECT
       EXTRACT(DOW FROM o.ordered_at AT TIME ZONE 'Europe/Istanbul')::int AS dow,
       EXTRACT(HOUR FROM o.ordered_at AT TIME ZONE 'Europe/Istanbul')::int AS hour,
       COUNT(*)::int AS orders
     FROM ops_orders o
     WHERE ${orderFilterSql(liveOnly, 'o', channel)} AND o.ordered_at >= $2
     GROUP BY 1, 2`,
    [branchId, since.toISOString()]
  );
  return result.rows.map((row) => ({
    dow: Number(row.dow),
    hour: Number(row.hour),
    orders: Number(row.orders || 0)
  }));
}

async function queryProductRankings(pool, {
  branchId,
  since,
  liveOnly = true,
  channel = null,
  limit = 15,
  order = 'DESC'
}) {
  const result = await pool.query(
    `SELECT
       COALESCE(NULLIF(TRIM(l.title), ''), NULLIF(TRIM(l.barcode), ''), l.channel_product_id) AS product_label,
       l.barcode,
       SUM(l.quantity)::float AS quantity,
       SUM(l.quantity * COALESCE(l.unit_price, 0))::float AS revenue
     FROM ops_order_lines l
     JOIN ops_orders o ON o.id = l.order_id
     WHERE ${orderFilterSql(liveOnly, 'o', channel)} AND o.ordered_at >= $2
     GROUP BY 1, l.barcode
     HAVING SUM(l.quantity) > 0
     ORDER BY quantity ${order === 'ASC' ? 'ASC' : 'DESC'}, revenue DESC
     LIMIT $3`,
    [branchId, since.toISOString(), limit]
  );
  return result.rows.map((row) => ({
    title: row.product_label,
    barcode: row.barcode,
    quantity: roundMoney(row.quantity),
    revenue: roundMoney(row.revenue)
  }));
}

async function querySoldBarcodes(pool, { branchId, since = null, liveOnly = true, channel = null }) {
  const params = [branchId];
  let timeClause = '';
  if (since) {
    params.push(since.toISOString());
    timeClause = ` AND o.ordered_at >= $${params.length}`;
  }
  const result = await pool.query(
    `SELECT DISTINCT NULLIF(TRIM(l.barcode), '') AS barcode
     FROM ops_order_lines l
     JOIN ops_orders o ON o.id = l.order_id
     WHERE ${orderFilterSql(liveOnly, 'o', channel)}${timeClause}
       AND NULLIF(TRIM(l.barcode), '') IS NOT NULL`,
    params
  );
  return new Set(result.rows.map((row) => row.barcode).filter(Boolean));
}

async function queryNeverSoldProducts(pool, { branchId, liveOnly = true, limit = 50, channel = null }) {
  const soldEver = await querySoldBarcodes(pool, { branchId, liveOnly, since: null, channel });
  const db = await readDb();
  const pm = ensureProductMatching(db);
  const items = [];
  for (const cp of pm.channelProducts || []) {
    if (channel && String(cp.channelId || '') !== String(channel)) continue;
    const barcode = String(cp.channelBarcode || '').trim();
    if (!barcode || soldEver.has(barcode)) continue;
    items.push({
      title: cp.channelName || cp.channelProductId || barcode,
      barcode,
      channelId: cp.channelId
    });
    if (items.length >= limit) break;
  }
  return items;
}

async function queryUnmappedLineRate(pool, { branchId, since, liveOnly = true, channel = null }) {
  const result = await pool.query(
    `SELECT
       COUNT(*)::int AS total_lines,
       COUNT(*) FILTER (WHERE l.matching_status = 'unmapped')::int AS unmapped_lines
     FROM ops_order_lines l
     JOIN ops_orders o ON o.id = l.order_id
     WHERE ${orderFilterSql(liveOnly, 'o', channel)} AND o.ordered_at >= $2`,
    [branchId, since.toISOString()]
  );
  const row = result.rows[0] || {};
  const total = Number(row.total_lines || 0);
  const unmapped = Number(row.unmapped_lines || 0);
  return {
    totalLines: total,
    unmappedLines: unmapped,
    unmappedRate: total ? Math.round((unmapped / total) * 1000) / 10 : 0
  };
}

export async function buildOpsReports(pool, {
  branchId,
  days = 7,
  period = null,
  channel = 'all',
  liveOnly = true
} = {}) {
  if (!pool || !branchId) {
    throw Object.assign(new Error('branchId zorunlu'), { statusCode: 400 });
  }

  const reportPeriod = resolveReportPeriod({ days, period });
  const opsChannel = resolveOpsChannel(channel);
  const isToday = reportPeriod.mode === 'today';

  const [
    currentStats,
    previousStats,
    pickingAvgMinutes,
    salesSeries,
    channelBreakdown,
    hourlyDensity,
    heatmap,
    topProducts,
    leastProducts,
    neverSold,
    unmapped,
    currentProfit,
    previousProfit
  ] = await Promise.all([
    queryOrderStats(pool, {
      branchId,
      since: reportPeriod.currentStart,
      liveOnly,
      channel: opsChannel
    }),
    queryOrderStats(pool, {
      branchId,
      since: reportPeriod.previousStart,
      until: reportPeriod.previousEnd,
      liveOnly,
      channel: opsChannel
    }),
    queryPickingAvgMinutes(pool, {
      branchId,
      since: reportPeriod.currentStart,
      liveOnly,
      channel: opsChannel
    }),
    querySalesSeries(pool, {
      branchId,
      since: reportPeriod.currentStart,
      liveOnly,
      channel: opsChannel,
      hourly: isToday
    }),
    queryChannelBreakdown(pool, {
      branchId,
      since: reportPeriod.currentStart,
      liveOnly,
      channel: opsChannel
    }),
    queryHourlyDensity(pool, {
      branchId,
      since: reportPeriod.currentStart,
      liveOnly,
      channel: opsChannel
    }),
    queryHeatmap(pool, {
      branchId,
      since: new Date(Date.now() - 30 * 86400000),
      liveOnly,
      channel: opsChannel
    }),
    queryProductRankings(pool, {
      branchId,
      since: reportPeriod.currentStart,
      liveOnly,
      channel: opsChannel,
      order: 'DESC',
      limit: 5
    }),
    queryProductRankings(pool, {
      branchId,
      since: reportPeriod.currentStart,
      liveOnly,
      channel: opsChannel,
      order: 'ASC',
      limit: 5
    }),
    queryNeverSoldProducts(pool, {
      branchId,
      liveOnly,
      channel: channel === 'all' ? null : channel,
      limit: 8
    }),
    queryUnmappedLineRate(pool, {
      branchId,
      since: reportPeriod.currentStart,
      liveOnly,
      channel: opsChannel
    }),
    buildOpsReportsProfit(pool, {
      branchId,
      since: reportPeriod.currentStart,
      liveOnly,
      channel
    }),
    buildOpsReportsProfit(pool, {
      branchId,
      since: reportPeriod.previousStart,
      until: reportPeriod.previousEnd,
      liveOnly,
      channel
    })
  ]);

  const cancelledChannelClause = opsChannel ? ` AND o.channel = '${opsChannel}'` : '';
  const cancelledCurrent = await pool.query(
    `SELECT COUNT(*)::int AS c FROM ops_orders o
     WHERE o.branch_id = $1 AND o.status = 'cancelled'
       AND o.ordered_at >= $2${liveOnly ? ' AND o.shadow_mode = FALSE' : ''}${cancelledChannelClause}`,
    [branchId, reportPeriod.currentStart.toISOString()]
  );
  const cancelledPrevious = await pool.query(
    `SELECT COUNT(*)::int AS c FROM ops_orders o
     WHERE o.branch_id = $1 AND o.status = 'cancelled'
       AND o.ordered_at >= $2 AND o.ordered_at < $3${liveOnly ? ' AND o.shadow_mode = FALSE' : ''}${cancelledChannelClause}`,
    [branchId, reportPeriod.previousStart.toISOString(), reportPeriod.previousEnd.toISOString()]
  );

  return {
    ok: true,
    periodDays: reportPeriod.days,
    period: reportPeriod.mode,
    periodLabel: reportPeriod.periodLabel,
    channel: channel || 'all',
    timezone: 'Europe/Istanbul',
    liveOnly,
    kpis: {
      revenue: currentStats.revenue,
      revenueChangePct: pctChange(currentStats.revenue, previousStats.revenue),
      orderCount: currentStats.orderCount,
      orderCountChangePct: pctChange(currentStats.orderCount, previousStats.orderCount),
      cancelledCount: Number(cancelledCurrent.rows[0]?.c || 0),
      cancelledChangePct: pctChange(
        Number(cancelledCurrent.rows[0]?.c || 0),
        Number(cancelledPrevious.rows[0]?.c || 0)
      ),
      avgBasket: currentStats.avgBasket,
      avgBasketChangePct: pctChange(currentStats.avgBasket, previousStats.avgBasket),
      avgPickingMinutes: pickingAvgMinutes,
      unmappedLineRate: unmapped.unmappedRate,
      netProfit: currentProfit.totalProfit,
      netProfitChangePct: pctChange(currentProfit.totalProfit, previousProfit.totalProfit),
      profitRate: currentProfit.profitRate,
      productCost: currentProfit.productCost,
      avgProfit: currentProfit.avgProfit,
      profitableOrders: currentProfit.profitable,
      lossOrders: currentProfit.loss,
      profitOrdersAnalyzed: currentProfit.ordersAnalyzed || 0,
      profitOrdersInKpi: currentProfit.ordersInKpi || 0,
      profitOrdersExcluded: currentProfit.ordersExcluded || 0,
      profitConfidence: currentProfit.confidence || {},
      profitFootnote: currentProfit.footnote || ''
    },
    salesSeries,
    salesSeriesMode: isToday ? 'hourly' : 'daily',
    channelBreakdown,
    hourlyDensity,
    heatmap,
    topProducts,
    leastProducts,
    neverSold,
    note: liveOnly
      ? 'Canlı siparişler — eğitim modu siparişleri dahil değil. Ciro satır tutarlarından; kâr BenimPOS maliyetleri ve komisyon modelinden hesaplanır.'
      : 'Tüm siparişler dahil.'
  };
}

export async function buildOrderProfitReportApi(pool, {
  branchId,
  days = 7,
  period = null,
  startDate = null,
  endDate = null,
  range = null,
  channel = 'all',
  status = '',
  liveOnly = true,
  page = 1,
  limit = 25
} = {}) {
  const window = await resolveOrderProfitReportWindow(pool, {
    branchId,
    liveOnly,
    days,
    period,
    startDate,
    endDate,
    range
  });
  if (window.error) {
    return {
      ok: false,
      error: window.error,
      rows: [],
      summary: { total: 0, included: 0, excluded: 0, unreliable: 0 },
      page: 1,
      limit: Math.max(1, Math.min(Number(limit) || 25, 100)),
      total: 0,
      totalPages: 1,
      periodLabel: '',
      statuses: []
    };
  }
  const statuses = await queryDistinctOrderStatuses(pool, {
    branchId,
    since: window.since,
    until: window.until,
    liveOnly,
    channel
  });
  const report = await buildOpsOrderProfitabilityReport(pool, {
    branchId,
    since: window.since,
    until: window.until,
    liveOnly,
    channel,
    status,
    page,
    limit,
    periodLabel: window.periodLabel
  });
  return {
    ok: true,
    ...report,
    period: window.mode,
    periodLabel: window.periodLabel,
    rangeStart: window.since?.toISOString?.() || null,
    rangeEnd: window.until?.toISOString?.() || null,
    statuses
  };
}

export async function buildOrderProfitDetailApi(pool, {
  branchId,
  orderNumber,
  channel = 'all',
  days = 7,
  period = null,
  startDate = null,
  endDate = null,
  range = null,
  status = '',
  liveOnly = true
} = {}) {
  const window = await resolveOrderProfitReportWindow(pool, {
    branchId,
    liveOnly,
    days,
    period,
    startDate,
    endDate,
    range
  });
  if (window.error) {
    return { ok: false, error: window.error };
  }
  return fetchOpsOrderProfitDetail(pool, {
    branchId,
    orderNumber,
    channel,
    since: window.since,
    until: window.until,
    liveOnly,
    status
  });
}

export { resolveReportPeriod as periodBounds };
