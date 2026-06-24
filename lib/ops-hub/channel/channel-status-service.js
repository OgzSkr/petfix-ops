import { randomUUID } from 'node:crypto';
import { readEnvFile, readPlatformConfigEnv } from '../../env.js';
import { paths } from '../../config.js';
import { isOpsProductionLive, resolveOpsHubConfig } from '../config.js';
import { getOpsOrderById } from '../db/repository.js';
import { insertShadowEvent } from '../db/repository.js';
import { writeTgoChannelStatus } from '../channels/tgo-status-write.js';
import { writeYemeksepetiChannelStatus } from '../channels/yemeksepeti-status-write.js';
import { writeGetirChannelStatus } from '../channels/getir-status-write.js';
import { mapOrderRow, resolveCustomerOrderTotal } from '../picking/picking-service.js';
import { isTgoPackageUnaccepted } from '../channels/tgo-status-write.js';
import { isPushConfigured } from '../notifications/push-service.js';
import { buildChannelNotifyFeedback } from './channel-notify-feedback.js';

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
  const platformEnv = options.platformEnv || (await readPlatformConfigEnv(paths.platformEnv));
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

  if (action === 'ready') {
    if (!['picked', 'picking', 'ready'].includes(order.status)) {
      const error = new Error(`Ready için önce picking tamamlanmalı (durum: ${order.status})`);
      error.statusCode = 409;
      throw error;
    }
    if (!order.picking_completed_at && order.status !== 'ready') {
      const error = new Error('Ready için önce toplama tamamlanmalı');
      error.statusCode = 409;
      throw error;
    }
  }

  let channelResult;
  let dryRun = false;
  let channelWriteFailed = false;

  if (!flagEnabled) {
    channelResult = buildChannelStatusSimulation(order, action);
    dryRun = true;
  } else if (!isOpsProductionLive() && order.shadow_mode && !options.forceLive) {
    channelResult = {
      ...buildChannelStatusSimulation(order, action),
      note: 'Shadow sipariş — forceLive ile canlı yazma açılabilir'
    };
    dryRun = true;
  } else {
    try {
      channelResult = await dispatchChannelWrite(action, order, lines, platformEnv, pool);
    } catch (error) {
      channelWriteFailed = true;
      channelResult = {
        ok: false,
        error: error.message,
        action,
        channel: order.channel,
        externalId: order.external_id
      };
    }
  }

  const nextStatus = action === 'accept' ? 'picking' : 'ready';
  const nextChannelStatus = resolveNextChannelStatus(order, action);

  // Accept: mağaza personeli toplamaya geçebilsin — kanal API hatası iç durumu kilitlemesin.
  if (action === 'accept' && order.status === 'received') {
    const channelStatusUpdate =
      !dryRun && !channelWriteFailed ? nextChannelStatus : order.channel_status;
    await pool.query(
      `UPDATE ops_orders
       SET status = 'picking',
           picking_started_at = COALESCE(picking_started_at, NOW()),
           channel_status = $2,
           updated_at = NOW()
       WHERE id = $1`,
      [orderId, channelStatusUpdate]
    );
  } else if (action === 'ready' && !dryRun && !channelWriteFailed) {
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
  const notify = buildChannelNotifyFeedback({
    channel: order.channel,
    action,
    dryRun,
    channelWriteFailed,
    channelResult
  });
  return {
    dryRun,
    flagEnabled,
    action,
    channelResult,
    channelWriteFailed,
    notify,
    order: mapOrderRow(updated.order)
  };
}

export async function ensureTgoAcceptIfNeeded(pool, orderId, options = {}) {
  const detail = await getOpsOrderById(pool, orderId);
  if (!detail || detail.order.channel !== 'trendyol_go') {
    return null;
  }

  const { order } = detail;
  if (!isTgoPackageUnaccepted(order.channel_status)) {
    return null;
  }
  if (!['received', 'picking'].includes(order.status)) {
    return null;
  }

  return applyChannelStatus(pool, orderId, 'accept', options);
}

async function dispatchChannelWrite(action, order, lines, platformEnv, pool) {
  if (order.channel === 'trendyol_go') {
    const lineTotal = lines.reduce(
      (sum, line) => sum + Number(line.quantity || 0) * Number(line.unit_price || 0),
      0
    );
    return writeTgoChannelStatus(action, {
      packageId: order.external_id,
      deliveryMode: order.delivery_mode,
      channelStatus: order.channel_status,
      invoiceAmount: resolveCustomerOrderTotal(order, lineTotal)
    }, platformEnv);
  }

  if (order.channel === 'yemeksepeti') {
    return writeYemeksepetiChannelStatus(action, order, lines, platformEnv);
  }

  if (order.channel === 'getir') {
    return writeGetirChannelStatus(action, order, lines, platformEnv, { pool });
  }

  throw new Error(`Kanal yazması desteklenmiyor: ${order.channel}`);
}

export function resolveNextChannelStatus(order, action) {
  const channel = String(order.channel || '').trim();
  const deliveryMode = order.delivery_mode || order.deliveryMode;

  if (action === 'accept') {
    if (channel === 'getir') return '550';
    return 'Accepted';
  }

  if (action === 'ready') {
    if (channel === 'yemeksepeti') return 'READY_FOR_PICKUP';
    if (channel === 'getir') {
      return deliveryMode === 'platform_courier' ? '700' : '600';
    }
    return 'Picked';
  }

  return order.channel_status || '';
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
  const env = platformEnv || (await readPlatformConfigEnv(paths.platformEnv));
  // Panel/runtime dosyası tek kaynak — uzun ömürlü process.env gölge modunu ezmesin.
  const config = resolveOpsHubConfig(env);
  return {
    publicApiBaseUrl: config.publicApiBaseUrl,
    shadowModeDefault: config.shadowModeDefault,
    liveMode: !config.shadowModeDefault,
    pushConfigured: isPushConfigured(env),
    flags: config.flags
  };
}
