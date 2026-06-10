import { randomUUID } from 'node:crypto';
import { readEnvFile } from '../../env.js';
import { paths } from '../../config.js';
import { resolveOpsHubConfig } from '../config.js';
import { getOpsOrderById } from '../db/repository.js';
import { insertShadowEvent } from '../db/repository.js';
import { writeTgoChannelStatus } from '../channels/tgo-status-write.js';
import { writeYemeksepetiChannelStatus } from '../channels/yemeksepeti-status-write.js';
import { mapOrderRow } from '../picking/picking-service.js';

export function isChannelStatusWriteEnabled(platformEnv = {}) {
  const config = resolveOpsHubConfig(platformEnv);
  return Boolean(config.flags.FF_CHANNEL_STATUS_WRITE);
}

export function buildChannelStatusSimulation(order, action) {
  return {
    dryRun: true,
    action,
    channel: order.channel,
    externalId: order.external_id,
    deliveryMode: order.delivery_mode,
    shadowMode: order.shadow_mode,
    note: 'FF_CHANNEL_STATUS_WRITE kapalı — kanal API çağrılmadı'
  };
}

export async function applyChannelStatus(pool, orderId, action, options = {}) {
  const platformEnv = options.platformEnv || (await readEnvFile(paths.platformEnv));
  const flagEnabled = isChannelStatusWriteEnabled(platformEnv);
  const detail = await getOpsOrderById(pool, orderId);

  if (!detail) {
    return null;
  }

  const order = detail.order;
  const lines = detail.lines;

  if (!['accept', 'ready'].includes(action)) {
    const error = new Error(`Geçersiz action: ${action}`);
    error.statusCode = 400;
    throw error;
  }

  if (action === 'accept' && !['received', 'picking'].includes(order.status)) {
    const error = new Error(`Accept için uygun durum değil: ${order.status}`);
    error.statusCode = 409;
    throw error;
  }

  if (action === 'ready' && !['picked', 'picking', 'ready'].includes(order.status)) {
    const error = new Error(`Ready için önce picking tamamlanmalı (durum: ${order.status})`);
    error.statusCode = 409;
    throw error;
  }

  let channelResult;
  let dryRun = false;

  if (!flagEnabled) {
    channelResult = buildChannelStatusSimulation(order, action);
    dryRun = true;
  } else if (order.shadow_mode && !options.forceLive) {
    channelResult = {
      ...buildChannelStatusSimulation(order, action),
      note: 'Shadow sipariş — forceLive ile canlı yazma açılabilir'
    };
    dryRun = true;
  } else {
    channelResult = await dispatchChannelWrite(action, order, lines, platformEnv);
  }

  const nextStatus = action === 'accept' ? 'picking' : 'ready';
  const nextChannelStatus =
    action === 'accept' ? 'Accepted' : order.channel === 'yemeksepeti' ? 'READY_FOR_PICKUP' : 'Picked';

  if (!dryRun) {
    await pool.query(
      `UPDATE ops_orders
       SET status = $1, channel_status = $2, updated_at = NOW()
       WHERE id = $3`,
      [nextStatus, nextChannelStatus, orderId]
    );
  }

  await insertShadowEvent(pool, {
    branchId: order.branch_id,
    orderId,
    eventType: dryRun ? 'channel_status_simulation' : 'channel_status_write',
    payload: {
      action,
      dryRun,
      channelResult
    }
  });

  await enqueueOutbox(pool, {
    branchId: order.branch_id,
    orderId,
    action,
    dryRun,
    payload: channelResult
  });

  const updated = await getOpsOrderById(pool, orderId);
  return {
    dryRun,
    flagEnabled,
    action,
    channelResult,
    order: mapOrderRow(updated.order)
  };
}

async function dispatchChannelWrite(action, order, lines, platformEnv) {
  if (order.channel === 'trendyol_go') {
    return writeTgoChannelStatus(action, {
      packageId: order.external_id,
      deliveryMode: order.delivery_mode
    }, platformEnv);
  }

  if (order.channel === 'yemeksepeti') {
    return writeYemeksepetiChannelStatus(action, order, lines, platformEnv);
  }

  if (order.channel === 'getir') {
    throw new Error('Getir kanal yazması henüz aktif değil (G3 FAIL)');
  }

  throw new Error(`Kanal yazması desteklenmiyor: ${order.channel}`);
}

async function enqueueOutbox(pool, { branchId, orderId, action, dryRun, payload }) {
  const idempotencyKey = `channel_status:${orderId}:${action}:${dryRun ? 'dry' : 'live'}`;
  await pool.query(
    `INSERT INTO ops_outbox (
       id, branch_id, order_id, message_type, payload, status, idempotency_key, processed_at
     ) VALUES ($1, $2, $3, 'channel_status', $4::jsonb, 'done', $5, NOW())
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [randomUUID(), branchId, orderId, JSON.stringify({ action, dryRun, payload }), idempotencyKey]
  );
}

export async function getOpsHubPublicConfig(platformEnv = null) {
  const env = platformEnv || (await readEnvFile(paths.platformEnv));
  const config = resolveOpsHubConfig(env);
  return {
    publicApiBaseUrl: config.publicApiBaseUrl,
    shadowModeDefault: config.shadowModeDefault,
    flags: config.flags
  };
}
