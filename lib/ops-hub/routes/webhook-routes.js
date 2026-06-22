import { readJsonBody, sendJson } from '../../http/respond.js';
import { isOpsHubReady, getOpsHubPool } from '../bootstrap.js';
import { readEnvFile } from '../../env.js';
import { paths } from '../../config.js';
import {
  handleYemeksepetiCatalogWebhook,
  handleYemeksepetiOrderWebhook,
  mapWebhookHealth,
  verifyYemeksepetiWebhookRequest
} from '../webhooks/yemeksepeti-webhook-service.js';
import {
  GETIR_WEBHOOK_PATHS,
  handleGetirCancelledOrderWebhook,
  handleGetirNewOrderWebhook,
  verifyGetirWebhookRequest
} from '../webhooks/getir-webhook-service.js';
import { resolveWebhookBranch } from '../branches/webhook-branch-resolver.js';

async function withWebhookBranch(ctx, handler) {
  const { request, response, url } = ctx;
  const pool = getOpsHubPool();
  const platformEnv = await readEnvFile(paths.platformEnv);
  const branchCtx = await resolveWebhookBranch(pool, request, url, platformEnv);
  const scopedUrl = new URL(url.href);
  scopedUrl.pathname = branchCtx.pathname;
  return handler({
    ...ctx,
    url: scopedUrl,
    branchId: branchCtx.branchId,
    branchSlug: branchCtx.branchSlug,
    webhookBranchSource: branchCtx.source,
    platformEnv,
    pool
  });
}

export async function handleWebhookRoutes(ctx) {
  const { request, response, url } = ctx;
  const { pathname } = url;

  if (pathname === '/webhooks/v1/health' && request.method === 'GET') {
    await sendJson(response, { ok: true, ...mapWebhookHealth() });
    return true;
  }

  if (!pathname.startsWith('/webhooks/v1/')) {
    return false;
  }

  if (!isOpsHubReady()) {
    await sendJson(response, { error: 'Ops Hub hazır değil' }, 503);
    return true;
  }

  const isBranchScoped = pathname.startsWith('/webhooks/v1/branches/');
  const effectivePath = isBranchScoped ? url.pathname : pathname;

  const healthGet = async (endpointPath, message) => {
    await sendJson(response, {
      ok: true,
      endpoint: endpointPath,
      method: 'POST',
      message
    });
  };

  if (request.method === 'GET' && (
    effectivePath === '/webhooks/v1/yemeksepeti/orders' ||
    pathname.endsWith('/yemeksepeti/orders')
  )) {
    await healthGet(pathname, 'Yemeksepeti sipariş webhook hazır — YS POST + webhook secret ile çağırır');
    return true;
  }

  if (request.method === 'GET' && (
    effectivePath === '/webhooks/v1/yemeksepeti/catalog' ||
    pathname.endsWith('/yemeksepeti/catalog')
  )) {
    await healthGet(pathname, 'Yemeksepeti katalog webhook hazır — YS POST + webhook secret ile çağırır');
    return true;
  }

  if (request.method === 'GET' && (
    effectivePath === GETIR_WEBHOOK_PATHS.ordersNew ||
    pathname.endsWith('/getir/orders/new')
  )) {
    await healthGet(pathname, 'Getir yeni sipariş webhook hazır — Getir POST + x-api-key ile çağırır');
    return true;
  }

  if (request.method === 'GET' && (
    effectivePath === GETIR_WEBHOOK_PATHS.ordersCancelled ||
    pathname.endsWith('/getir/orders/cancelled')
  )) {
    await healthGet(pathname, 'Getir iptal webhook hazır — Getir POST + x-api-key ile çağırır');
    return true;
  }

  if (request.method === 'POST' && (
    effectivePath === '/webhooks/v1/yemeksepeti/orders' ||
    pathname.endsWith('/yemeksepeti/orders')
  )) {
    return withWebhookBranch(ctx, async ({ branchId, platformEnv, pool }) => {
      try {
        await verifyYemeksepetiWebhookRequest(request, pool, { branchId, platformEnv });
        const body = await readJsonBody(request);
        const result = await handleYemeksepetiOrderWebhook(pool, body, { branchId, platformEnv });
        await sendJson(response, { ...result, branchId }, result.duplicate ? 200 : 201);
      } catch (error) {
        await sendJson(response, { error: error.message }, error.statusCode || 500);
      }
      return true;
    });
  }

  if (request.method === 'POST' && (
    effectivePath === '/webhooks/v1/yemeksepeti/catalog' ||
    pathname.endsWith('/yemeksepeti/catalog')
  )) {
    return withWebhookBranch(ctx, async ({ branchId, platformEnv, pool }) => {
      try {
        await verifyYemeksepetiWebhookRequest(request, pool, { branchId, platformEnv });
        const body = await readJsonBody(request);
        const result = await handleYemeksepetiCatalogWebhook(pool, body, { branchId, platformEnv });
        await sendJson(response, { ...result, branchId });
      } catch (error) {
        await sendJson(response, { error: error.message }, error.statusCode || 500);
      }
      return true;
    });
  }

  if (request.method === 'POST' && (
    effectivePath === GETIR_WEBHOOK_PATHS.ordersNew ||
    pathname.endsWith('/getir/orders/new')
  )) {
    return withWebhookBranch(ctx, async ({ branchId, platformEnv, pool }) => {
      try {
        await verifyGetirWebhookRequest(request, pool, { branchId, platformEnv });
        const body = await readJsonBody(request);
        const result = await handleGetirNewOrderWebhook(pool, body, { branchId, platformEnv });
        await sendJson(response, { ...result, branchId }, 202);
      } catch (error) {
        await sendJson(response, { error: error.message }, error.statusCode || 500);
      }
      return true;
    });
  }

  if (request.method === 'POST' && (
    effectivePath === GETIR_WEBHOOK_PATHS.ordersCancelled ||
    pathname.endsWith('/getir/orders/cancelled')
  )) {
    return withWebhookBranch(ctx, async ({ branchId, platformEnv, pool }) => {
      try {
        await verifyGetirWebhookRequest(request, pool, { branchId, platformEnv });
        const body = await readJsonBody(request);
        const result = await handleGetirCancelledOrderWebhook(pool, body, { branchId, platformEnv });
        await sendJson(response, { ...result, branchId }, 202);
      } catch (error) {
        await sendJson(response, { error: error.message }, error.statusCode || 500);
      }
      return true;
    });
  }

  if (request.method === 'POST' && (
    effectivePath === GETIR_WEBHOOK_PATHS.ordersLegacy ||
    (pathname.endsWith('/getir/orders') && !pathname.endsWith('/orders/new') && !pathname.endsWith('/orders/cancelled'))
  )) {
    return withWebhookBranch(ctx, async ({ branchId, platformEnv, pool }) => {
      try {
        await verifyGetirWebhookRequest(request, pool, { branchId, platformEnv });
        const body = await readJsonBody(request);
        const result = await handleGetirNewOrderWebhook(pool, body, { branchId, platformEnv });
        await sendJson(response, { ...result, branchId }, 202);
      } catch (error) {
        await sendJson(response, { error: error.message }, error.statusCode || 500);
      }
      return true;
    });
  }

  return false;
}
