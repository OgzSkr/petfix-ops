import { readBearerToken } from '../../auth/index.js';
import { readJsonBody, sendJson } from '../../http/respond.js';
import { isOpsHubReady, getOpsHubPool, getOpsHubState } from '../bootstrap.js';
import {
  ingestMockOrder,
  ingestOpsOrder,
  buildShadowReport,
  getOrderMatchingView
} from '../ingest/ingest-service.js';
import {
  getOpsOrderById,
  listOpsOrders,
  countStaffOrders,
  countStaffOrdersByChannel
} from '../db/repository.js';
import { isStaffScope } from '../staff/staff-day.js';
import {
  getPickingOrderView,
  startPicking,
  scanPickingBarcode,
  pickPickingLine,
  completePicking,
  listPickingQueue,
  mapOrderRow,
  mapStaffOrderListRow
} from '../picking/picking-service.js';
import { maybeSyncGetirForStaffQueue } from '../sync/staff-queue-sync.js';
import {
  listChannelCatalogForOrder,
  replacePickingLine
} from '../picking/channel-catalog-service.js';
import { listMockOrders } from '../fixtures/mock-orders.js';
import { syncTgoReadOnly, buildIntegrationsHealth } from '../sync/tgo-sync.js';
import { syncYemeksepetiReadOnly } from '../sync/ys-sync.js';
import {
  applyChannelStatus,
  ensureTgoAcceptIfNeeded,
  getOpsHubPublicConfig
} from '../channel/channel-status-service.js';
import { submitBenimposSale, cancelBenimposSale, buildOpsBenimposSale, buildOpsBenimposPreviewPayload, maybeAutoSubmitBenimposSale } from '../benimpos/sale-outbox.js';
import { previewStockDrift, runStockSync } from '../stock/stock-sync-service.js';
import {
  getIntegrationDetail,
  listIntegrations,
  saveIntegration,
  testAndPersistIntegration
} from '../integrations/integration-service.js';
import { saveChannelCredentials } from '../../channels/credentials.js';
import { resolveBranchContext, buildBranchCookie } from '../branches/branch-context.js';
import { listBranchesForSubject } from '../branches/branch-service.js';
import { listCourierQueue, deliverCourierOrder } from '../courier/courier-service.js';
import {
  assertMobileAuditHeaders,
  logMobileAuditEvent,
  readMobileAuditHeaders
} from '../audit/mobile-audit.js';
import {
  upsertMobileDevice,
  updateMobileDeviceToken
} from '../notifications/mobile-device-repository.js';
import {
  isPushConfigured,
  sendTestPushNotification
} from '../notifications/push-service.js';
import {
  authenticateOpsRequest,
  assertMobileCourierRole,
  assertMobileDeliverRole,
  assertMobileOpsRole,
  assertMobilePickingRole
} from '../auth/mobile-auth.js';
import {
  staffLogin,
  staffLogout
} from '../staff/staff-auth-service.js';
import { createProductMatchingService } from '../../platform/services/product-matching.js';

const OPS_TO_REGISTRY = {
  trendyol_go: 'uber-eats',
  yemeksepeti: 'yemeksepeti',
  getir: 'getir'
};

