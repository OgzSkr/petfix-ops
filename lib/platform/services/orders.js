import {
  analyzeOrderPackages,
  buildOrderStats,
  buildOrderTimeline,
  fetchTrendyolOrders,
  filterRowsByOrderDate,
  orderRowToCsv,
  resolveOrderDateRange
} from '../../order-profitability.js';
import { limits, paths } from '../../config.js';
import { readDb, writeDb } from '../../db/store.js';
import {
  buildShippingCostIndex,
  syncDhlCostsForPackages
} from '../../carriers/dhl-shipping-costs.js';
import { isDhlConfigured } from '../../carriers/dhl-ecommerce-client.js';
import { readTrendyolEnv } from '../../trendyol-env.js';
import { createLogger } from '../../logger.js';
import { assessOrderRow, summarizeDataQuality } from '../../data-quality.js';
import { profitAnalysisSettings } from '../../profit-constants.js';
import { COST_SCOPE } from '../../cost-scopes.js';
import { toPositiveInteger } from '../../utils.js';
import { resolveMatchingModeForChannel, summarizeOrderLineMatching } from '../../product-matching/resolve.js';
import {
  buildOrdersQueryCacheKey,
  getOrdersQueryCacheEntry
} from './orders-query-cache.js';

const log = createLogger('ORDERS');
const ORDERS_CACHE_BUCKET = 'ordersCache';

export function createOrdersService({ runtime, config = {} }) {
  async function listOrders(searchParams) {
    const force = searchParams.get('force') === '1';
    const now = Date.now();
    const cacheKey = buildOrdersQueryCacheKey(searchParams);
    const cache = getOrdersQueryCacheEntry(runtime, ORDERS_CACHE_BUCKET, cacheKey);

    if (!force && cache.payload && now - cache.lastFetchAt < limits.ordersFetchCooldownMs) {
      return {
        ...cache.payload,
        skipped: true,
        cooldownSeconds: Math.ceil((limits.ordersFetchCooldownMs - (now - cache.lastFetchAt)) / 1000),
        message: 'Siparişler az önce çekildi. Trendyol API yükünü azaltmak için kısa süre bekleyin.'
      };
    }

    const days = searchParams.get('days');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const range = resolveOrderDateRange({
      days: days ? toPositiveInteger(days, 14) : undefined,
      startDate,
      endDate
    });
    const env = await readTrendyolEnv();
    const db = await readDb();
    const packages = await fetchTrendyolOrders(env, { days, startDate, endDate });
    const syncDhl = searchParams.get('syncDhl') !== '0';
    let dhlSync = null;
    let shippingCostByOrderKey = buildShippingCostIndex(db);

    if (syncDhl) {
      dhlSync = await syncDhlCostsForPackages(packages, env, db, {
        maxLookups: searchParams.get('dhlMax') ? toPositiveInteger(searchParams.get('dhlMax'), 30) : 30
      });
      if (dhlSync.configured && (dhlSync.summary?.queried || 0) > 0) {
        await writeDb(db);
      }
      shippingCostByOrderKey = dhlSync.index;
    }

    const productMatchingMode = resolveMatchingModeForChannel(
      config.productMatchingMode,
      'trendyol-marketplace',
      config.productMatchingModeByChannel
    );
    const dhlConfigured = isDhlConfigured(env);
    const analyzed = analyzeOrderPackages(packages, db, {
      ...profitAnalysisSettings(),
      costScope: COST_SCOPE.TRENDYOL_MARKETPLACE,
      channelId: 'trendyol-marketplace',
      productMatchingMode,
      shippingCostByOrderKey,
      ignoreTrendyolCargoCost: dhlConfigured
    });
    const rows = filterRowsByOrderDate(analyzed, range);
    const dataQuality = summarizeDataQuality(rows, assessOrderRow);
    const statuses = [...new Set(rows.map((row) => row.status).filter(Boolean))].sort((a, b) =>
      String(a).localeCompare(String(b), 'tr-TR')
    );

    const payload = {
      updatedAt: new Date().toISOString(),
      productMatchingMode,
      range: {
        startMs: range.startDate,
        endMs: range.endDate,
        startDate: new Date(range.startDate).toISOString(),
        endDate: new Date(range.endDate).toISOString(),
        days: days ? toPositiveInteger(days, 14) : null
      },
      fetched: analyzed.length,
      total: rows.length,
      statuses,
      stats: buildOrderStats(rows),
      matchingSummary: summarizeOrderLineMatching(rows),
      dataQuality,
      timeline: {
        day: buildOrderTimeline(rows, 'day'),
        week: buildOrderTimeline(rows, 'week')
      },
      dhlShipping: dhlSync?.summary || null,
      rows
    };

    cache.lastFetchAt = now;
    cache.payload = payload;
    runtime.lastOrdersFetchAt = now;
    log.info(`Sipariş analizi: ${payload.total}/${payload.fetched} kayıt (${cacheKey})`);

    return payload;
  }

  async function sendOrdersCsvExport(response, searchParams) {
    const result = await listOrders(searchParams);
    const status = String(searchParams.get('status') || '').trim();
    const profit = String(searchParams.get('profit') || '').trim();
    let rows = result.rows;

    if (status) rows = rows.filter((row) => String(row.status) === status);
    if (profit === 'profit') rows = rows.filter((row) => row.netProfit > 0);
    if (profit === 'loss') rows = rows.filter((row) => row.netProfit < 0);
    if (profit === 'zero') rows = rows.filter((row) => row.netProfit === 0);

    const csv = orderRowToCsv(rows);
    const label = result.range.days ? `${result.range.days}gun` : 'ozel';

    response.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="siparis-karlilik-${label}.csv"`
    });
    response.end(csv);
  }

  return { listOrders, sendOrdersCsvExport };
}
