import { readEnvFile } from '../../env.js';
import { paths } from '../../config.js';
import { resolveOpsHubConfig } from '../config.js';
import { ingestOpsOrder, updateOpsOrderChannelState } from '../ingest/ingest-service.js';
import { resolveYemeksepetiWebhookSecret } from '../integrations/branch-config-resolver.js';
import {
  extractYemeksepetiOrderItems,
  extractYemeksepetiOrderPayload,
  mapYemeksepetiOrderStatus,
  normalizeYemeksepetiWebhookOrder
} from '../channels/yemeksepeti-normalize.js';
import { fetchYemeksepetiOrderById, isYemeksepetiOrderUuid } from '../../channels/yemeksepeti-orders.js';
import { resolveYemeksepetiOpsConfig } from '../integrations/branch-config-resolver.js';
import {
  isWebhookVerificationDisabled,
  resolveWebhookSecretFromRequest,
  verifyWebhookSecret
} from './webhook-auth.js';
import { findOpsOrderByChannelExternalId, insertShadowEvent } from '../db/repository.js';
import { ORDER_SOURCES } from '../../production/constants.js';
import { logWebhookEvent } from '../../production/structured-log.js';
import { triggerYemeksepetiCatalogSync } from '../../runtime/catalog-sync-hooks.js';
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

async function enrichYemeksepetiWebhookOrder(rawOrder, options = {}) {
  let order = rawOrder;
  if (extractYemeksepetiOrderItems(order).length) {
    return order;
  }

  const orderId = String(order.order_id || order.id || '').trim();
  if (!isYemeksepetiOrderUuid(orderId)) {
    return order;
  }

  try {
    const platformEnv = options.platformEnv || (await readEnvFile(paths.platformEnv));
    const cfg = await resolveYemeksepetiOpsConfig(options.pool, {
      branchId: options.branchId,
      platformEnv
    });
    const fetched = await fetchYemeksepetiOrderById(cfg, orderId, { platformEnv });
    if (fetched?.rawOrder && extractYemeksepetiOrderItems(fetched.rawOrder).length) {
      return {
        ...fetched.rawOrder,
        status: order.status || fetched.rawOrder.status,
        order_code: order.order_code || fetched.rawOrder.order_code
      };
    }
  } catch (error) {
    logWebhookEvent({
      component: 'YS-WEBHOOK',
      level: 'warn',
      channel: 'yemeksepeti',
      order_id: orderId,
      source: ORDER_SOURCES.WEBHOOK,
      status: 'partner_api_enrich_failed',
      message: error.message
    });
  }

  return order;
}

export async function handleYemeksepetiOrderWebhook(pool, body, options = {}) {
  const started = Date.now();
  const rawOrder = extractYemeksepetiOrderPayload(body);
  if (!rawOrder) {
    const error = new Error('Geçersiz YS webhook payload');
    error.statusCode = 400;
    throw error;
  }

  const platformEnv = options.platformEnv || (await readEnvFile(paths.platformEnv));
  const enrichedOrder = await enrichYemeksepetiWebhookOrder(rawOrder, {
    pool,
    branchId: options.branchId,
    platformEnv
  });

  const eventId = extractWebhookEventId(body, enrichedOrder);
  const externalOrderId = String(enrichedOrder.order_id || enrichedOrder.id || '').trim();
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

  const opsConfig = resolveOpsHubConfig(platformEnv);
  const existingBeforeNormalize = externalOrderId
    ? await findOpsOrderByChannelExternalId(pool, 'yemeksepeti', externalOrderId)
    : null;

  if (existingBeforeNormalize && !extractYemeksepetiOrderItems(enrichedOrder).length) {
    const statusOnlyOrder = {
      channel: 'yemeksepeti',
      externalId: externalOrderId,
      status: mapYemeksepetiOrderStatus(enrichedOrder.status),
      channelStatus: String(enrichedOrder.status || '').trim() || null,
      rawPayload: {
        source: 'webhook',
        orderId: externalOrderId,
        statusOnly: true,
        yemeksepetiOrder: enrichedOrder
      }
    };
    const updated = await updateOpsOrderChannelState(pool, statusOnlyOrder, {
      branchSlug: options.branchSlug || 'main'
    });
    if (eventClaim.eventRowId) {
      await linkWebhookEventToOrder(pool, eventClaim.eventRowId, updated.orderId);
    }
    logWebhookEvent({
      component: 'YS-WEBHOOK',
      level: 'info',
      channel: 'yemeksepeti',
      order_id: externalOrderId,
      event_id: eventId,
      source: ORDER_SOURCES.WEBHOOK,
      status: 'status_only_update',
      duration_ms: Date.now() - started
    });
    return {
      ok: true,
      action: 'updated',
      duplicate: true,
      orderId: updated.orderId,
      externalId: externalOrderId,
      status: updated.status || statusOnlyOrder.status
    };
  }

  const normalized = await normalizeYemeksepetiWebhookOrder(enrichedOrder, {
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

  const syncResult = await triggerYemeksepetiCatalogSync('webhook');

  return {
    ok: true,
    accepted: true,
    jobId,
    catalogSync: syncResult,
    message: syncResult.skipped
      ? 'Katalog callback kaydedildi'
      : 'Katalog callback alındı — sync tetiklendi'
  };
}

export function mapWebhookHealth() {
  return {
    service: 'petfix-webhooks',
    version: 'v1',
    endpoints: [
      'POST /webhooks/v1/yemeksepeti/orders',
      'POST /webhooks/v1/yemeksepeti/catalog',
      'POST /webhooks/v1/getir/orders/new',
      'POST /webhooks/v1/getir/orders/cancelled',
      'POST /webhooks/v1/getir/orders'
    ]
  };
}