function mapOpsConfigToRegistryValues(opsChannel, config = {}) {
  if (opsChannel === 'trendyol_go') {
    return {
      supplierId: config.sellerId ?? config.supplierId,
      storeId: config.storeId,
      apiKey: config.apiKey,
      apiSecret: config.apiSecret,
      autoAcceptOrders: config.autoAcceptOrders
    };
  }
  return config;
}
import { isOpsChannel } from '../constants.js';
import { readEnvFile, readPlatformConfigEnv } from '../../env.js';
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

  const pool = getOpsHubPool();
  const platformEnv = await readPlatformConfigEnv(paths.platformEnv);

  if (request.method === 'POST' && pathname === '/ops/v1/auth/staff-login') {
    const payload = await readJsonBody(request);
    try {
      const result = await staffLogin(pool, {
        username: payload.username,
        password: payload.password,
        deviceName: payload.deviceName
      });
      await sendJson(response, { ok: true, ...result });
    } catch (error) {
      await sendJson(response, { error: error.message }, error.statusCode || 500);
    }
    return true;
  }

  let mobileAuth;
  try {
    mobileAuth = await authenticateOpsRequest(ctx, pool, {
      pathname,
      platformEnv
    });
  } catch (error) {
    await sendJson(response, { error: error.message }, error.statusCode || 401);
    return true;
  }

  ctx.mobileAuth = mobileAuth;
  ctx.staffUser = mobileAuth.staffUser;
  ctx.platformEnv = platformEnv;

  if (request.method === 'POST' && pathname === '/ops/v1/auth/staff-logout') {
    const token = readBearerToken(request);
    if (mobileAuth.mode === 'staff' && token) {
      await staffLogout(pool, token);
    }
    await sendJson(response, { ok: true });
    return true;
  }

  if (request.method === 'GET' && pathname === '/ops/v1/auth/me') {
    if (mobileAuth.mode !== 'staff' || !mobileAuth.staffUser) {
      await sendJson(response, { error: 'Personel oturumu gerekli' }, 403);
      return true;
    }
    await sendJson(response, { ok: true, user: mobileAuth.staffUser });
    return true;
  }

  const staffUser = ctx.staffUser;

  if (request.method === 'GET' && pathname === '/ops/v1/branches') {
    const branchCtx = await resolveBranchContext(ctx, { pool, permission: 'read' });
    const data = await listBranchesForSubject(pool, platformEnv);
    await sendJson(response, {
      ...data,
      activeBranchId: branchCtx.branchId,
      activeRole: branchCtx.role
    });
    return true;
  }

  if (request.method === 'GET' && pathname === '/ops/v1/orders') {
    const branchCtx = await resolveBranchContext(ctx, { pool, permission: 'read' });
    const branchId = branchCtx.branchId;
    const queue = url.searchParams.get('queue');

    const liveOnly = ['1', 'true'].includes(String(url.searchParams.get('live') || '').toLowerCase());
    const since = url.searchParams.get('since') || undefined;
    const scope = url.searchParams.get('scope') || undefined;
    const staffDay = isStaffScope(scope);

    if (queue === 'picking') {
      assertMobilePickingRole(ctx);
      await maybeSyncGetirForStaffQueue(pool, platformEnv, { branchId });
      const orders = await listPickingQueue(pool, {
        branchId,
        limit: Number(url.searchParams.get('limit') || 50),
        liveOnly,
        since: staffDay ? undefined : since,
        staffDay
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
      limit: Number(url.searchParams.get('limit') || 50),
      liveOnly,
      since: staffDay ? undefined : since,
      staffDay
    });
    await sendJson(response, {
      ok: true,
      orders: orders.map((row) => mapStaffOrderListRow(row))
    });
    return true;
  }

  if (request.method === 'GET' && pathname === '/ops/v1/orders/staff-summary') {
    const branchCtx = await resolveBranchContext(ctx, { pool, permission: 'read' });
    const branchId = branchCtx.branchId;
    const [counts, byChannel] = await Promise.all([
      countStaffOrders(pool, { branchId, liveOnly: true }),
      countStaffOrdersByChannel(pool, { branchId, liveOnly: true })
    ]);
    await sendJson(response, {
      ok: true,
      staffDay: true,
      liveOnly: true,
      timezone: 'Europe/Istanbul',
      counts,
      byChannel
    });
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
    const config = await getOpsHubPublicConfig(platformEnv);
    await sendJson(response, { ok: true, config });
    return true;
  }

  if (request.method === 'GET' && pathname === '/ops/v1/courier/orders') {
    assertMobileCourierRole(ctx);
    const branchCtx = await resolveBranchContext(ctx, { pool, permission: 'read' });
    const liveOnly = ['1', 'true'].includes(String(url.searchParams.get('live') || '').toLowerCase());
    const since = url.searchParams.get('since') || undefined;
    const staffDay = isStaffScope(url.searchParams.get('scope') || undefined);
    const orders = await listCourierQueue(pool, {
      branchId: branchCtx.branchId,
      limit: Number(url.searchParams.get('limit') || 100),
      liveOnly,
      since: staffDay ? undefined : since,
      staffDay
    });
    await sendJson(response, { ok: true, orders });
    return true;
  }

  if (request.method === 'POST' && pathname === '/ops/v1/devices') {
    assertMobileOpsRole(ctx);
    const branchCtx = await resolveBranchContext(ctx, { pool, permission: 'write' });
    const audit = assertMobileAuditHeaders(request, staffUser);
    const payload = await readJsonBody(request);
    const staffName = payload.staffName || audit.staffName;
    const deviceName = payload.deviceName || audit.deviceName;
    await upsertMobileDevice(pool, {
      branchId: branchCtx.branchId,
      staffName,
      deviceName,
      platform: payload.platform || 'android',
      fcmToken: payload.fcmToken || null,
      staffUserId: staffUser?.id || null
    });
    await logMobileAuditEvent(pool, {
      branchId: branchCtx.branchId,
      eventType: 'mobile_device_register',
      audit,
      payload: {
        staffName,
        deviceName,
        platform: payload.platform || 'android'
      }
    });
    await sendJson(response, { ok: true });
    return true;
  }

  if (request.method === 'POST' && pathname === '/ops/v1/notifications/register') {
    assertMobileOpsRole(ctx);
    const branchCtx = await resolveBranchContext(ctx, { pool, permission: 'write' });
    const audit = readMobileAuditHeaders(request);
    const payload = await readJsonBody(request);
    const fcmToken = String(payload.fcmToken || '').trim();
    if (!fcmToken) {
      await sendJson(response, { error: 'fcmToken gerekli' }, 400);
      return true;
    }
    if (!audit.staffName || !audit.deviceName) {
      await sendJson(response, { error: 'X-Staff-Name ve X-Device-Name gerekli' }, 400);
      return true;
    }
    await upsertMobileDevice(pool, {
      branchId: branchCtx.branchId,
      staffName: audit.staffName,
      deviceName: audit.deviceName,
      platform: payload.platform || 'android',
      fcmToken,
      staffUserId: ctx.staffUser?.id || null
    });
    await sendJson(response, { ok: true });
    return true;
  }

  if (request.method === 'POST' && pathname === '/ops/v1/notifications/test') {
    const branchCtx = await resolveBranchContext(ctx, { pool, permission: 'write' });
    if (!isPushConfigured(platformEnv)) {
      await sendJson(response, {
        ok: false,
        error: 'FCM_SERVER_KEY yapılandırılmamış',
        hint: 'VPS .env.production içine FCM_SERVER_KEY ekleyin'
      }, 503);
      return true;
    }
    const result = await sendTestPushNotification(pool, {
      branchId: branchCtx.branchId,
      platformEnv
    });
    await sendJson(response, { ok: true, result });
    return true;
  }

  if (request.method === 'GET' && pathname === '/ops/v1/product-matching/masters/search') {
    assertMobilePickingRole(ctx);
    const q = url.searchParams.get('q') || '';
    const productMatching = createProductMatchingService();
    const data = await productMatching.searchMasters(q, 12);
    await sendJson(response, { ok: true, ...data });
    return true;
  }

  if (request.method === 'POST' && pathname === '/ops/v1/product-matching/confirm') {
    assertMobilePickingRole(ctx);
    const payload = await readJsonBody(request);
    const productMatching = createProductMatchingService();
    const result = await productMatching.confirmMapping({
      ...payload,
      source: payload.source || 'mobile_order_preview',
      ensureChannelProduct: payload.ensureChannelProduct !== false
    });
    await sendJson(response, result);
    return true;
  }

  if (pathname.startsWith('/ops/v1/integrations')) {
    const branchCtx = await resolveBranchContext(ctx, { pool, permission: 'read' });
    const branchId = branchCtx.branchId;

    if (request.method === 'GET' && pathname === '/ops/v1/integrations') {
      const data = await listIntegrations(pool, { branchId, platformEnv });
      await sendJson(response, { ok: true, branchId, ...data });
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
        await sendJson(response, { ok: true, branchId, ...detail });
        return true;
      }

      if (request.method === 'PUT' && !parsed.sub) {
        const writeCtx = await resolveBranchContext(ctx, { pool, permission: 'write' });
        const payload = await readJsonBody(request);
        try {
          const registryChannel = OPS_TO_REGISTRY[parsed.channel];
          if (registryChannel) {
            await saveChannelCredentials({
              channel: registryChannel,
              branchId: writeCtx.branchId,
              values: mapOpsConfigToRegistryValues(parsed.channel, payload.config || payload),
              options: {
                platformEnv,
                enabled: payload.enabled,
                probe: false
              }
            });
          }
          const result = await saveIntegration(pool, parsed.channel, payload, {
            branchId: writeCtx.branchId,
            platformEnv
          });
          await sendJson(response, { ...result, branchId: writeCtx.branchId });
        } catch (error) {
          await sendJson(response, { error: error.message }, error.statusCode || 400);
        }
        return true;
      }

      if (parsed.sub === 'test' && request.method === 'POST') {
        const writeCtx = await resolveBranchContext(ctx, { pool, permission: 'write' });
        const payload = await readJsonBody(request);
        const result = await testAndPersistIntegration(pool, parsed.channel, payload, {
          branchId: writeCtx.branchId,
          platformEnv
        });
        await sendJson(response, { ok: result.ok, branchId: writeCtx.branchId, ...result }, result.ok ? 200 : 422);
        return true;
      }
    }
  }

  if (request.method === 'GET' && pathname === '/ops/v1/integrations/health') {
    const health = await buildIntegrationsHealth(platformEnv);
    await sendJson(response, { ok: true, ...health });
    return true;
  }

  if (request.method === 'POST' && pathname === '/ops/v1/sync/trendyol-go') {
    const payload = await readJsonBody(request);
    const branchCtx = await resolveBranchContext(ctx, { pool, permission: 'write' });
    const result = await syncTgoReadOnly(pool, {
      ...payload,
      platformEnv,
      branchId: branchCtx.branchId,
      shadowMode: payload.shadowMode ?? true,
      activeOnly: payload.activeOnly ?? false
    });
    await sendJson(response, { ok: true, result });
    return true;
  }

  if (request.method === 'POST' && pathname === '/ops/v1/sync/yemeksepeti') {
    const payload = await readJsonBody(request);
    const branchCtx = await resolveBranchContext(ctx, { pool, permission: 'write' });
    const result = await syncYemeksepetiReadOnly(pool, {
      ...payload,
      platformEnv,
      branchId: branchCtx.branchId,
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
    const plan = await previewStockDrift(opsChannel, {
      platformEnv,
      maxItems: url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined
    });
    await sendJson(response, { ok: true, plan });
    return true;
  }

  if (request.method === 'POST' && pathname === '/ops/v1/stock/sync') {
    const payload = await readJsonBody(request);
    const branchCtx = await resolveBranchContext(ctx, { pool, permission: 'write' });
    const branchId = payload.branchId || branchCtx.branchId;
    try {
      const result = await runStockSync(pool, {
        channel: payload.channel,
        platformEnv,
        branchId,
        forceLive: payload.forceLive === true,
        maxItems: payload.maxItems,
        barcodes: payload.barcodes,
        minCoveragePercent: payload.minCoveragePercent,
        mode: payload.mode,
        customPrice: payload.customPrice
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

    if (parsed.sub === 'picking/catalog' && request.method === 'GET') {
      assertMobilePickingRole(ctx);
      const catalog = await listChannelCatalogForOrder(pool, parsed.orderId, {
        search: url.searchParams.get('q') || undefined,
        limit: Number(url.searchParams.get('limit') || 80)
      });
      if (!catalog) {
        await sendJson(response, { error: 'Sipariş bulunamadı' }, 404);
        return true;
      }
      await sendJson(response, { ok: true, ...catalog });
      return true;
    }

    const linePickMatch = parsed.sub?.match(/^picking\/lines\/([^/]+)\/pick$/);
    if (linePickMatch && request.method === 'POST') {
      assertMobilePickingRole(ctx);
      const audit = assertMobileAuditHeaders(request, staffUser);
      const payload = await readJsonBody(request);
      try {
        const detail = await pickPickingLine(
          pool,
          parsed.orderId,
          linePickMatch[1],
          payload.qty
        );
        if (!detail) {
          await sendJson(response, { error: 'Sipariş bulunamadı' }, 404);
          return true;
        }
        await logMobileAuditEvent(pool, {
          branchId: detail.order.branch_id,
          orderId: parsed.orderId,
          eventType: 'mobile_picking_line_pick',
          audit,
          payload: { lineId: linePickMatch[1], manual: true }
        });
        const view = await getPickingOrderView(pool, parsed.orderId);
        await sendJson(response, { ok: true, ...view });
      } catch (error) {
        await sendJson(
          response,
          { error: error.message || 'Ürün toplanamadı' },
          error.statusCode || 500
        );
      }
      return true;
    }

    const lineReplaceMatch = parsed.sub?.match(/^picking\/lines\/([^/]+)\/replace$/);
    if (lineReplaceMatch && request.method === 'POST') {
      assertMobilePickingRole(ctx);
      const audit = assertMobileAuditHeaders(request, staffUser);
      const payload = await readJsonBody(request);
      try {
        const detail = await replacePickingLine(pool, parsed.orderId, lineReplaceMatch[1], {
          channelProductId: payload.channelProductId
        });
        if (!detail) {
          await sendJson(response, { error: 'Sipariş bulunamadı' }, 404);
          return true;
        }
        await logMobileAuditEvent(pool, {
          branchId: detail.order.branch_id,
          orderId: parsed.orderId,
          eventType: 'mobile_picking_line_replace',
          audit,
          payload: {
            lineId: lineReplaceMatch[1],
            channelProductId: payload.channelProductId
          }
        });
        const view = await getPickingOrderView(pool, parsed.orderId);
        await sendJson(response, { ok: true, ...view });
      } catch (error) {
        await sendJson(
          response,
          { error: error.message || 'Ürün değiştirilemedi' },
          error.statusCode || 500
        );
      }
      return true;
    }

    if (parsed.sub === 'picking' || parsed.sub?.startsWith('picking/')) {
      assertMobilePickingRole(ctx);
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
        const audit = assertMobileAuditHeaders(request, staffUser);
        const platformEnv = await readPlatformConfigEnv(paths.platformEnv);
        await ensureTgoAcceptIfNeeded(pool, parsed.orderId, { platformEnv });
        const detail = await startPicking(pool, parsed.orderId);
        if (!detail) {
          await sendJson(response, { error: 'Sipariş bulunamadı' }, 404);
          return true;
        }
        await logMobileAuditEvent(pool, {
          branchId: detail.order.branch_id,
          orderId: parsed.orderId,
          eventType: 'mobile_picking_start',
          audit
        });
        const view = await getPickingOrderView(pool, parsed.orderId);
        await sendJson(response, { ok: true, ...view });
        return true;
      }

      if (request.method === 'POST' && pickingAction === 'scan') {
        const audit = assertMobileAuditHeaders(request, staffUser);
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
        await logMobileAuditEvent(pool, {
          branchId: detail.order.branch_id,
          orderId: parsed.orderId,
          eventType: 'mobile_picking_scan',
          audit,
          payload: { barcode: payload.barcode }
        });
        const view = await getPickingOrderView(pool, parsed.orderId);
        await sendJson(response, { ok: true, ...view });
        return true;
      }

      if (request.method === 'POST' && pickingAction === 'complete') {
        const audit = assertMobileAuditHeaders(request, staffUser);
        const platformEnv = await readPlatformConfigEnv(paths.platformEnv);
        await ensureTgoAcceptIfNeeded(pool, parsed.orderId, { platformEnv });
        const detail = await completePicking(pool, parsed.orderId);
        if (!detail) {
          await sendJson(response, { error: 'Sipariş bulunamadı' }, 404);
          return true;
        }
        const autoSale = await maybeAutoSubmitBenimposSale(pool, parsed.orderId, platformEnv);
        let autoDispatch = null;
        try {
          autoDispatch = await applyChannelStatus(pool, parsed.orderId, 'ready', { platformEnv });
        } catch (error) {
          autoDispatch = { ok: false, error: error.message };
        }
        await logMobileAuditEvent(pool, {
          branchId: detail.order.branch_id,
          orderId: parsed.orderId,
          eventType: 'mobile_picking_complete',
          audit
        });
        const view = await getPickingOrderView(pool, parsed.orderId);
        await sendJson(response, { ok: true, ...view, autoSale, autoDispatch });
        return true;
      }
    }

    if (parsed.sub === 'channel/accept' && request.method === 'POST') {
      assertMobilePickingRole(ctx);
      const platformEnv = await readEnvFile(paths.platformEnv);
      const audit = assertMobileAuditHeaders(request, staffUser);
      const payload = await readJsonBody(request);
      const result = await applyChannelStatus(pool, parsed.orderId, 'accept', {
        platformEnv,
        forceLive: payload.forceLive === true
      });
      if (!result) {
        await sendJson(response, { error: 'Sipariş bulunamadı' }, 404);
        return true;
      }
      const detail = await getOpsOrderById(pool, parsed.orderId);
      await logMobileAuditEvent(pool, {
        branchId: detail.order.branch_id,
        orderId: parsed.orderId,
        eventType: 'mobile_channel_accept',
        audit
      });
      await sendJson(response, { ok: true, ...result });
      return true;
    }

    if (parsed.sub === 'channel/ready' && request.method === 'POST') {
      assertMobilePickingRole(ctx);
      const platformEnv = await readEnvFile(paths.platformEnv);
      const audit = assertMobileAuditHeaders(request, staffUser);
      const payload = await readJsonBody(request);
      const result = await applyChannelStatus(pool, parsed.orderId, 'ready', {
        platformEnv,
        forceLive: payload.forceLive === true
      });
      if (!result) {
        await sendJson(response, { error: 'Sipariş bulunamadı' }, 404);
        return true;
      }
      const detail = await getOpsOrderById(pool, parsed.orderId);
      await logMobileAuditEvent(pool, {
        branchId: detail.order.branch_id,
        orderId: parsed.orderId,
        eventType: 'mobile_channel_ready',
        audit
      });
      await sendJson(response, { ok: true, ...result });
      return true;
    }

    if (parsed.sub === 'courier/deliver' && request.method === 'POST') {
      assertMobileDeliverRole(ctx);
      const audit = assertMobileAuditHeaders(request, staffUser);
      try {
        const platformEnv = await readEnvFile(paths.platformEnv);
        const result = await deliverCourierOrder(pool, parsed.orderId, audit, { platformEnv });
        if (!result) {
          await sendJson(response, { error: 'Sipariş bulunamadı' }, 404);
          return true;
        }
        await sendJson(response, result);
      } catch (error) {
        await sendJson(response, { error: error.message }, error.statusCode || 500);
      }
      return true;
    }

    if (parsed.sub === 'benimpos/sale' && request.method === 'POST') {
      assertMobilePickingRole(ctx);
      const platformEnv = await readPlatformConfigEnv(paths.platformEnv);
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
      assertMobilePickingRole(ctx);
      const platformEnv = await readPlatformConfigEnv(paths.platformEnv);
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
      assertMobilePickingRole(ctx);
      const platformEnv = await readEnvFile(paths.platformEnv);
      try {
        const body = await buildOpsBenimposPreviewPayload(pool, parsed.orderId, platformEnv);
        if (!body) {
          await sendJson(response, { error: 'Sipariş bulunamadı' }, 404);
          return true;
        }
        await sendJson(response, body);
      } catch (error) {
        await sendJson(response, { error: error.message }, error.statusCode || 500);
      }
      return true;
    }
  }

  return false;
}
