import { readJsonBody, sendJson } from '../../http/respond.js';
import { isOpsHubReady, getOpsHubPool, getOpsHubState } from '../bootstrap.js';
import { readEnvFile } from '../../env.js';
import { paths } from '../../config.js';
import {
  handleYemeksepetiCatalogWebhook,
  handleYemeksepetiOrderWebhook,
  mapWebhookHealth,
  verifyYemeksepetiWebhookRequest
} from '../webhooks/yemeksepeti-webhook-service.js';
import { insertShadowEvent } from '../db/repository.js';

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

  const pool = getOpsHubPool();
  const branchId = getOpsHubState().branch?.id;
  const platformEnv = await readEnvFile(paths.platformEnv);

  if (pathname === '/webhooks/v1/yemeksepeti/orders' && request.method === 'POST') {
    try {
      await verifyYemeksepetiWebhookRequest(request, pool, { branchId, platformEnv });
      const body = await readJsonBody(request);
      const result = await handleYemeksepetiOrderWebhook(pool, body, {
        branchId,
        platformEnv
      });
      await sendJson(response, result, result.duplicate ? 200 : 201);
    } catch (error) {
      await sendJson(response, { error: error.message }, error.statusCode || 500);
    }
    return true;
  }

  if (pathname === '/webhooks/v1/yemeksepeti/catalog' && request.method === 'POST') {
    try {
      await verifyYemeksepetiWebhookRequest(request, pool, { branchId, platformEnv });
      const body = await readJsonBody(request);
      const result = await handleYemeksepetiCatalogWebhook(pool, body, { branchId, platformEnv });
      await sendJson(response, result);
    } catch (error) {
      await sendJson(response, { error: error.message }, error.statusCode || 500);
    }
    return true;
  }

  if (pathname === '/webhooks/v1/getir/orders' && request.method === 'POST') {
    try {
      const body = await readJsonBody(request);
      if (branchId) {
        await insertShadowEvent(pool, {
          branchId,
          orderId: null,
          eventType: 'getir_webhook_received',
          payload: { channel: 'getir', body }
        });
      }
      await sendJson(response, {
        ok: true,
        accepted: true,
        message: 'Getir webhook kaydedildi — G3 credential sonrası ingest açılacak'
      }, 202);
    } catch (error) {
      await sendJson(response, { error: error.message }, error.statusCode || 500);
    }
    return true;
  }

  return false;
}
