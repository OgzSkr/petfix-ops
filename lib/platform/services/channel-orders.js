import {
  analyzeOrderPackages,
  buildOrderStats,
  buildOrderTimeline,
  filterRowsByOrderDate,
  orderDateTimezoneForChannel,
  orderRowToCsv,
  resolveOrderDateRangeForChannel
} from '../../order-profitability.js';
import { limits } from '../../config.js';
import { readDb } from '../../db/store.js';
import { createLogger } from '../../logger.js';
import { assessOrderRow, summarizeDataQuality } from '../../data-quality.js';
import { ORDER_SOURCES } from '../../production/constants.js';
import {
  computeProfitConfidence,
  summarizeProfitConfidence
} from '../../production/profit-confidence.js';
import { profitAnalysisSettingsForChannel } from '../../profit-constants.js';
import { toPositiveInteger } from '../../utils.js';
import { getChannel, getChannelAdapter } from '../../channels/registry.js';
import { CHANNEL_SCOPE } from '../../platform/brand.js';
import { costScopeForChannel } from '../../cost-scopes.js';
import { resolveMatchingModeForChannel, summarizeOrderLineMatching } from '../../product-matching/resolve.js';
import { enrichRowsWithBenimposTransferStatus } from '../../product-matching/benimpos-transfer-status.js';
import {
  buildOrdersQueryCacheKey,
  getOrdersQueryCacheEntry
} from './orders-query-cache.js';

const log = createLogger('CHANNEL-ORDERS');
const CHANNEL_ORDERS_CACHE_BUCKET = 'channelOrdersCache';

function channelCacheKey(channelId, searchParams) {
  return `${String(channelId || '').trim()}:${buildOrdersQueryCacheKey(searchParams)}`;
}

async function backfillYemeksepetiHistory(fetchOptions) {
  try {
    const { syncYemeksepetiReadOnly } = await import('../../ops-hub/sync/ys-sync.js');
    const { bootstrapOpsHub, getOpsHubPool, isOpsHubReady } = await import('../../ops-hub/bootstrap.js');
    const { readEnvFile } = await import('../../env.js');
    const { paths } = await import('../../config.js');
    const platformEnv = await readEnvFile(paths.platformEnv);

    if (!isOpsHubReady()) {
      await bootstrapOpsHub(platformEnv);
    }

    const pool = getOpsHubPool();
    if (!pool) return null;

    return syncYemeksepetiReadOnly(pool, {
      platformEnv,
      days: fetchOptions.days ? toPositiveInteger(fetchOptions.days, 14) : 14,
      startDate: fetchOptions.startDate,
      endDate: fetchOptions.endDate,
      shadowMode: true
    });
  } catch (error) {
    log.warn(`Yemeksepeti geçmiş senkronu atlandı: ${error.message}`);
    return null;
  }
}

