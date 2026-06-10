import { createHash, randomUUID } from 'node:crypto';
import { logWebhookEvent } from '../../production/structured-log.js';

export function hashWebhookPayload(payload) {
  const normalized = JSON.stringify(payload ?? {});
  return createHash('sha256').update(normalized).digest('hex');
}

export function extractWebhookEventId(body, rawOrder) {
  const candidates = [
    body?.event_id,
    body?.eventId,
    body?.id,
    rawOrder?.event_id,
    rawOrder?.eventId
  ];
  for (const value of candidates) {
    const id = String(value || '').trim();
    if (id) return id;
  }
  return null;
}

/**
 * Webhook olayını kaydet. Unique ihlali → duplicate.
 * @returns {Promise<{ duplicate: boolean, eventRowId?: string, orderId?: string }>}
 */
export async function claimWebhookEvent(pool, {
  channel,
  eventId = null,
  externalOrderId = null,
  eventType = 'order',
  payloadHash = null,
  orderId = null,
  status = 'processed'
}) {
  const id = randomUUID();
  try {
    await pool.query(
      `INSERT INTO ops_webhook_events (
         id, channel, event_id, external_order_id, event_type,
         payload_hash, status, order_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, channel, eventId, externalOrderId, eventType, payloadHash, status, orderId]
    );
    return { duplicate: false, eventRowId: id };
  } catch (error) {
    if (error.code !== '23505') {
      throw error;
    }

    const existing = await findWebhookEvent(pool, {
      channel,
      eventId,
      externalOrderId,
      eventType,
      payloadHash
    });

    logWebhookEvent({
      component: 'YS-WEBHOOK',
      level: 'info',
      channel,
      order_id: externalOrderId,
      event_id: eventId,
      source: 'webhook',
      status: 'duplicate',
      error_code: 'WEBHOOK_DUPLICATE'
    });

    return {
      duplicate: true,
      eventRowId: existing?.id || null,
      orderId: existing?.order_id || null
    };
  }
}

export async function findWebhookEvent(pool, {
  channel,
  eventId,
  externalOrderId,
  eventType = 'order',
  payloadHash = null
}) {
  if (eventId) {
    const result = await pool.query(
      `SELECT id, order_id, status, created_at
       FROM ops_webhook_events
       WHERE channel = $1 AND event_id = $2
       LIMIT 1`,
      [channel, eventId]
    );
    return result.rows[0] || null;
  }

  if (externalOrderId && payloadHash) {
    const result = await pool.query(
      `SELECT id, order_id, status, created_at
       FROM ops_webhook_events
       WHERE channel = $1
         AND external_order_id = $2
         AND event_type = $3
         AND payload_hash = $4
       LIMIT 1`,
      [channel, externalOrderId, eventType, payloadHash]
    );
    return result.rows[0] || null;
  }

  return null;
}

export async function linkWebhookEventToOrder(pool, eventRowId, orderId) {
  if (!eventRowId || !orderId) return;
  await pool.query(
    `UPDATE ops_webhook_events SET order_id = $2 WHERE id = $1`,
    [eventRowId, orderId]
  );
}

export async function recordWebhookError(pool, {
  channel,
  eventId,
  externalOrderId,
  eventType = 'order',
  payloadHash,
  errorSummary
}) {
  return claimWebhookEvent(pool, {
    channel,
    eventId,
    externalOrderId,
    eventType,
    payloadHash,
    status: 'failed'
  }).catch(() => null);
}
