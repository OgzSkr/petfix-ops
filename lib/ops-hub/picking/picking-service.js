import { normalizeBarcode } from '../../product-matching/normalize.js';
import { insertShadowEvent } from '../db/repository.js';

const PICKABLE_STATUSES = new Set(['received', 'picking']);

export function normalizeScanBarcode(value) {
  return normalizeBarcode(String(value || '').trim());
}

export function findLineForBarcode(lines, barcode) {
  const code = normalizeScanBarcode(barcode);
  if (!code) {
    return null;
  }

  return (
    lines.find((line) => normalizeScanBarcode(line.barcode) === code) ||
    lines.find((line) => normalizeScanBarcode(line.channel_product_id) === code) ||
    null
  );
}

export function computePickingProgress(lines) {
  const actionable = lines.filter((line) => line.matching_status !== 'blocked');
  const totalQty = actionable.reduce((sum, line) => sum + Number(line.quantity || 0), 0);
  const pickedQty = actionable.reduce((sum, line) => sum + Number(line.picked_qty || 0), 0);
  const completeLines = actionable.filter(
    (line) => Number(line.picked_qty || 0) >= Number(line.quantity || 0)
  ).length;

  return {
    totalLines: lines.length,
    actionableLines: actionable.length,
    completeLines,
    totalQty,
    pickedQty,
    isComplete: actionable.length > 0 && completeLines === actionable.length
  };
}

export async function startPicking(pool, orderId) {
  const detail = await getOrderDetail(pool, orderId);
  if (!detail) {
    return null;
  }

  const { order } = detail;
  if (!PICKABLE_STATUSES.has(order.status) && order.status !== 'picked') {
    const error = new Error(`Sipariş durumu picking için uygun değil: ${order.status}`);
    error.statusCode = 409;
    throw error;
  }

  if (order.status === 'received') {
    await pool.query(
      `UPDATE ops_orders
       SET status = 'picking', picking_started_at = COALESCE(picking_started_at, NOW()), updated_at = NOW()
       WHERE id = $1`,
      [orderId]
    );

    await insertShadowEvent(pool, {
      branchId: order.branch_id,
      orderId,
      eventType: 'picking_started',
      payload: { shadowMode: order.shadow_mode, channel: order.channel }
    });
  }

  return getOrderDetail(pool, orderId);
}

export async function scanPickingBarcode(pool, orderId, barcode, qty = 1) {
  const detail = await getOrderDetail(pool, orderId);
  if (!detail) {
    return null;
  }

  const { order, lines } = detail;
  if (!['picking', 'received'].includes(order.status)) {
    const error = new Error('Sipariş picking modunda değil.');
    error.statusCode = 409;
    throw error;
  }

  if (order.status === 'received') {
    await startPicking(pool, orderId);
  }

  const refreshed = await getOrderDetail(pool, orderId);
  const line = findLineForBarcode(refreshed.lines, barcode);
  if (!line) {
    const error = new Error('Barkod sipariş satırlarında bulunamadı.');
    error.statusCode = 404;
    throw error;
  }

  if (line.matching_status === 'blocked') {
    const error = new Error('Bu satır strict eşleştirmede bloklu — toplanamaz.');
    error.statusCode = 422;
    throw error;
  }

  const increment = Math.max(1, Number(qty) || 1);
  const targetQty = Number(line.quantity || 0);
  const current = Number(line.picked_qty || 0);
  const next = Math.min(targetQty, current + increment);

  await pool.query(
    `UPDATE ops_order_lines
     SET picked_qty = $1, updated_at = NOW()
     WHERE id = $2`,
    [next, line.id]
  );

  await insertShadowEvent(pool, {
    branchId: order.branch_id,
    orderId,
    eventType: 'picking_scan',
    payload: {
      barcode: normalizeScanBarcode(barcode),
      lineIndex: line.line_index,
      pickedQty: next,
      targetQty,
      shadowMode: order.shadow_mode
    }
  });

  return getOrderDetail(pool, orderId);
}

export async function completePicking(pool, orderId) {
  const detail = await getOrderDetail(pool, orderId);
  if (!detail) {
    return null;
  }

  const { order, lines } = detail;
  const progress = computePickingProgress(lines);

  if (!progress.isComplete) {
    const error = new Error(
      `Toplama tamamlanmadı (${progress.completeLines}/${progress.actionableLines} satır).`
    );
    error.statusCode = 422;
    throw error;
  }

  await pool.query(
    `UPDATE ops_orders
     SET status = 'picked', picking_completed_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [orderId]
  );

  await insertShadowEvent(pool, {
    branchId: order.branch_id,
    orderId,
    eventType: 'picking_completed',
    payload: {
      shadowMode: order.shadow_mode,
      channel: order.channel,
      note: 'Shadow mode — kanala yazma yapılmadı'
    }
  });

  return getOrderDetail(pool, orderId);
}

async function getOrderDetail(pool, orderId) {
  const orderResult = await pool.query('SELECT * FROM ops_orders WHERE id = $1 LIMIT 1', [orderId]);
  const order = orderResult.rows[0];
  if (!order) {
    return null;
  }

  const linesResult = await pool.query(
    `SELECT * FROM ops_order_lines WHERE order_id = $1 ORDER BY line_index ASC`,
    [orderId]
  );

  const lines = linesResult.rows;
  return {
    order,
    lines,
    progress: computePickingProgress(lines)
  };
}

export async function getPickingOrderView(pool, orderId) {
  const detail = await getOrderDetail(pool, orderId);
  if (!detail) {
    return null;
  }

  return {
    order: mapOrderRow(detail.order),
    lines: detail.lines.map(mapLineRow),
    progress: detail.progress
  };
}

export function mapOrderRow(row) {
  return {
    id: row.id,
    channel: row.channel,
    externalId: row.external_id,
    displayId: row.display_id,
    status: row.status,
    channelStatus: row.channel_status,
    deliveryMode: row.delivery_mode,
    shadowMode: row.shadow_mode,
    orderedAt: row.ordered_at,
    pickingStartedAt: row.picking_started_at,
    pickingCompletedAt: row.picking_completed_at,
    benimposSalesCode: row.benimpos_sales_code || null
  };
}

export function mapLineRow(row) {
  return {
    id: row.id,
    lineIndex: row.line_index,
    channelProductId: row.channel_product_id,
    barcode: row.barcode,
    title: row.title,
    quantity: Number(row.quantity),
    pickedQty: Number(row.picked_qty || 0),
    matchingStatus: row.matching_status,
    unitPrice: row.unit_price != null ? Number(row.unit_price) : null
  };
}

export async function listPickingQueue(pool, { branchId, limit = 50 } = {}) {
  const params = [branchId, limit];
  const result = await pool.query(
    `SELECT id, channel, external_id, display_id, status, shadow_mode, ordered_at, delivery_mode
     FROM ops_orders
     WHERE branch_id = $1 AND status IN ('received', 'picking')
     ORDER BY ordered_at ASC
     LIMIT $2`,
    params
  );
  return result.rows.map(mapOrderRow);
}
