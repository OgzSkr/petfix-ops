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
import { readDb, writeDb } from '../../db/store.js';
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
import { syncChannelProductsFromOrderPackages } from '../../product-matching/ensure-channel-product.js';
import { clearWorkbenchIndex } from '../../product-matching/workbench-index.js';
import { getProductMatching } from '../../product-matching/store.js';
import { enrichRowsWithBenimposTransferStatus } from '../../product-matching/benimpos-transfer-status.js';
import {
  buildOrdersQueryCacheKey,
  getOrdersQueryCacheEntry
} from './orders-query-cache.js';
import { activityEventFromGetirSync } from './ops-activity-feed.js';

const log = createLogger('CHANNEL-ORDERS');
const CHANNEL_ORDERS_CACHE_BUCKET = 'channelOrdersCache';

function channelCacheKey(channelId, searchParams) {
  return `${String(channelId || '').trim()}:${buildOrdersQueryCacheKey(searchParams)}`;
}

async function backfillTgoHistory(fetchOptions) {
  try {
    const { syncTgoReadOnly } = await import('../../ops-hub/sync/tgo-sync.js');
    const { bootstrapOpsHub, getOpsHubPool, isOpsHubReady } = await import('../../ops-hub/bootstrap.js');
    const { readEnvFile } = await import('../../env.js');
    const { paths } = await import('../../config.js');
    const platformEnv = await readEnvFile(paths.platformEnv);

    if (!isOpsHubReady()) {
      await bootstrapOpsHub(platformEnv);
    }

    const pool = getOpsHubPool();
    if (!pool) return null;

    return syncTgoReadOnly(pool, {
      platformEnv,
      pageSize: 50,
      maxPages: 20,
      packageStatus: ['Created', 'Picking', 'Invoiced', 'Shipped', 'Delivered'],
      shadowMode: true
    });
  } catch (error) {
    log.warn(`TGO geçmiş senkronu atlandı: ${error.message}`);
    return null;
  }
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

async function ensureOpsHubPool(platformEnv) {
  const { bootstrapOpsHub, getOpsHubPool, isOpsHubReady } = await import('../../ops-hub/bootstrap.js');
  if (!isOpsHubReady()) {
    await bootstrapOpsHub(platformEnv);
  }
  return getOpsHubPool();
}

async function runGetirSync(fetchOptions, { force = false } = {}) {
  const { readEnvFile } = await import('../../env.js');
  const { paths } = await import('../../config.js');
  const { resolveGetirOpsConfig } = await import('../../ops-hub/integrations/branch-config-resolver.js');
  const { isGetirConfigComplete } = await import('../../ops-hub/integrations/config-bridge.js');
  const {
    syncGetirReadOnly,
    syncGetirDeliveredHistory,
    summarizeGetirSyncReport
  } = await import('../../ops-hub/sync/getir-sync.js');

  const platformEnv = await readEnvFile(paths.platformEnv);
  const report = { force, apiReady: false, errors: [], live: null, delivered: null };

  const pool = await ensureOpsHubPool(platformEnv);
  if (!pool) {
    report.errors.push('Ops Postgres bağlantısı yok.');
    return { report, summary: summarizeGetirSyncReport(report) };
  }

  const cfg = await resolveGetirOpsConfig(pool, { platformEnv });
  report.apiReady = isGetirConfigComplete(cfg);
  if (!report.apiReady) {
    report.apiMessage = 'Getir API bilgileri eksik — Integrations veya GETIR_* env alanlarını doldurun.';
    log.warn(`Getir sync atlandı: ${report.apiMessage}`);
    return { report, summary: summarizeGetirSyncReport(report) };
  }

  try {
    report.live = await syncGetirReadOnly(pool, { platformEnv, shadowMode: true, cfg });
  } catch (error) {
    report.errors.push(`Canlı poll: ${error.message}`);
    log.warn(`Getir canlı poll: ${error.message}`);
  }

  if (force) {
    try {
      const days = fetchOptions.days ? toPositiveInteger(fetchOptions.days, 14) : 14;
      report.delivered = await syncGetirDeliveredHistory(pool, {
        platformEnv,
        days,
        shadowMode: true,
        cfg,
        ingestSource: ORDER_SOURCES.PARTNER_API
      });
    } catch (error) {
      report.errors.push(`Delivered geçmiş: ${error.message}`);
      log.warn(`Getir delivered sync: ${error.message}`);
    }
  }

  return { report, summary: summarizeGetirSyncReport(report) };
}

export function createChannelOrdersService({ runtime, config = {}, opsActivityFeed = null }) {
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
    let opsOrdersOnly = false;
    if (!adapter.isConfigured(cfg)) {
      if (channelId === 'getir') {
        const { canListOpsOrders } = await import('../../channels/ops-orders-bridge.js');
        opsOrdersOnly = await canListOpsOrders(channelId);
      }
      if (!opsOrdersOnly) {
        const error = new Error(`${channel.label} API bilgileri eksik — Ayarlar sayfasından .env alanlarını doldurun.`);
        error.statusCode = 503;
        throw error;
      }
    }

    const force = searchParams.get('force') === '1';
    const days = searchParams.get('days');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const fetchOptions = { days, startDate, endDate };

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

    let getirSync = null;
    if (channelId === 'getir') {
      const lastLiveSync = Number(runtime.getirLiveSyncAt) || 0;
      const shouldSyncLive = force || now - lastLiveSync >= limits.getirLiveSyncCooldownMs;
      if (shouldSyncLive) {
        const syncResult = await runGetirSync(fetchOptions, { force });
        runtime.getirLiveSyncAt = Date.now();
        runtime.getirLiveSyncSummary = syncResult.summary;
        getirSync = syncResult.summary;
        if (opsActivityFeed) {
          opsActivityFeed.append(
            activityEventFromGetirSync(syncResult.summary, syncResult.report)
          );
        }
        if (syncResult.summary.messages?.length) {
          log.warn(`Getir sync: ${syncResult.summary.messages.join(' · ')}`);
        }
      } else {
        getirSync = runtime.getirLiveSyncSummary || null;
      }
    }

    const orderDateTimezone = orderDateTimezoneForChannel(channelId);
    const range = resolveOrderDateRangeForChannel(channelId, {
      days: days ? toPositiveInteger(days, 14) : undefined,
      startDate,
      endDate
    });

    const db = await readDb();

    if (channelId === 'yemeksepeti' && force) {
      await backfillYemeksepetiHistory(fetchOptions);
    }

    if (channelId === 'uber-eats' && force) {
      await backfillTgoHistory(fetchOptions);
    }

    let packages = await adapter.fetchOrders(fetchOptions);

    try {
      if (channelId === 'yemeksepeti') {
        const { mergeYemeksepetiOrderSources } = await import('../../channels/yemeksepeti-ops-orders.js');
        packages = await mergeYemeksepetiOrderSources(packages, { days, startDate, endDate });
      } else if (channelId === 'uber-eats') {
        const { mergeUberEatsOrderSources } = await import('../../channels/uber-eats-ops-orders.js');
        packages = await mergeUberEatsOrderSources(packages, { days, startDate, endDate });
      } else if (channelId === 'getir') {
        const { mergeChannelOrderSources } = await import('../../channels/ops-orders-bridge.js');
        packages = await mergeChannelOrderSources('getir', packages, { days, startDate, endDate });
        const { computeGetirOrderFinancials, applyGetirFinancialsToPackage } = await import('../../channels/getir-portal-financials.js');
        packages = packages.map((pkg) =>
          applyGetirFinancialsToPackage(pkg, computeGetirOrderFinancials(pkg))
        );
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

    if (productMatchingMode !== 'legacy') {
      const lastProductSync = Number(runtime.orderChannelProductSyncAt?.[channelId]) || 0;
      const shouldSyncProducts = force || now - lastProductSync >= limits.orderChannelProductSyncCooldownMs;
      if (shouldSyncProducts) {
        const syncResult = syncChannelProductsFromOrderPackages(db, packages, channelId);
        runtime.orderChannelProductSyncAt = runtime.orderChannelProductSyncAt || {};
        runtime.orderChannelProductSyncAt[channelId] = now;
        if (syncResult.created > 0) {
          clearWorkbenchIndex(getProductMatching(db));
          db.meta = db.meta || {};
          db.meta.updatedAt = new Date().toISOString();
          writeDb(db).catch((error) => {
            log.warn(`${channel.label} kanal ürün sync yazımı: ${error.message}`);
          });
          log.info(`${channel.label}: ${syncResult.created} sipariş satırı kanal kataloğuna eklendi`);
        }
      }
    }

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

    if (channelId === 'yemeksepeti' || channelId === 'uber-eats' || channelId === 'getir') {
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
      getirSync,
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
