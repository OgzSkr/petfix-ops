import { readJsonBody, sendJson } from '../../http/respond.js';
import { listChannels, getChannelsHealth, getChannelAdapter } from '../../channels/registry.js';
import { saveChannelCredentials } from '../../channels/credentials.js';
import { readEnvFile } from '../../env.js';
import { paths } from '../../config.js';
import { bootstrapOpsHub, getOpsHubPool, isOpsHubReady } from '../../ops-hub/bootstrap.js';
import {
  resolveBranchContext,
  buildBranchCookie
} from '../../ops-hub/branches/branch-context.js';
import { isSecureRequest } from '../../auth/session-cookie.js';
import {
  listBranchesForSubject,
  createBranchForTenant,
  listRbacGrants,
  upsertRbacGrant
} from '../../ops-hub/branches/branch-service.js';
import {
  getBranchById,
  getBranchGrant,
  roleAllows
} from '../../ops-hub/branches/branch-repository.js';
import { resolveRbacSubjectKey } from '../../ops-hub/branches/branch-context.js';
import { resolveProductThumb } from '../../product-thumb.js';
import { buildDataIntegrityAudit } from '../services/data-integrity-audit.js';
import {
  createStaffUserForPanel,
  getStaffMobileAcceptWarning,
  listStaffUsersForPanel,
  resetStaffUserPasswordForPanel,
  revokeStaffUserSessionsForPanel,
  setStaffUserActiveForPanel,
  unlockStaffUserForPanel,
  updateStaffUserForPanel
} from '../../ops-hub/staff/staff-admin-service.js';
import {
  isLegacyMarketplaceApiPath,
  legacyMarketplaceRouteMessage
} from '../../production/deploy-profile.js';

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
    channelOrders,
    hzlmrktopsOrders,
    channelsSummary,
    channelSettings,
    benimpos,
    productMatching,
    ops,
    actionCenter,
    uberOps,
    channelMatchingOps,
    matchingSync,
    opsPollSync,
    opsPreferences,
    stockAutoSync,
    channelControl,
    opsActivityFeed,
    opsSystemMode
  } = ctx;

  if (isLegacyMarketplaceApiPath(url.pathname)) {
    await sendJson(response, { error: legacyMarketplaceRouteMessage() }, 404);
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/channels/control-board') {
    auth.assertAuthorized(request);
    await sendJson(response, await channelControl.buildControlBoard());
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/channels/control/actions') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request).catch(() => ({}));
    await sendJson(response, await channelControl.runAction(String(payload.action || '')));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/channels/credentials') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request).catch(() => ({}));
    const platformEnv = await readEnvFile(paths.platformEnv);
    let branchId = payload.branchId || null;
    if (!branchId && isOpsHubReady()) {
      const pool = getOpsHubPool();
      const branchCtx = await resolveBranchContext(ctx, { pool, permission: 'write' });
      branchId = branchCtx.branchId;
    }
    const result = await saveChannelCredentials({
      channel: payload.channel,
      branchId,
      values: payload.values || {},
      options: { enabled: payload.enabled, probe: payload.probe !== false, platformEnv }
    });
    await sendJson(response, result);
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/ops/poll/settings') {
    auth.assertAuthorized(request);
    await sendJson(response, await opsPollSync.getSettings());
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/ops/poll/settings') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request).catch(() => ({}));
    await sendJson(response, await opsPollSync.saveSettings(payload));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/ops/poll/run') {
    auth.assertAuthorized(request);
    await sendJson(response, await opsPollSync.runPoll(true));
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/ops/preferences') {
    auth.assertAuthorized(request);
    await sendJson(response, await opsPreferences.getPreferences());
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/ops/preferences') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request).catch(() => ({}));
    await sendJson(response, await opsPreferences.savePreferences(payload));
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/ops/stock-auto-sync/settings') {
    auth.assertAuthorized(request);
    await sendJson(response, await stockAutoSync.getSettings());
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/ops/stock-auto-sync/run') {
    auth.assertAuthorized(request);
    await sendJson(response, await stockAutoSync.runAutoStockSync(true));
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/ops/branches') {
    auth.assertAuthorized(request);
    const platformEnv = await readEnvFile(paths.platformEnv);
    if (!isOpsHubReady()) await bootstrapOpsHub(platformEnv);
    const pool = getOpsHubPool();
    const branchCtx = await resolveBranchContext(ctx, { pool, permission: 'read' });
    const data = await listBranchesForSubject(pool, platformEnv);
    await sendJson(response, { ...data, activeBranchId: branchCtx.branchId, activeRole: branchCtx.role });
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/ops/branches/active') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request).catch(() => ({}));
    const branchId = String(payload.branchId || '').trim();
    if (!branchId) {
      await sendJson(response, { error: 'branchId zorunlu' }, 400);
      return true;
    }
    const platformEnv = await readEnvFile(paths.platformEnv);
    if (!isOpsHubReady()) await bootstrapOpsHub(platformEnv);
    const pool = getOpsHubPool();
    const branch = await getBranchById(pool, branchId);
    if (!branch) {
      await sendJson(response, { error: 'Şube bulunamadı' }, 404);
      return true;
    }
    const grant = await getBranchGrant(pool, { branchId, subjectKey: resolveRbacSubjectKey() });
    if (!grant || !roleAllows(grant.role, 'read')) {
      await sendJson(response, { error: 'Bu şube için yetkiniz yok' }, 403);
      return true;
    }
    response.setHeader(
      'Set-Cookie',
      buildBranchCookie(branchId, { secure: isSecureRequest(request) })
    );
    await sendJson(response, { ok: true, branchId, role: grant.role });
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/ops/branches') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request).catch(() => ({}));
    const platformEnv = await readEnvFile(paths.platformEnv);
    if (!isOpsHubReady()) await bootstrapOpsHub(platformEnv);
    const pool = getOpsHubPool();
    const branchCtx = await resolveBranchContext(ctx, { pool, permission: 'admin' });
    const result = await createBranchForTenant(pool, payload, { role: branchCtx.role });
    await sendJson(response, result, 201);
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/ops/rbac/grants') {
    auth.assertAuthorized(request);
    const platformEnv = await readEnvFile(paths.platformEnv);
    if (!isOpsHubReady()) await bootstrapOpsHub(platformEnv);
    const pool = getOpsHubPool();
    await resolveBranchContext(ctx, { pool, permission: 'admin', platformEnv });
    const branchFilter = url.searchParams.get('branch') || undefined;
    await sendJson(response, await listRbacGrants(pool, { branchId: branchFilter }));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/ops/rbac/grants') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request).catch(() => ({}));
    const platformEnv = await readEnvFile(paths.platformEnv);
    if (!isOpsHubReady()) await bootstrapOpsHub(platformEnv);
    const pool = getOpsHubPool();
    const branchCtx = await resolveBranchContext(ctx, { pool, permission: 'admin', platformEnv });
    const result = await upsertRbacGrant(pool, payload, { role: branchCtx.role });
    await sendJson(response, result);
    return true;
  }

  if (url.pathname.startsWith('/api/ops/staff-users')) {
    auth.assertAuthorized(request);
    const platformEnv = await readEnvFile(paths.platformEnv);
    if (!isOpsHubReady()) await bootstrapOpsHub(platformEnv);
    const pool = getOpsHubPool();
    const branchCtx = await resolveBranchContext(ctx, { pool, permission: 'admin', platformEnv });

    if (request.method === 'GET' && url.pathname === '/api/ops/staff-users/accept-warning') {
      await sendJson(response, await getStaffMobileAcceptWarning(pool, branchCtx.branchId, { platformEnv }));
      return true;
    }

    if (request.method === 'GET' && url.pathname === '/api/ops/staff-users') {
      await sendJson(response, await listStaffUsersForPanel(pool, branchCtx.branchId));
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/ops/staff-users') {
      const payload = await readJsonBody(request).catch(() => ({}));
      try {
        const result = await createStaffUserForPanel(pool, branchCtx.branchId, payload);
        await sendJson(response, result, 201);
      } catch (error) {
        await sendJson(response, { error: error.message }, error.statusCode || 500);
      }
      return true;
    }

    const staffMatch = url.pathname.match(/^\/api\/ops\/staff-users\/([^/]+)(?:\/(.+))?$/);
    if (staffMatch) {
      const userId = decodeURIComponent(staffMatch[1]);
      const action = staffMatch[2] || null;

      if (request.method === 'PATCH' && !action) {
        const payload = await readJsonBody(request).catch(() => ({}));
        try {
          if (typeof payload.active === 'boolean') {
            await setStaffUserActiveForPanel(pool, branchCtx.branchId, userId, payload.active);
          }
          const result = payload.displayName != null || payload.role != null
            ? await updateStaffUserForPanel(pool, branchCtx.branchId, userId, payload)
            : { ok: true };
          await sendJson(response, result);
        } catch (error) {
          await sendJson(response, { error: error.message }, error.statusCode || 500);
        }
        return true;
      }

      if (request.method === 'POST' && action === 'reset-password') {
        const payload = await readJsonBody(request).catch(() => ({}));
        try {
          await resetStaffUserPasswordForPanel(pool, branchCtx.branchId, userId, payload.password);
          await sendJson(response, { ok: true });
        } catch (error) {
          await sendJson(response, { error: error.message }, error.statusCode || 500);
        }
        return true;
      }

      if (request.method === 'POST' && action === 'revoke-sessions') {
        try {
          await sendJson(response, await revokeStaffUserSessionsForPanel(pool, branchCtx.branchId, userId));
        } catch (error) {
          await sendJson(response, { error: error.message }, error.statusCode || 500);
        }
        return true;
      }

      if (request.method === 'POST' && action === 'unlock') {
        try {
          await sendJson(response, await unlockStaffUserForPanel(pool, branchCtx.branchId, userId));
        } catch (error) {
          await sendJson(response, { error: error.message }, error.statusCode || 500);
        }
        return true;
      }
    }
  }

  if (request.method === 'GET' && url.pathname === '/api/dashboard/channels-summary') {
    auth.assertAuthorized(request);
    await sendJson(response, await channelsSummary.buildChannelsSummary(url.searchParams));
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/dashboard/action-center') {
    auth.assertAuthorized(request);
    await sendJson(response, await actionCenter.buildActionCenter(url.searchParams));
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

  if (request.method === 'GET' && url.pathname === '/api/ops/system-mode') {
    auth.assertAuthorized(request);
    await sendJson(response, await opsSystemMode.buildSystemMode());
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/ops/activity-feed') {
    auth.assertAuthorized(request);
    const limit = url.searchParams.get('limit') || 50;
    const includeShadow = url.searchParams.get('shadow') !== '0';
    const branchSlug = url.searchParams.get('branch') || 'main';
    await sendJson(response, await opsActivityFeed.buildFeed({ limit, includeShadow, branchSlug }));
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/ops/data-integrity') {
    auth.assertAuthorized(request);
    await sendJson(response, await buildDataIntegrityAudit());
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/ops/reports') {
    auth.assertAuthorized(request);
    if (!isOpsHubReady()) {
      await sendJson(response, { error: 'Ops Hub hazır değil' }, 503);
      return true;
    }
    const pool = getOpsHubPool();
    const branchCtx = await resolveBranchContext(ctx, { pool, permission: 'read' });
    const period = url.searchParams.get('period') || '';
    const daysParam = url.searchParams.get('days');
    const days = period === 'today' ? 0 : Number(daysParam || 7);
    const channel = url.searchParams.get('channel') || 'all';
    const liveOnly = url.searchParams.get('live') !== '0';
    const { buildOpsReports } = await import('../../ops-hub/reports/ops-reports-service.js');
    await sendJson(response, await buildOpsReports(pool, {
      branchId: branchCtx.branchId,
      days,
      period,
      channel,
      liveOnly
    }));
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/ops/reports/order-profitability') {
    auth.assertAuthorized(request);
    if (!isOpsHubReady()) {
      await sendJson(response, { error: 'Ops Hub hazır değil' }, 503);
      return true;
    }
    const pool = getOpsHubPool();
    const branchCtx = await resolveBranchContext(ctx, { pool, permission: 'read' });
    const period = url.searchParams.get('period') || '';
    const daysParam = url.searchParams.get('days');
    const days = daysParam == null || daysParam === ''
      ? 7
      : (period === 'today' ? 0 : daysParam);
    const startDate = url.searchParams.get('startDate') || '';
    const endDate = url.searchParams.get('endDate') || '';
    const range = url.searchParams.get('range') || '';
    const channel = url.searchParams.get('channel') || 'all';
    const status = url.searchParams.get('status') || '';
    const liveOnly = url.searchParams.get('live') !== '0';
    const page = Number(url.searchParams.get('page') || 1);
    const limit = Number(url.searchParams.get('limit') || 25);
    const { buildOrderProfitReportApi } = await import('../../ops-hub/reports/ops-reports-service.js');
    await sendJson(response, await buildOrderProfitReportApi(pool, {
      branchId: branchCtx.branchId,
      days,
      period,
      startDate,
      endDate,
      range,
      channel,
      status,
      liveOnly,
      page,
      limit
    }));
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/ops/reports/order-profitability/detail') {
    auth.assertAuthorized(request);
    if (!isOpsHubReady()) {
      await sendJson(response, { error: 'Ops Hub hazır değil' }, 503);
      return true;
    }
    const pool = getOpsHubPool();
    const branchCtx = await resolveBranchContext(ctx, { pool, permission: 'read' });
    const period = url.searchParams.get('period') || '';
    const daysParam = url.searchParams.get('days');
    const days = daysParam == null || daysParam === ''
      ? 7
      : (period === 'today' ? 0 : daysParam);
    const startDate = url.searchParams.get('startDate') || '';
    const endDate = url.searchParams.get('endDate') || '';
    const range = url.searchParams.get('range') || '';
    const channel = url.searchParams.get('channel') || 'all';
    const status = url.searchParams.get('status') || '';
    const liveOnly = url.searchParams.get('live') !== '0';
    const orderNumber = url.searchParams.get('orderNumber') || '';
    const { buildOrderProfitDetailApi } = await import('../../ops-hub/reports/ops-reports-service.js');
    await sendJson(response, await buildOrderProfitDetailApi(pool, {
      branchId: branchCtx.branchId,
      orderNumber,
      channel,
      days,
      period,
      startDate,
      endDate,
      range,
      status,
      liveOnly
    }));
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/ops/customers') {
    auth.assertAuthorized(request);
    if (!isOpsHubReady()) {
      await sendJson(response, { error: 'Ops Hub hazır değil' }, 503);
      return true;
    }
    const pool = getOpsHubPool();
    const branchCtx = await resolveBranchContext(ctx, { pool, permission: 'read' });
    const { listOpsCustomers } = await import('../../ops-hub/customers/customer-index-service.js');
    await sendJson(response, await listOpsCustomers(pool, {
      branchId: branchCtx.branchId,
      search: url.searchParams.get('search') || '',
      page: Number(url.searchParams.get('page') || 1),
      limit: Number(url.searchParams.get('limit') || 50),
      liveOnly: url.searchParams.get('live') !== '0',
      all: ['1', 'true'].includes(String(url.searchParams.get('all') || '').toLowerCase())
    }));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/login') {
    const payload = await readJsonBody(request);
    const result = auth.loginWithToken(payload);
    const secure = String(request.headers['x-forwarded-proto'] || '').toLowerCase() === 'https'
      || process.env.NODE_ENV === 'production';
    if (result.ok && auth.isEnabled()) {
      const { buildSessionCookie } = await import('../../auth/session-cookie.js');
      response.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': buildSessionCookie(auth.token, { secure })
      });
      response.end(JSON.stringify(result, null, 2));
      return true;
    }
    await sendJson(response, result);
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
    const { clearSessionCookie } = await import('../../auth/session-cookie.js');
    const secure = String(request.headers['x-forwarded-proto'] || '').toLowerCase() === 'https'
      || process.env.NODE_ENV === 'production';
    response.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': clearSessionCookie({ secure })
    });
    response.end(JSON.stringify({ ok: true }));
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/channels') {
    auth.assertAuthorized(request);
    await sendJson(response, { channels: listChannels() });
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

  if (request.method === 'POST' && url.pathname === '/api/product-matching/master-auto-stock-bulk') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request).catch(() => ({}));
    await sendJson(response, await productMatching.setMasterAutoStockBulk(payload));
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

  if (request.method === 'GET' && url.pathname === '/api/product-matching/sync-catalog/status') {
    auth.assertAuthorized(request);
    const channelId = url.searchParams.get('channelId') || 'uber-eats';
    await sendJson(response, productMatching.getCatalogSyncStatus(channelId));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/product-matching/sync-uber-catalog') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request).catch(() => ({}));
    await sendJson(response, await productMatching.startUberCatalogSync(payload));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/product-matching/sync-yemeksepeti-catalog') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request).catch(() => ({}));
    await sendJson(response, await productMatching.startYemeksepetiCatalogSync(payload));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/product-matching/sync-getir-catalog') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request).catch(() => ({}));
    await sendJson(response, await productMatching.startGetirCatalogSync(payload));
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
    await sendJson(response, await productMatching.runAutoMatch(String(payload.channelId || 'uber-eats').trim(), {
      allowFuzzy: payload.allowFuzzy === true,
      confirm: payload.confirm !== false
    }));
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

  if (request.method === 'POST' && url.pathname === '/api/product-matching/auto-match-perfect') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request).catch(() => ({}));
    await sendJson(response, await productMatching.autoMatchPerfectConfidence(payload));
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

  if (request.method === 'POST' && url.pathname === '/api/product-matching/remove-master-channel-mapping') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request).catch(() => ({}));
    await sendJson(response, await productMatching.removeMasterChannelMapping(payload));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/product-matching/remove-master-channel-mappings-bulk') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request).catch(() => ({}));
    await sendJson(response, await productMatching.removeMasterChannelMappingsBulk(payload));
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

  if (request.method === 'GET' && url.pathname === '/api/product-matching/cleanup-suggestions') {
    auth.assertAuthorized(request);
    const channelId = url.searchParams.get('channelId') || '';
    const limit = Number(url.searchParams.get('limit') || 50) || 50;
    await sendJson(response, await productMatching.getCleanupSuggestions({ channelId, limit }));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/product-matching/apply-cleanup-suggestions') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request).catch(() => ({}));
    await sendJson(response, await productMatching.applyCleanupSuggestions(payload));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/product-matching/dismiss-cleanup-suggestions') {
    auth.assertAuthorized(request);
    const payload = await readJsonBody(request).catch(() => ({}));
    await sendJson(response, await productMatching.dismissCleanupSuggestions(payload));
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

  if (request.method === 'GET' && url.pathname === '/api/product-thumb-img') {
    auth.assertAuthorized(request);
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

  return false;
}