export function createChannelOrdersService({ runtime, config = {} }) {
  async function listChannelOrders(channelId, searchParams) {
    const channel = getChannel(channelId);
    const adapter = getChannelAdapter(channelId);

    if (!channel || !adapter) {
      const error = new Error('Kanal bulunamadı.');
      error.statusCode = 404;
      throw error;
    }

    if (channel.status !== 'active') {
      const error = new Error('Bu kanal henüz aktif değil.');
      error.statusCode = 503;
      throw error;
    }

    if (channel.scope !== CHANNEL_SCOPE.ORDERS_PROFIT) {
      const error = new Error('Bu kanal için sipariş API\'si tanımlı değil.');
      error.statusCode = 400;
      throw error;
    }

    const cfg = await adapter.loadConfig();
    if (!adapter.isConfigured(cfg)) {
      const error = new Error(`${channel.label} API bilgileri eksik — Ayarlar sayfasından .env alanlarını doldurun.`);
      error.statusCode = 503;
      throw error;
    }

    const force = searchParams.get('force') === '1';
    const now = Date.now();
    const cacheKey = channelCacheKey(channelId, searchParams);
    const cache = getOrdersQueryCacheEntry(runtime, CHANNEL_ORDERS_CACHE_BUCKET, cacheKey);

    if (!force && cache.payload && now - cache.lastFetchAt < limits.ordersFetchCooldownMs) {
      return {
        ...cache.payload,
        skipped: true,
        cooldownSeconds: Math.ceil((limits.ordersFetchCooldownMs - (now - cache.lastFetchAt)) / 1000),
        message: 'Siparişler az önce çekildi. API yükünü azaltmak için kısa süre bekleyin.'
      };
    }

    const days = searchParams.get('days');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const orderDateTimezone = orderDateTimezoneForChannel(channelId);
    const range = resolveOrderDateRangeForChannel(channelId, {
      days: days ? toPositiveInteger(days, 14) : undefined,
      startDate,
      endDate
    });

    const db = await readDb();
    const fetchOptions = { days, startDate, endDate };

    if (channelId === 'yemeksepeti' && force) {
      await backfillYemeksepetiHistory(fetchOptions);
    }

    let packages = await adapter.fetchOrders(fetchOptions);

    try {
      if (channelId === 'yemeksepeti') {
        const { mergeYemeksepetiOrderSources } = await import('../../channels/yemeksepeti-ops-orders.js');
        packages = await mergeYemeksepetiOrderSources(packages, { days, startDate, endDate });
      } else if (channelId === 'uber-eats') {
        const { mergeUberEatsOrderSources } = await import('../../channels/uber-eats-ops-orders.js');
        packages = await mergeUberEatsOrderSources(packages, { days, startDate, endDate });
      }
    } catch (error) {
      log.warn(`${channel.label} ops sipariş birleştirme: ${error.message}`);
    }

    let orderSources = null;

    const productMatchingMode = resolveMatchingModeForChannel(
      config.productMatchingMode,
      channelId,
      config.productMatchingModeByChannel
    );
    const analyzed = analyzeOrderPackages(packages, db, {
      ...profitAnalysisSettingsForChannel(channelId),
      costScope: costScopeForChannel(channelId),
      orderDateTimezone,
      channelId,
      productMatchingMode
    }).map((row) => ({
      ...row,
      ingestSource: row.ingestSource || ORDER_SOURCES.PARTNER_API,
      profitConfidence: computeProfitConfidence(row)
    }));
    const rows = filterRowsByOrderDate(
      analyzed.map((row) => ({
        ...row,
        channel: channel.id,
        channelLabel: channel.label
      })),
      range
    );
    enrichRowsWithBenimposTransferStatus(rows, db, channelId);

    const dataQuality = summarizeDataQuality(rows, assessOrderRow);
    const profitConfidence = summarizeProfitConfidence(rows);
    const sourceCounts = rows.reduce((acc, row) => {
      const key = row.ingestSource || ORDER_SOURCES.PARTNER_API;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    if (channelId === 'yemeksepeti' || channelId === 'uber-eats') {
      orderSources = {
        partnerApi: sourceCounts.partner_api || 0,
        opsWebhook: sourceCounts.webhook || 0,
        fixture: sourceCounts.fixture || 0,
        manual: sourceCounts.manual || 0,
        merged: rows.length,
        label: [
          `Partner API: ${sourceCounts.partner_api || 0}`,
          `Webhook/Ops: ${sourceCounts.webhook || 0}`,
          `Fixture: ${sourceCounts.fixture || 0}`,
          sourceCounts.partner_api === 0 && sourceCounts.webhook > 0
            ? 'Partner API bu dönemde 0 — geçmiş webhook/Ops kayıtları gösteriliyor'
            : ''
        ].filter(Boolean).join(' · ')
      };
    }
    const statuses = [...new Set(rows.map((row) => row.status).filter(Boolean))].sort((a, b) =>
      String(a).localeCompare(String(b), 'tr-TR')
    );

    const payload = {
      channel: channel.id,
      channelLabel: channel.label,
      productMatchingMode,
      updatedAt: new Date().toISOString(),
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
      stats: buildOrderStats(rows, {
        excludeSources: [ORDER_SOURCES.FIXTURE],
        excludeConfidence: ['missing_cost', 'invalid_data']
      }),
      profitConfidence,
      matchingSummary: summarizeOrderLineMatching(rows),
      dataQuality,
      timeline: {
        day: buildOrderTimeline(rows, 'day', orderDateTimezone),
        week: buildOrderTimeline(rows, 'week', orderDateTimezone)
      },
      orderSources,
      rows
    };

    cache.lastFetchAt = now;
    cache.payload = payload;
    log.info(`${channel.label} sipariş analizi: ${payload.total}/${payload.fetched} kayıt (${cacheKey})`);

    return payload;
  }

  async function sendChannelOrdersCsvExport(channelId, response, searchParams) {
    const result = await listChannelOrders(channelId, searchParams);
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
      'Content-Disposition': `attachment; filename="${channelId}-siparis-karlilik-${label}.csv"`
    });
    response.end(csv);
  }

  return { listChannelOrders, sendChannelOrdersCsvExport };
}
