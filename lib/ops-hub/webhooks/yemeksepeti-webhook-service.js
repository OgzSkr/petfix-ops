import { readEnvFile } from '../../env.js';
import { paths } from '../../config.js';
import { resolveOpsHubConfig } from '../config.js';
import { ingestOpsOrder, updateOpsOrderChannelState } from '../ingest/ingest-service.js';
import { resolveYemeksepetiWebhookSecret } from '../integrations/branch-config-resolver.js';
import {
  extractYemeksepetiOrderPayload,
  normalizeYemeksepetiWebhookOrder
} from '../channels/yemeksepeti-normalize.js';
import {
  isWebhookVerificationDisabled,
  resolveWebhookSecretFromRequest,
  verifyWebhookSecret
} from './webhook-auth.js';
import { findOpsOrderByChannelExternalId, insertShadowEvent } from '../db/repository.js';
import { ORDER_SOURCES } from '../../production/constants.js';
import { logWebhookEvent } from '../../production/structured-log.js';
import {
  claimWebhookEvent,
  extractWebhookEventId,
  hashWebhookPayload,
  linkWebhookEventToOrder
} from './webhook-event-store.js';

export async function verifyYemeksepetiWebhookRequest(request, pool, options = {}) {
  const platformEnv = options.platformEnv || (await readEnvFile(paths.platformEnv));
  if (isWebhookVerificationDisabled(platformEnv)) {
    return { ok: true, skipped: true };
  }

  const expected = await resolveYemeksepetiWebhookSecret(pool, {
    branchId: options.branchId,
    platformEnv
  });
  if (!expected) {
    const error = new Error('YS webhook secret yapılandırılmamış');
    error.statusCode = 503;
    throw error;
  }

  const provided = resolveWebhookSecretFromRequest(request);
  if (!verifyWebhookSecret(provided, expected)) {
    const error = new Error('Webhook secret geçersiz');
    error.statusCode = 401;
    throw error;
  }

  return { ok: true };
}

export async function handleYemeksepetiOrderWebhook(pool, body, options = {}) {
  const started = Date.now();
  const rawOrder = extractYemeksepetiOrderPayload(body);
  if (!rawOrder) {
    const error = new Error('Geçersiz YS webhook payload');
    error.statusCode = 400;
    throw error;
  }

  const eventId = extractWebhookEventId(body, rawOrder);
  const externalOrderId = String(rawOrder.order_id || rawOrder.id || '').trim();
  const payloadHash = hashWebhookPayload(body);

  const eventClaim = await claimWebhookEvent(pool, {
    channel: 'yemeksepeti',
    eventId,
    externalOrderId,
    eventType: 'order',
    payloadHash: eventId ? null : payloadHash
  });

  if (eventClaim.duplicate) {
    logWebhookEvent({
      component: 'YS-WEBHOOK',
      level: 'info',
      channel: 'yemeksepeti',
      order_id: externalOrderId,
      event_id: eventId,
      source: ORDER_SOURCES.WEBHOOK,
      status: 'duplicate',
      duration_ms: Date.now() - started
    });
    return {
      ok: true,
      action: 'duplicate',
      duplicate: true,
      orderId: eventClaim.orderId,
      externalId: externalOrderId
    };
  }

  const platformEnv = options.platformEnv || (await readEnvFile(paths.platformEnv));
  const opsConfig = resolveOpsHubConfig(platformEnv);
  const normalized = await normalizeYemeksepetiWebhookOrder(rawOrder, {
    platformEnv,
    shadowMode: options.shadowMode ?? opsConfig.shadowModeDefault
  });

  if (!normalized.ok) {
    const error = new Error(normalized.errors.join('; '));
    error.statusCode = 400;
    throw error;
  }

  normalized.order.ingestSource = ORDER_SOURCES.WEBHOOK;
  const nextStatus = normalized.order.status;

  const existing = await findOpsOrderByChannelExternalId(
    pool,
    normalized.order.channel,
    normalized.order.externalId
  );

  if (existing) {
    const updated = await updateOpsOrderChannelState(pool, normalized.order, {
      branchSlug: options.branchSlug || 'main'
    });
    if (eventClaim.eventRowId) {
      await linkWebhookEventToOrder(pool, eventClaim.eventRowId, updated.orderId);
    }
    if (options.branchId) {
      await insertShadowEvent(pool, {
        branchId: options.branchId,
        orderId: updated.orderId,
        eventType: 'webhook_update',
        payload: {
          channel: 'yemeksepeti',
          externalId: normalized.order.externalId,
          status: normalized.order.channelStatus
        }
      });
    }
    logWebhookEvent({
      component: 'YS-WEBHOOK',
      level: 'info',
      channel: 'yemeksepeti',
      order_id: externalOrderId,
      event_id: eventId,
      source: ORDER_SOURCES.WEBHOOK,
      status: 'updated',
      duration_ms: Date.now() - started
    });
    return {
      ok: true,
      action: 'updated',
      duplicate: true,
      orderId: updated.orderId,
      externalId: normalized.order.externalId,
      status: updated.status || nextStatus
    };
  }

  if (nextStatus === 'cancelled') {
    return {
      ok: true,
      action: 'ignored',
      message: 'İptal webhook — kayıtlı sipariş yok',
      externalId: normalized.order.externalId
    };
  }

  const ingest = await ingestOpsOrder(pool, normalized.order, {
    shadowModeDefault: normalized.order.shadowMode,
    branchSlug: options.branchSlug || 'main',
    idempotencyEventType: 'webhook'
  });

  if (eventClaim.eventRowId && ingest.orderId) {
    await linkWebhookEventToOrder(pool, eventClaim.eventRowId, ingest.orderId);
  }

  if (options.branchId) {
    await insertShadowEvent(pool, {
      branchId: options.branchId,
      orderId: ingest.orderId,
      eventType: ingest.duplicate ? 'webhook_duplicate' : 'webhook_ingest',
      payload: {
        channel: 'yemeksepeti',
        externalId: normalized.order.externalId,
        status: normalized.order.channelStatus
      }
    });
  }

  logWebhookEvent({
    component: 'YS-WEBHOOK',
    level: 'info',
    channel: 'yemeksepeti',
    order_id: externalOrderId,
    event_id: eventId,
    source: ORDER_SOURCES.WEBHOOK,
    status: ingest.duplicate ? 'duplicate' : 'ingested',
    duration_ms: Date.now() - started
  });

  return {
    ok: true,
    action: ingest.duplicate ? 'duplicate' : 'ingested',
    orderId: ingest.orderId,
    duplicate: ingest.duplicate,
    externalId: normalized.order.externalId,
    status: normalized.order.status
  };
}

export async function handleYemeksepetiCatalogWebhook(pool, body, options = {}) {
  const jobId = body?.job_id || body?.jobId || body?.data?.job_id || null;

  if (options.branchId) {
    await insertShadowEvent(pool, {
      branchId: options.branchId,
      orderId: null,
      eventType: 'catalog_webhook',
      payload: {
        channel: 'yemeksepeti',
        jobId,
        status: body?.status || body?.state || null,
        body
      }
    });
  }

  return {
    ok: true,
    accepted: true,
    jobId,
    message: 'Katalog callback kaydedildi'
  };
}

export function mapWebhookHealth() {
  return {
    service: 'petfix-webhooks',
    version: 'v1',
    endpoints: [
      'POST /webhooks/v1/yemeksepeti/orders',
      'POST /webhooks/v1/yemeksepeti/catalog',
      'POST /webhooks/v1/getir/orders'
    ]
  };
}
