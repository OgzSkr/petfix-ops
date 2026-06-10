import { readJsonBody, sendJson } from '../../http/respond.js';
import { isOpsHubReady, getOpsHubPool, getOpsHubState } from '../bootstrap.js';
import {
  ingestMockOrder,
  ingestOpsOrder,
  buildShadowReport,
  getOrderMatchingView
} from '../ingest/ingest-service.js';
import { getOpsOrderById, listOpsOrders } from '../db/repository.js';
import {
  getPickingOrderView,
  startPicking,
  scanPickingBarcode,
  completePicking,
  listPickingQueue,
  mapOrderRow
} from '../picking/picking-service.js';
import { listMockOrders } from '../fixtures/mock-orders.js';
import { syncTgoReadOnly, buildIntegrationsHealth } from '../sync/tgo-sync.js';
import { syncYemeksepetiReadOnly } from '../sync/ys-sync.js';
import {
  applyChannelStatus,
  getOpsHubPublicConfig
} from '../channel/channel-status-service.js';
import { submitBenimposSale, cancelBenimposSale, buildOpsBenimposSale } from '../benimpos/sale-outbox.js';
import { previewStockDrift, runStockSync } from '../stock/stock-sync-service.js';
import {
  getIntegrationDetail,
  listIntegrations,
  saveIntegration,
  testAndPersistIntegration
} from '../integrations/integration-service.js';
import { isOpsChannel } from '../constants.js';
import { readEnvFile } from '../../env.js';
import { paths } from '../../config.js';
import { buildReadinessReport } from '../../production/readiness.js';

function parseIntegrationChannel(pathname) {
  const match = pathname.match(/^\/ops\/v1\/integrations\/([^/]+)(?:\/(.*))?$/);
  if (!match) {
    return null;
  }
  return { channel: match[1], sub: match[2] || null };
}

function parseOrderId(pathname) {
  const match = pathname.match(/^\/ops\/v1\/orders\/([^/]+)(?:\/(.*))?$/);
  if (!match) {
    return null;
  }
  return { orderId: match[1], sub: match[2] || null };
}

