import { readJsonBody, sendJson } from '../../http/respond.js';
import { readBuyboxHistory } from '../../buybox/history.js';
import { buildBuyboxAnalytics } from '../../buybox/analytics.js';
import { listChannels, getChannelsHealth, getChannelAdapter } from '../../channels/registry.js';
import { resolveProductThumb } from '../../product-thumb.js';
import { buildDataIntegrityAudit } from '../services/data-integrity-audit.js';

/**
 * JSON API rotaları — dashboard, kanallar, BenimPOS, eşleştirme, Trendyol operasyon.
 * @returns {Promise<boolean>} İstek işlendiyse true
 */
export async function handleApiRoutes(ctx) {
  const {
    request,
    response,
    url,
    auth,
    dashboard,
    buybox,
    worker,
    products,
    orders,
    channelOrders,
    hzlmrktopsOrders,
    channelsSummary,
    channelSettings,
    benimpos,
    productMatching,
    email,
    ops,
    actionCenter,
    commissionTariff,
    pricingDashboard,
    livePerformance,
    uberOps,
    channelMatchingOps,
    matchingSync
  } = ctx;

  if (request.method === 'GET' && url.pathname === '/api/dashboard/channels-summary') {
    auth.assertAuthorized(request);
    await sendJson(response, await channelsSummary.buildChannelsSummary(url.searchParams));
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/dashboard/live-performance') {
    auth.assertAuthorized(request);
    await sendJson(response, await livePerformance.buildLivePerformance(url.searchParams));
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/dashboard/action-center') {
    auth.assertAuthorized(request);
    await sendJson(response, await actionCenter.buildActionCenter(url.searchParams));
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/dashboard/pricing-kpis') {
    auth.assertAuthorized(request);
    await sendJson(response, await pricingDashboard.buildPricingKpis());
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/channels/health') {
    auth.assertAuthorized(request);
    await sendJson(response, { channels: await getChannelsHealth() });
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/health') {
    await sendJson(response, {
      ok: true,
      status: 'alive',
      authRequired: auth.mustAuthenticate(),
      authEnabled: auth.isEnabled(),
      uptime: process.uptime()
    });
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/admin/channel-status') {
    auth.assertAuthorized(request);
    const { buildProductionChannelStatus } = await import('../services/production-channel-status.js');
    const { getOpsHubPool } = await import('../../ops-hub/bootstrap.js');
    let pool = null;
    try {
      pool = getOpsHubPool();
    } catch {
      pool = null;
    }
    await sendJson(response, await buildProductionChannelStatus(pool));
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/ops/status') {
    auth.assertAuthorized(request);
    await sendJson(response, await ops.buildOpsStatus());
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/ops/data-integrity') {
    auth.assertAuthorized(request);
    await sendJson(response, await buildDataIntegrityAudit());
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/login') {
    const payload = await readJsonBody(request);
    await sendJson(response, auth.loginWithToken(payload));
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/channels') {
    auth.assertAuthorized(request);
    await sendJson(response, { channels: listChannels() });
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/buybox/history') {
    auth.assertAuthorized(request);
    await sendJson(response, await readBuyboxHistory({
      barcode: url.searchParams.get('barcode') || '',
      limit: url.searchParams.get('limit') || 100,
      since: url.searchParams.get('since') || ''
    }));
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/buybox/analytics') {
    auth.assertAuthorized(request);
    await sendJson(response, await buildBuyboxAnalytics({
      days: url.searchParams.get('days') || undefined
    }));
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/dashboard') {
    auth.assertAuthorized(request);
    await sendJson(response, await dashboard.buildDashboard());
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/live-status') {
    auth.assertAuthorized(request);
    await sendJson(response, await worker.buildLiveStatus());
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/trendyol-settings') {
    auth.assertAuthorized(request);
    await sendJson(response, await worker.getTrendyolSettings());
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/trendyol-settings') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request);
    await sendJson(response, await worker.saveTrendyolSettings(payload));
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/uber-eats-settings') {
    auth.assertAuthorized(request);
    await sendJson(response, await channelSettings.getUberEatsSettings());
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/uber-eats-settings') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request);
    await sendJson(response, await channelSettings.saveUberEatsSettings(payload));
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/yemeksepeti-settings') {
    auth.assertAuthorized(request);
    await sendJson(response, await channelSettings.getYemeksepetiSettings());
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/yemeksepeti-settings') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request);
    await sendJson(response, await channelSettings.saveYemeksepetiSettings(payload));
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/yemeksepeti/status') {
    auth.assertAuthorized(request);
    const adapter = getChannelAdapter('yemeksepeti');
    const health = adapter ? await adapter.healthCheck({ live: true }) : { ok: false, message: 'Adapter yok' };
    await sendJson(response, health);
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/woocommerce-settings') {
    auth.assertAuthorized(request);
    await sendJson(response, await channelSettings.getWooCommerceSettings());
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/woocommerce-settings') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request);
    await sendJson(response, await channelSettings.saveWooCommerceSettings(payload));
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/woocommerce/status') {
    auth.assertAuthorized(request);
    const adapter = getChannelAdapter('woocommerce');
    const health = adapter ? await adapter.healthCheck({ live: true }) : { ok: false, message: 'Adapter yok' };
    await sendJson(response, health);
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/dhl-settings') {
    auth.assertAuthorized(request);
    await sendJson(response, await channelSettings.getDhlSettings());
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/dhl-settings') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request);
    await sendJson(response, await channelSettings.saveDhlSettings(payload));
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/benimpos-settings') {
    auth.assertAuthorized(request);
    await sendJson(response, await benimpos.getSettings());
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/benimpos-settings') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request);
    await sendJson(response, await benimpos.saveSettings(payload));
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/benimpos/status') {
    auth.assertAuthorized(request);
    await sendJson(response, await benimpos.getStatus());
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/benimpos/sync-costs') {
    auth.assertAuthorized(request);
    await sendJson(response, await benimpos.syncCosts());
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/benimpos/create-channel-sale') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request);
    await sendJson(response, await benimpos.createChannelSale(payload));
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/benimpos/sales-readiness') {
    auth.assertAuthorized(request);
    const channelId = url.searchParams.get('channelId') || 'uber-eats';
    await sendJson(response, await benimpos.getSalesReadiness(channelId));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/benimpos/preview-channel-sale') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request);
    await sendJson(response, await benimpos.previewChannelSale(payload));
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/product-matching/status') {
    auth.assertAuthorized(request);
    await sendJson(response, await productMatching.getStatus());
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/product-matching/queue') {
    auth.assertAuthorized(request);
    await sendJson(response, await channelMatchingOps.getMatchingQueue());
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/product-matching/sync-schedule') {
    auth.assertAuthorized(request);
    await sendJson(response, await matchingSync.getSettings());
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/product-matching/sync-schedule') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request).catch(() => ({}));
    await sendJson(response, await matchingSync.saveSettings(payload));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/product-matching/run-scheduled-sync') {
    auth.assertAuthorized(request);
    await sendJson(response, await matchingSync.runScheduledSync(true));
    return true;
  }

  const matchingOpsStatusMatch = url.pathname.match(/^\/api\/channels\/([^/]+)\/matching-ops-status$/);
  if (request.method === 'GET' && matchingOpsStatusMatch) {
    auth.assertAuthorized(request);
    await sendJson(response, await channelMatchingOps.buildOpsStatus(matchingOpsStatusMatch[1]));
    return true;
  }

  const matchingOpsRunMatch = url.pathname.match(/^\/api\/channels\/([^/]+)\/run-matching-ops$/);
  if (request.method === 'POST' && matchingOpsRunMatch) {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request).catch(() => ({}));
    await sendJson(response, await channelMatchingOps.runOpsPipeline(matchingOpsRunMatch[1], payload));
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/product-matching/ops-summary') {
    auth.assertAuthorized(request);
    await sendJson(response, await productMatching.getOpsSummary());
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/product-matching/workbench') {
    auth.assertAuthorized(request);
    await sendJson(response, await productMatching.listMatchingWorkbench(url.searchParams));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/product-matching/rebuild-workbench-index') {
    auth.assertAuthorized(request);
    await sendJson(response, await productMatching.rebuildWorkbenchIndex());
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/product-matching/data-quality') {
    auth.assertAuthorized(request);
    await sendJson(response, await productMatching.getDataQualityReport(url.searchParams));
    return true;
  }

  const masterDetailMatch = url.pathname.match(/^\/api\/product-matching\/master-products\/([^/]+)$/);
  if (request.method === 'GET' && masterDetailMatch) {
    auth.assertAuthorized(request);
    await sendJson(response, await productMatching.getMasterProductDetail(decodeURIComponent(masterDetailMatch[1])));
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/product-matching/master-products') {
    auth.assertAuthorized(request);
    await sendJson(response, await productMatching.listMasterProducts(url.searchParams));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/product-matching/update-master') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request);
    await sendJson(response, await productMatching.updateMasterProduct(payload.masterProductId, payload));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/product-matching/sync-master') {
    auth.assertAuthorized(request);
    await sendJson(response, await productMatching.startMasterSyncFromBenimpos());
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/product-matching/sync-master/status') {
    auth.assertAuthorized(request);
    await sendJson(response, productMatching.getMasterSyncStatus());
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/product-matching/channel-products') {
    auth.assertAuthorized(request);
    const channelId = url.searchParams.get('channelId') || 'uber-eats';
    await sendJson(response, await productMatching.listChannelProducts(channelId, url.searchParams));
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/channels/uber-eats/ops-status') {
    auth.assertAuthorized(request);
    const probe = url.searchParams.get('probe') !== '0';
    await sendJson(response, await uberOps.buildOpsStatus({ probe }));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/channels/uber-eats/run-ops') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request).catch(() => ({}));
    await sendJson(response, await uberOps.runOpsPipeline(payload));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/product-matching/sync-uber-channel') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request).catch(() => ({}));
    const days = Number(payload.days) || 90;
    await sendJson(response, await productMatching.syncUberChannelProducts(days));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/product-matching/sync-uber-catalog') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request).catch(() => ({}));
    await sendJson(response, await productMatching.syncUberCatalogProducts(payload));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/product-matching/sync-trendyol-catalog') {
    auth.assertAuthorized(request);
    await sendJson(response, await productMatching.syncTrendyolCatalogProducts());
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/product-matching/sync-woocommerce-catalog') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request).catch(() => ({}));
    await sendJson(response, await productMatching.syncWooCommerceCatalogProducts(payload));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/product-matching/sync-yemeksepeti-catalog') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request).catch(() => ({}));
    await sendJson(response, await productMatching.syncYemeksepetiCatalogProducts(payload));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/product-matching/sync-getir-catalog') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request).catch(() => ({}));
    await sendJson(response, await productMatching.syncGetirCatalogProducts(payload));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/product-matching/link-by-barcode') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request).catch(() => ({}));
    await sendJson(
      response,
      await productMatching.linkChannelProductsByBarcode(String(payload.channelId || 'getir').trim())
    );
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/product-matching/clean-uber-order-metadata') {
    auth.assertAuthorized(request);
    await sendJson(response, await productMatching.cleanUberOrderMetadata());
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/product-matching/run-auto-match') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request).catch(() => ({}));
    await sendJson(response, await productMatching.runAutoMatch(payload.channelId || 'uber-eats'));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/product-matching/confirm') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request);
    await sendJson(response, await productMatching.confirmMapping(payload));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/product-matching/confirm-mappings-bulk') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request).catch(() => ({}));
    await sendJson(response, await productMatching.confirmMappingsBulk(payload));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/product-matching/confirm-auto-matched-bulk') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request).catch(() => ({}));
    await sendJson(response, await productMatching.confirmAutoMatchedBulk(payload));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/product-matching/confirm-markup-25-bulk') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request).catch(() => ({}));
    await sendJson(response, await productMatching.confirmMarkup25Bulk(payload));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/product-matching/remove-mapping') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request);
    await sendJson(response, await productMatching.removeMapping(payload));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/product-matching/master-pool-bulk') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request).catch(() => ({}));
    await sendJson(response, await productMatching.masterPoolBulkAction(payload));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/product-matching/remove-channel-mappings-bulk') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request).catch(() => ({}));
    await sendJson(response, await productMatching.removeChannelMappingsBulk(payload));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/product-matching/clear-system-mappings') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request).catch(() => ({}));
    await sendJson(response, await productMatching.clearSystemMappings(payload));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/product-matching/remove-mappings-bulk') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request).catch(() => ({}));
    await sendJson(response, await productMatching.removeMappingsBulk(payload));
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/product-matching/reports') {
    auth.assertAuthorized(request);
    const channelId = url.searchParams.get('channelId') || 'uber-eats';
    await sendJson(response, await productMatching.getReports(channelId));
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/product-matching/price-compare') {
    auth.assertAuthorized(request);
    const channelId = url.searchParams.get('channelId') || 'uber-eats';
    await sendJson(response, await productMatching.listPriceCompare(channelId, url.searchParams));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/product-matching/set-primary-mapping') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request).catch(() => ({}));
    await sendJson(response, await productMatching.setPrimaryMapping(payload));
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/product-matching/logs') {
    auth.assertAuthorized(request);
    await sendJson(response, await productMatching.listMappingLogs());
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/product-matching/search-masters') {
    auth.assertAuthorized(request);
    await sendJson(response, await productMatching.searchMasters(url.searchParams.get('q')));
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/product-matching/missing-master-review') {
    auth.assertAuthorized(request);
    const channelId = url.searchParams.get('channelId') || 'uber-eats';
    await sendJson(response, await productMatching.listMissingMasterReview(channelId, url.searchParams));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/product-matching/missing-master-review') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request);
    await sendJson(response, await productMatching.saveMissingMasterReview(payload));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/product-matching/missing-master-review/apply-suggestions') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request);
    await sendJson(response, await productMatching.applyMissingMasterSuggestions(payload));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/worker/start') {
    auth.assertAuthorized(request);
    await sendJson(response, await worker.startWorker());
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/worker/stop') {
    auth.assertAuthorized(request);
    await sendJson(response, worker.stopWorker());
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/sync-buybox-cache') {
    auth.assertAuthorized(request);
    await sendJson(response, await buybox.syncBuyboxCache());
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/live-buybox') {
    await auth.assertWebhookAuthorized(request);
    const payload = await readJsonBody(request);
    await sendJson(response, await buybox.ingestLiveBuybox(payload));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/buybox/refresh') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request);
    await sendJson(response, await buybox.refreshSingleBuybox(payload));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/buybox/refresh-batch') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request);
    await sendJson(response, await buybox.refreshBatchBuybox(payload));
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/auto-track') {
    auth.assertAuthorized(request);
    await sendJson(response, await buybox.listAutoTrack());
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/auto-track') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request);
    await sendJson(response, await buybox.addAutoTrack(payload));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/auto-track/bulk') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request);
    await sendJson(response, await buybox.addAutoTrackBulk(payload));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/auto-track/remove') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request);
    await sendJson(response, await buybox.removeAutoTrack(payload));
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/commission-tariff') {
    auth.assertAuthorized(request);
    await sendJson(response, await commissionTariff.getStatus());
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/commission-tariff/import') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request);
    await sendJson(response, await commissionTariff.importTariff(payload));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/commission-tariff/bulk-select') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request);
    await sendJson(response, await commissionTariff.bulkSelect(payload));
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/commission-tariff/preview') {
    auth.assertAuthorized(request);
    await sendJson(response, await commissionTariff.getSelectionPreview());
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/commission-tariff/analysis') {
    auth.assertAuthorized(request);
    await sendJson(response, await commissionTariff.getAnalysis(url.searchParams));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/commission-tariff/select-tier') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request);
    await sendJson(response, await commissionTariff.selectTier(payload));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/commission-tariff/manual-calc') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request);
    await sendJson(response, await commissionTariff.manualCalculate(payload));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/commission-tariff/profit-breakdown') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request);
    await sendJson(response, await commissionTariff.profitBreakdown(payload));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/commission-tariff/clear-selections') {
    auth.assertAuthorized(request);
    await sendJson(response, await commissionTariff.clearSelections());
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/commission-tariff/sync-catalog') {
    auth.assertAuthorized(request);
    await sendJson(response, await commissionTariff.syncCatalog());
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/commission-tariff/push-prices/preview') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request);
    await sendJson(response, await commissionTariff.previewPricePush(payload));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/commission-tariff/push-prices') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request);
    await sendJson(response, await commissionTariff.pushPrices(payload));
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/commission-tariff/export') {
    auth.assertAuthorized(request);
    await commissionTariff.sendExport(response);
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/costs') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request);
    await sendJson(response, await products.upsertProductSettings(payload));
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/product-thumb-img') {
    const barcode = url.searchParams.get('barcode') || '';
    const channel = url.searchParams.get('channel') || '';
    const imageUrl = await resolveProductThumb(barcode, channel);
    if (!imageUrl) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Görsel yok');
      return true;
    }
    response.writeHead(302, { Location: imageUrl, 'Cache-Control': 'private, max-age=86400' });
    response.end();
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/product-thumb') {
    auth.assertAuthorized(request);
    const barcode = url.searchParams.get('barcode') || '';
    const imageUrl = await resolveProductThumb(barcode);
    await sendJson(response, { barcode, imageUrl: imageUrl || '' });
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/products') {
    auth.assertAuthorized(request);
    await sendJson(response, await products.listProducts(url.searchParams));
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/products/export') {
    auth.assertAuthorized(request);
    await products.sendCsvExport(response, url.searchParams);
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/products/save') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request);
    await sendJson(response, await products.upsertProductSettings(payload));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/products/import') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request);
    await sendJson(response, await products.importExcel(payload));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/products/sync-trendyol') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request).catch(() => ({}));
    await sendJson(response, await products.syncFromTrendyol(payload || {}));
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/orders') {
    auth.assertAuthorized(request);
    await sendJson(response, await orders.listOrders(url.searchParams));
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/orders/export') {
    auth.assertAuthorized(request);
    await orders.sendOrdersCsvExport(response, url.searchParams);
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/hzlmrktops/orders') {
    auth.assertAuthorized(request);
    await sendJson(response, await hzlmrktopsOrders.listHzlMrktOpsOrders(url.searchParams));
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/hzlmrktops/orders/export') {
    auth.assertAuthorized(request);
    await hzlmrktopsOrders.sendHzlMrktOpsOrdersCsvExport(response, url.searchParams);
    return true;
  }

  const channelOrdersMatch = url.pathname.match(/^\/api\/channels\/([^/]+)\/orders$/);
  if (request.method === 'GET' && channelOrdersMatch) {
    auth.assertAuthorized(request);
    await sendJson(response, await channelOrders.listChannelOrders(channelOrdersMatch[1], url.searchParams));
    return true;
  }

  const channelOrdersExportMatch = url.pathname.match(/^\/api\/channels\/([^/]+)\/orders\/export$/);
  if (request.method === 'GET' && channelOrdersExportMatch) {
    auth.assertAuthorized(request);
    await channelOrders.sendChannelOrdersCsvExport(channelOrdersExportMatch[1], response, url.searchParams);
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/email-settings') {
    auth.assertAuthorized(request);
    await sendJson(response, await email.getEmailSettings());
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/email-settings') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request);
    await sendJson(response, await email.saveEmailSettings(payload));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/email-test') {
    auth.assertAuthorized(request);
    await sendJson(response, await email.testEmailNotification());
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/email-check-now') {
    auth.assertAuthorized(request);
    await sendJson(response, await email.runLossOrderMonitor(true));
    return true;
  }

  return false;
}
