import { readEnvFile } from '../../env.js';
import { paths } from '../../config.js';
import { resolveGetirWebhookSecret } from '../integrations/branch-config-resolver.js';
import {
  isWebhookVerificationDisabled,
  resolveGetirApiKeyFromRequest,
  verifyWebhookSecret
} from './webhook-auth.js';
import { insertShadowEvent } from '../db/repository.js';
import { ingestOpsOrder } from '../ingest/ingest-service.js';
import { normalizeGetirWebhookOrder } from '../channels/getir-normalize.js';

export const GETIR_WEBHOOK_PATHS = Object.freeze({
  ordersNew: '/webhooks/v1/getir/orders/new',
  ordersCancelled: '/webhooks/v1/getir/orders/cancelled',
  ordersLegacy: '/webhooks/v1/getir/orders'
});

export async function verifyGetirWebhookRequest(request, pool, options = {}) {
  const platformEnv = options.platformEnv || (await readEnvFile(paths.platformEnv));
  if (isWebhookVerificationDisabled(platformEnv)) {
    return { ok: true, skipped: true };
  }

  const expected = await resolveGetirWebhookSecret(pool, {
    branchId: options.branchId,
    platformEnv
  });
  if (!expected) {
    const error = new Error('Getir webhook secret yapılandırılmamış');
    error.statusCode = 503;
    throw error;
  }

  const provided = resolveGetirApiKeyFromRequest(request);
  if (!verifyWebhookSecret(provided, expected)) {
    const error = new Error('x-api-key geçersiz');
    error.statusCode = 401;
    throw error;
  }

  return { ok: true };
}

async function recordGetirWebhook(pool, body, options = {}) {
  const branchId = options.branchId;
  if (branchId) {
    await insertShadowEvent(pool, {
      branchId,
      orderId: null,
      eventType: options.eventType,
      payload: {
        channel: 'getir',
        kind: options.kind,
        body
      }
    });
  }

  return {
    ok: true,
    accepted: true,
    kind: options.kind,
    message: options.message
  };
}

async function ingestGetirWebhook(pool, body, options = {}) {
  const platformEnv = options.platformEnv || (await readEnvFile(paths.platformEnv));
  const normalized = await normalizeGetirWebhookOrder(body, {
    platformEnv,
    shadowMode: options.shadowMode ?? true
  });

  if (!normalized.ok) {
    return {
      ok: false,
      accepted: false,
      kind: options.kind,
      message: normalized.errors?.join('; ') || 'Getir sipariş normalize edilemedi'
    };
  }

  const ingest = await ingestOpsOrder(pool, normalized.order, {
    shadowModeDefault: options.shadowMode ?? true,
    branchSlug: options.branchSlug || 'main',
    platformEnv
  });

  return {
    ok: true,
    accepted: true,
    kind: options.kind,
    duplicate: ingest.duplicate,
    orderId: ingest.orderId,
    message: ingest.duplicate
      ? 'Getir sipariş zaten kayıtlı'
      : 'Getir sipariş ingest edildi'
  };
}

export async function handleGetirNewOrderWebhook(pool, body, options = {}) {
  const platformEnv = options.platformEnv || (await readEnvFile(paths.platformEnv));
  const ingested = await ingestGetirWebhook(pool, body, {
    ...options,
    kind: 'new',
    eventType: 'getir_order_new',
    platformEnv
  });

  if (ingested.ok && !ingested.duplicate) {
    return ingested;
  }

  return recordGetirWebhook(pool, body, {
    ...options,
    kind: 'new',
    eventType: 'getir_order_new',
    message: ingested.message || 'Getir yeni sipariş webhook kaydedildi'
  });
}

export async function handleGetirCancelledOrderWebhook(pool, body, options = {}) {
  const platformEnv = options.platformEnv || (await readEnvFile(paths.platformEnv));
  const ingested = await ingestGetirWebhook(pool, body, {
    ...options,
    kind: 'cancelled',
    eventType: 'getir_order_cancelled',
    platformEnv
  });

  if (ingested.ok && !ingested.duplicate) {
    return ingested;
  }

  return recordGetirWebhook(pool, body, {
    ...options,
    kind: 'cancelled',
    eventType: 'getir_order_cancelled',
    message: ingested.message || 'Getir iptal webhook kaydedildi'
  });
}

export function listGetirWebhookEndpoints() {
  return [
    `POST ${GETIR_WEBHOOK_PATHS.ordersNew}`,
    `POST ${GETIR_WEBHOOK_PATHS.ordersCancelled}`,
    `POST ${GETIR_WEBHOOK_PATHS.ordersLegacy}`
  ];
}