export async function handleOpsHubRoutes(ctx) {
  const { request, response, url, auth } = ctx;
  const { pathname } = url;

  if (request.method === 'GET' && pathname === '/health') {
    await sendJson(response, {
      ok: true,
      status: 'alive',
      service: 'petfix-ops-hub',
      uptimeSeconds: Math.round(process.uptime())
    });
    return true;
  }

  if (request.method === 'GET' && pathname === '/ready') {
    const state = getOpsHubState();
    let pool = null;
    try {
      pool = getOpsHubPool();
    } catch {
      pool = null;
    }
    const platformEnv = await readEnvFile(paths.platformEnv);
    const report = await buildReadinessReport(pool, platformEnv);
    const ready = report.status === 'ready';
    await sendJson(response, report, ready ? 200 : 503);
    return true;
  }

  if (!pathname.startsWith('/ops/v1/')) {
    return false;
  }

  auth.assertAuthorized(request);
  const pool = getOpsHubPool();

  if (request.method === 'GET' && pathname === '/ops/v1/orders') {
    const branchId = url.searchParams.get('branch') || getOpsHubState().branch?.id;
    const queue = url.searchParams.get('queue');

    if (queue === 'picking') {
      const orders = await listPickingQueue(pool, {
        branchId,
        limit: Number(url.searchParams.get('limit') || 50)
      });
      const channel = url.searchParams.get('channel');
      const filtered = channel ? orders.filter((row) => row.channel === channel) : orders;
      await sendJson(response, { ok: true, orders: filtered });
      return true;
    }

    const orders = await listOpsOrders(pool, {
      branchId,
      channel: url.searchParams.get('channel') || undefined,
      status: url.searchParams.get('status') || undefined,
      limit: Number(url.searchParams.get('limit') || 50)
    });
    await sendJson(response, { ok: true, orders: orders.map(mapOrderRow) });
    return true;
  }

  if (request.method === 'GET' && pathname === '/ops/v1/shadow/report') {
    const report = await buildShadowReport(pool, {
      branchSlug: url.searchParams.get('branch') || 'main'
    });
    await sendJson(response, { ok: true, report });
    return true;
  }

  if (request.method === 'GET' && pathname === '/ops/v1/config') {
    const platformEnv = await readEnvFile(paths.platformEnv);
    const config = await getOpsHubPublicConfig(platformEnv);
    await sendJson(response, { ok: true, config });
    return true;
  }

  if (pathname.startsWith('/ops/v1/integrations')) {
    const branchId = getOpsHubState().branch?.id;
    const platformEnv = await readEnvFile(paths.platformEnv);

    if (request.method === 'GET' && pathname === '/ops/v1/integrations') {
      const data = await listIntegrations(pool, { branchId, platformEnv });
      await sendJson(response, { ok: true, ...data });
      return true;
    }

    const parsed = parseIntegrationChannel(pathname);
    if (parsed?.channel && isOpsChannel(parsed.channel)) {
      if (request.method === 'GET' && !parsed.sub) {
        const detail = await getIntegrationDetail(pool, parsed.channel, { branchId, platformEnv });
        if (!detail) {
          await sendJson(response, { error: 'Kanal bulunamadı' }, 404);
          return true;
        }
        await sendJson(response, { ok: true, ...detail });
        return true;
      }

      if (request.method === 'PUT' && !parsed.sub) {
        const payload = await readJsonBody(request);
        try {
          const result = await saveIntegration(pool, parsed.channel, payload, {
            branchId,
            platformEnv
          });
          await sendJson(response, result);
        } catch (error) {
          await sendJson(response, { error: error.message }, error.statusCode || 400);
        }
        return true;
      }

      if (parsed.sub === 'test' && request.method === 'POST') {
        const payload = await readJsonBody(request);
        const result = await testAndPersistIntegration(pool, parsed.channel, payload, {
          branchId,
          platformEnv
        });
        await sendJson(response, { ok: result.ok, ...result }, result.ok ? 200 : 422);
        return true;
      }
    }
  }

  if (request.method === 'GET' && pathname === '/ops/v1/integrations/health') {
    const platformEnv = await readEnvFile(paths.platformEnv);
    const health = await buildIntegrationsHealth(platformEnv);
    await sendJson(response, { ok: true, ...health });
    return true;
  }

  if (request.method === 'POST' && pathname === '/ops/v1/sync/trendyol-go') {
    const payload = await readJsonBody(request);
    const platformEnv = await readEnvFile(paths.platformEnv);
    const result = await syncTgoReadOnly(pool, {
      ...payload,
      platformEnv,
      branchId: getOpsHubState().branch?.id,
      shadowMode: payload.shadowMode ?? true,
      activeOnly: payload.activeOnly ?? false
    });
    await sendJson(response, { ok: true, result });
    return true;
  }

  if (request.method === 'POST' && pathname === '/ops/v1/sync/yemeksepeti') {
    const payload = await readJsonBody(request);
    const platformEnv = await readEnvFile(paths.platformEnv);
    const result = await syncYemeksepetiReadOnly(pool, {
      ...payload,
      platformEnv,
      branchId: getOpsHubState().branch?.id,
      shadowMode: payload.shadowMode ?? true,
      days: payload.days ?? 7
    });
    await sendJson(response, { ok: true, result });
    return true;
  }

  if (request.method === 'GET' && pathname === '/ops/v1/stock/drift') {
    const opsChannel = url.searchParams.get('channel');
    if (!opsChannel) {
      await sendJson(response, { error: 'channel query param zorunlu' }, 400);
      return true;
    }
    const platformEnv = await readEnvFile(paths.platformEnv);
    const plan = await previewStockDrift(opsChannel, {
      platformEnv,
      maxItems: url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined
    });
    await sendJson(response, { ok: true, plan });
    return true;
  }

  if (request.method === 'POST' && pathname === '/ops/v1/stock/sync') {
    const payload = await readJsonBody(request);
    const platformEnv = await readEnvFile(paths.platformEnv);
    const branchId = payload.branchId || getOpsHubState().branch?.id;
    try {
      const result = await runStockSync(pool, {
        channel: payload.channel,
        platformEnv,
        branchId,
        forceLive: payload.forceLive === true,
        maxItems: payload.maxItems,
        barcodes: payload.barcodes,
        minCoveragePercent: payload.minCoveragePercent
      });
      await sendJson(response, result);
    } catch (error) {
      const status = error.statusCode || 500;
      await sendJson(
        response,
        { error: error.message, plan: error.plan || undefined },
        status
      );
    }
    return true;
  }

  if (request.method === 'GET' && pathname === '/ops/v1/mock/fixtures') {
    await sendJson(response, { ok: true, fixtures: listMockOrders() });
    return true;
  }

  if (request.method === 'POST' && pathname === '/ops/v1/orders/ingest/mock') {
    const payload = await readJsonBody(request);
    const result = await ingestMockOrder(pool, {
      fixtureKey: payload.fixtureKey,
      order: payload.order,
      shadowModeDefault: payload.shadowMode ?? true
    });
    await sendJson(response, { ok: true, ...result }, result.duplicate ? 200 : 201);
    return true;
  }

  if (request.method === 'POST' && pathname === '/ops/v1/orders/ingest') {
    const payload = await readJsonBody(request);
    const result = await ingestOpsOrder(pool, payload.order || payload, {
      shadowModeDefault: payload.shadowMode ?? true
    });
    await sendJson(response, { ok: true, ...result }, result.duplicate ? 200 : 201);
    return true;
  }

  const parsed = parseOrderId(pathname);
  if (parsed?.orderId && parsed.orderId !== 'ingest') {
    if (request.method === 'GET' && !parsed.sub) {
      const detail = await getOpsOrderById(pool, parsed.orderId);
      if (!detail) {
        await sendJson(response, { error: 'Sipariş bulunamadı' }, 404);
        return true;
      }
      await sendJson(response, { ok: true, ...detail });
      return true;
    }

    if (request.method === 'GET' && parsed.sub === 'matching') {
      const matching = await getOrderMatchingView(pool, parsed.orderId);
      if (!matching) {
        await sendJson(response, { error: 'Sipariş bulunamadı' }, 404);
        return true;
      }
      await sendJson(response, { ok: true, matching });
      return true;
    }

    if (parsed.sub === 'picking' || parsed.sub?.startsWith('picking/')) {
      const pickingAction = parsed.sub === 'picking' ? null : parsed.sub.replace(/^picking\//, '');

      if (request.method === 'GET' && !pickingAction) {
        const view = await getPickingOrderView(pool, parsed.orderId);
        if (!view) {
          await sendJson(response, { error: 'Sipariş bulunamadı' }, 404);
          return true;
        }
        await sendJson(response, { ok: true, ...view });
        return true;
      }

      if (request.method === 'POST' && pickingAction === 'start') {
        const detail = await startPicking(pool, parsed.orderId);
        if (!detail) {
          await sendJson(response, { error: 'Sipariş bulunamadı' }, 404);
          return true;
        }
        const view = await getPickingOrderView(pool, parsed.orderId);
        await sendJson(response, { ok: true, ...view });
        return true;
      }

      if (request.method === 'POST' && pickingAction === 'scan') {
        const payload = await readJsonBody(request);
        const detail = await scanPickingBarcode(
          pool,
          parsed.orderId,
          payload.barcode,
          payload.qty
        );
        if (!detail) {
          await sendJson(response, { error: 'Sipariş bulunamadı' }, 404);
          return true;
        }
        const view = await getPickingOrderView(pool, parsed.orderId);
        await sendJson(response, { ok: true, ...view });
        return true;
      }

      if (request.method === 'POST' && pickingAction === 'complete') {
        const detail = await completePicking(pool, parsed.orderId);
        if (!detail) {
          await sendJson(response, { error: 'Sipariş bulunamadı' }, 404);
          return true;
        }
        const view = await getPickingOrderView(pool, parsed.orderId);
        await sendJson(response, { ok: true, ...view });
        return true;
      }
    }

    if (parsed.sub === 'channel/accept' && request.method === 'POST') {
      const platformEnv = await readEnvFile(paths.platformEnv);
      const payload = await readJsonBody(request);
      const result = await applyChannelStatus(pool, parsed.orderId, 'accept', {
        platformEnv,
        forceLive: payload.forceLive === true
      });
      if (!result) {
        await sendJson(response, { error: 'Sipariş bulunamadı' }, 404);
        return true;
      }
      await sendJson(response, { ok: true, ...result });
      return true;
    }

    if (parsed.sub === 'channel/ready' && request.method === 'POST') {
      const platformEnv = await readEnvFile(paths.platformEnv);
      const payload = await readJsonBody(request);
      const result = await applyChannelStatus(pool, parsed.orderId, 'ready', {
        platformEnv,
        forceLive: payload.forceLive === true
      });
      if (!result) {
        await sendJson(response, { error: 'Sipariş bulunamadı' }, 404);
        return true;
      }
      await sendJson(response, { ok: true, ...result });
      return true;
    }

    if (parsed.sub === 'benimpos/sale' && request.method === 'POST') {
      const platformEnv = await readEnvFile(paths.platformEnv);
      const payload = await readJsonBody(request);
      const result = await submitBenimposSale(pool, parsed.orderId, {
        platformEnv,
        forceLive: payload.forceLive === true
      });
      if (!result) {
        await sendJson(response, { error: 'Sipariş bulunamadı' }, 404);
        return true;
      }
      await sendJson(response, { ok: true, ...result });
      return true;
    }

    if (parsed.sub === 'benimpos/cancel' && request.method === 'POST') {
      const platformEnv = await readEnvFile(paths.platformEnv);
      const payload = await readJsonBody(request);
      const result = await cancelBenimposSale(pool, parsed.orderId, {
        platformEnv,
        forceLive: payload.forceLive === true
      });
      if (!result) {
        await sendJson(response, { error: 'Sipariş bulunamadı' }, 404);
        return true;
      }
      await sendJson(response, { ok: true, ...result });
      return true;
    }

    if (parsed.sub === 'benimpos/preview' && request.method === 'GET') {
      const platformEnv = await readEnvFile(paths.platformEnv);
      const preview = await buildOpsBenimposSale(pool, parsed.orderId, platformEnv);
      if (!preview) {
        await sendJson(response, { error: 'Sipariş bulunamadı' }, 404);
        return true;
      }
      await sendJson(response, {
        ok: true,
        payload: preview.built.payload,
        saleLines: preview.built.saleLines,
        skippedLines: preview.built.skippedLines
      });
      return true;
    }
  }

  return false;
}
