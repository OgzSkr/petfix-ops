import { readEnvFile } from '../../env.js';
import { paths } from '../../config.js';
import { insertShadowEvent } from '../db/repository.js';
import { mapOrderRow } from '../picking/picking-service.js';
import { buildOrderCustomerView } from '../customer/order-customer-view.js';
import { isChannelStatusWriteEnabled } from '../channel/channel-status-service.js';
import { writeGetirOrderDelivered } from '../channels/getir-status-write.js';
import { isGetirChannelCompleted } from '../channels/getir-normalize.js';

import { STAFF_DAY_ORDERED_AT_SQL } from '../staff/staff-day.js';

function isGetirDeliverOutOfSync(order) {
  return order.channel === 'getir'
    && order.status === 'completed'
    && !isGetirChannelCompleted(order.channel_status);
}

export async function listCourierQueue(pool, {
  branchId,
  limit = 50,
  liveOnly = false,
  since = null,
  staffDay = false
} = {}) {
  const params = [branchId];
  const clauses = [
    'branch_id = $1',
    `delivery_mode = 'own_courier'`,
    `(status = 'ready' OR (channel = 'getir' AND status = 'completed' AND channel_status NOT IN ('900', '1500')))`
  ];
  if (liveOnly) {
    clauses.push('shadow_mode = false');
  }
  if (staffDay) {
    clauses.push(STAFF_DAY_ORDERED_AT_SQL);
  } else if (since) {
    params.push(since);
    clauses.push(`ordered_at >= $${params.length}`);
  }
  params.push(limit);
  const result = await pool.query(
    `SELECT id, channel, external_id, display_id, status, channel_status, shadow_mode, ordered_at,
            delivery_mode, customer_masked, raw_payload,
            (SELECT COALESCE(SUM(l.quantity * COALESCE(l.unit_price, 0)), 0)
             FROM ops_order_lines l WHERE l.order_id = ops_orders.id) AS line_total
     FROM ops_orders
     WHERE ${clauses.join(' AND ')}
     ORDER BY ordered_at ASC
     LIMIT $${params.length}`,
    params
  );

  return result.rows.map((row) => ({
    ...mapOrderRow(row, { lineTotal: row.line_total }),
    ...buildOrderCustomerView(row, {
      displayId: row.display_id,
      externalId: row.external_id
    })
  }));
}

export async function deliverCourierOrder(pool, orderId, audit = {}, options = {}) {
  const orderResult = await pool.query(
    `SELECT *
     FROM ops_orders
     WHERE id = $1
     LIMIT 1`,
    [orderId]
  );
  const order = orderResult.rows[0];
  if (!order) {
    return null;
  }

  const outOfSyncRetry = isGetirDeliverOutOfSync(order);

  if (order.status !== 'ready' && !outOfSyncRetry) {
    const error = new Error(`Teslim için sipariş 'ready' olmalı (durum: ${order.status}).`);
    error.statusCode = 409;
    throw error;
  }

  if (order.delivery_mode !== 'own_courier') {
    const error = new Error('Bu sipariş işletme kuryesi teslimatı için uygun değil.');
    error.statusCode = 409;
    throw error;
  }

  const platformEnv = options.platformEnv || (await readEnvFile(paths.platformEnv));
  const flagEnabled = isChannelStatusWriteEnabled(platformEnv);
  let channelResult = null;
  let channelWriteFailed = false;

  if (order.channel === 'getir') {
    if (order.shadow_mode) {
      channelResult = {
        dryRun: true,
        note: 'Shadow sipariş — Getir teslim bildirimi yapılmadı'
      };
    } else if (!flagEnabled) {
      const error = new Error(
        'Getir teslim bildirimi kapalı — sipariş tamamlanmadı. Yöneticiye FF_CHANNEL_STATUS_WRITE açtırın.'
      );
      error.statusCode = 503;
      throw error;
    } else {
      try {
        channelResult = await writeGetirOrderDelivered(order, platformEnv, { pool });
      } catch (error) {
        channelWriteFailed = true;
        channelResult = { ok: false, error: error.message };
        const err = new Error(`Getir teslim bildirimi başarısız: ${error.message}`);
        err.statusCode = 502;
        err.channelResult = channelResult;
        throw err;
      }
    }
  }

  const nextChannelStatus = order.channel === 'getir' ? '900' : order.channel_status;

  await pool.query(
    `UPDATE ops_orders
     SET status = 'completed',
         channel_status = $2,
         completed_at = COALESCE(completed_at, NOW()),
         updated_at = NOW()
     WHERE id = $1`,
    [orderId, nextChannelStatus]
  );

  await insertShadowEvent(pool, {
    branchId: order.branch_id,
    orderId,
    eventType: channelResult?.dryRun ? 'courier_deliver_simulation' : 'courier_delivered',
    payload: {
      shadowMode: order.shadow_mode,
      channel: order.channel,
      staffName: audit.staffName || null,
      deviceName: audit.deviceName || null,
      channelResult,
      channelWriteFailed,
      outOfSyncRetry,
      note: channelResult?.dryRun
        ? channelResult.note
        : order.channel === 'getir'
          ? 'Getir deliver API doğrulandı'
          : 'Mobil kurye teslim onayı'
    }
  });

  const updated = await pool.query('SELECT * FROM ops_orders WHERE id = $1 LIMIT 1', [orderId]);
  return {
    ok: true,
    channelResult,
    channelWriteFailed,
    channelConfirmed: order.channel !== 'getir' || Boolean(channelResult?.verifiedStatus),
    order: mapOrderRow(updated.rows[0])
  };
}
