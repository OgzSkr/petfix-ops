import { readDb } from '../../db/store.js';
import { buildChannelProductImageByBarcode } from '../../order-profitability.js';
import { normalizeBarcode } from '../../product-matching/normalize.js';
import { insertShadowEvent } from '../db/repository.js';
import { buildOrderCustomerView } from '../customer/order-customer-view.js';
import { mapOpsChannelToBuybox } from '../benimpos/ops-order-mapper.js';

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
  if (order.picking_completed_at) {
    const error = new Error('Sipariş zaten hazırlandı — tekrar toplanamaz.');
    error.statusCode = 409;
    throw error;
  }

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

export function canDepotPickOrder(order) {
  if (!order) return false;
  if (order.picking_completed_at && order.status !== 'received') {
    return false;
  }
  const depotOpen = !order.picking_completed_at;
  return (
    order.status === 'picking' ||
    order.status === 'received' ||
    (order.status === 'picked' && depotOpen)
  );
}

function assertPickingScanAllowed(order) {
  if (order.picking_completed_at && order.status !== 'received') {
    const error = new Error('Sipariş zaten hazırlandı — barkod okutulamaz.');
    error.statusCode = 409;
    throw error;
  }
  if (!canDepotPickOrder(order)) {
    const error = new Error('Sipariş picking modunda değil.');
    error.statusCode = 409;
    throw error;
  }
}

function assertLinePickable(line) {
  if (line.matching_status === 'blocked') {
    const error = new Error('Bu satır strict eşleştirmede bloklu — toplanamaz.');
    error.statusCode = 422;
    throw error;
  }
}

async function incrementLinePickedQty(pool, order, line, qty, eventType, eventPayload = {}) {
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
    orderId: order.id,
    eventType,
    payload: {
      lineIndex: line.line_index,
      pickedQty: next,
      targetQty,
      shadowMode: order.shadow_mode,
      ...eventPayload
    }
  });

  return next;
}

export async function pickPickingLine(pool, orderId, lineId, qty = 1) {
  const detail = await getOrderDetail(pool, orderId);
  if (!detail) {
    return null;
  }

  const { order } = detail;
  assertPickingScanAllowed(order);

  if (order.status === 'received') {
    await startPicking(pool, orderId);
  }

  const refreshed = await getOrderDetail(pool, orderId);
  const line = refreshed.lines.find((row) => String(row.id) === String(lineId));
  if (!line) {
    const error = new Error('Sipariş satırı bulunamadı.');
    error.statusCode = 404;
    throw error;
  }

  assertLinePickable(line);
  await incrementLinePickedQty(pool, refreshed.order, line, qty, 'picking_line_pick', {
    lineId: line.id,
    manual: true
  });

  return getOrderDetail(pool, orderId);
}

export async function scanPickingBarcode(pool, orderId, barcode, qty = 1) {
  const detail = await getOrderDetail(pool, orderId);
  if (!detail) {
    return null;
  }

  const { order } = detail;
  assertPickingScanAllowed(order);

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

  assertLinePickable(line);
  await incrementLinePickedQty(pool, refreshed.order, line, qty, 'picking_scan', {
    barcode: normalizeScanBarcode(barcode)
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

export async function getOrderDetail(pool, orderId) {
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

function toMoney(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function sumLineTotal(lines = []) {
  return lines.reduce(
    (sum, line) => sum + Number(line.quantity || 0) * Number(line.unit_price || 0),
    0
  );
}

/** Kanal uygulamasındaki indirimli müşteri tutarı (satır toplamı değil). */
export function resolveCustomerOrderTotal(row, lineTotal = null) {
  const raw = row.raw_payload || {};
  const channel = String(row.channel || '').trim();
  const fallback = toMoney(lineTotal);

  if (channel === 'trendyol_go') {
    return toMoney(raw.totalPrice) ?? fallback;
  }

  if (channel === 'getir') {
    return (
      toMoney(raw.totalPriceWithPackaging) ??
      toMoney(raw.totalPrice) ??
      toMoney(raw.totalAmount) ??
      toMoney(raw.grossAmount) ??
      fallback
    );
  }

  if (channel === 'yemeksepeti') {
    const ys = raw.yemeksepetiOrder || raw.order || raw;
    return (
      toMoney(ys.totalPrice) ??
      toMoney(ys.price?.total) ??
      toMoney(raw.grossAmount) ??
      fallback
    );
  }

  return fallback;
}

async function enrichPickingLinesWithImages(orderRow, mappedLines) {
  const buyboxChannelId = mapOpsChannelToBuybox(orderRow.channel);
  if (!buyboxChannelId) {
    return mappedLines;
  }

  const db = await readDb();
  const imageIndex = buildChannelProductImageByBarcode(db, buyboxChannelId);

  return mappedLines.map((line) => {
    if (line.imageUrl) {
      return line;
    }

    const keys = [
      line.barcode,
      line.channelProductId,
      normalizeBarcode(line.barcode),
      normalizeBarcode(line.channelProductId)
    ]
      .map((value) => String(value || '').trim())
      .filter(Boolean);

    for (const key of keys) {
      const url = imageIndex[key];
      if (url) {
        return { ...line, imageUrl: url };
      }
    }

    return line;
  });
}

export async function getPickingOrderView(pool, orderId) {
  const detail = await getOrderDetail(pool, orderId);
  if (!detail) {
    return null;
  }

  const lineTotal = sumLineTotal(detail.lines);
  const mappedLines = detail.lines.map(mapLineRow);
  const lines = await enrichPickingLinesWithImages(detail.order, mappedLines);

  return {
    order: mapOrderRow(detail.order, { lineTotal }),
    lines,
    progress: detail.progress,
    ...buildOrderCustomerView(detail.order, {
      displayId: detail.order.display_id,
      externalId: detail.order.external_id
    })
  };
}

function summarizeListPaymentMethod(row) {
  const raw = row.raw_payload || {};
  const channel = row.channel;
  const payment = raw.payment || raw.yemeksepetiOrder?.payment || {};

  if (channel === 'getir') {
    const code = raw.paymentMethod ?? raw.payment_method;
    if (code === 1 || code === '1') return 'Online';
    if (code === 2 || code === '2') return 'Nakit';
  }

  const method = payment.method || payment.type || raw.paymentMethod || null;
  if (!method) return 'Online';
  const normalized = String(method).toLowerCase();
  if (normalized.includes('cash') || normalized.includes('nakit')) return 'Nakit';
  return 'Online';
}

export function mapOrderRow(row, { lineTotal = null, lineCount = null, totalItemQty = null } = {}) {
  const totalAmount = resolveCustomerOrderTotal(row, lineTotal);

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
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
    pickingStartedAt: row.picking_started_at,
    pickingCompletedAt: row.picking_completed_at,
    benimposSalesCode: row.benimpos_sales_code || null,
    totalAmount,
    paymentMethod: summarizeListPaymentMethod(row),
    lineCount: lineCount != null ? Number(lineCount) : null,
    totalItemQty: totalItemQty != null ? Number(totalItemQty) : null
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
    unitPrice: row.unit_price != null ? Number(row.unit_price) : null,
    imageUrl: row.image_url || row.imageUrl || null
  };
}

import { STAFF_DAY_ORDERED_AT_SQL } from '../staff/staff-day.js';

export async function listPickingQueue(pool, {
  branchId,
  limit = 50,
  liveOnly = false,
  since = null,
  staffDay = false
} = {}) {
  const params = [branchId];
  const clauses = [
    'branch_id = $1',
    `status IN ('received', 'picking', 'picked')`
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
    `SELECT id, channel, external_id, display_id, status, channel_status, shadow_mode, ordered_at, delivery_mode,
            customer_masked, raw_payload,
            (SELECT COALESCE(SUM(l.quantity * COALESCE(l.unit_price, 0)), 0)
             FROM ops_order_lines l WHERE l.order_id = ops_orders.id) AS line_total,
            (SELECT COUNT(*)::int FROM ops_order_lines l WHERE l.order_id = ops_orders.id) AS line_count,
            (SELECT COALESCE(SUM(l.quantity), 0)::int FROM ops_order_lines l WHERE l.order_id = ops_orders.id) AS total_item_qty
     FROM ops_orders
     WHERE ${clauses.join(' AND ')}
     ORDER BY ordered_at ASC
     LIMIT $${params.length}`,
    params
  );
  return result.rows.map((row) => ({
    ...mapOrderRow(row, {
      lineTotal: row.line_total,
      lineCount: row.line_count,
      totalItemQty: row.total_item_qty
    }),
    ...buildOrderCustomerView(row, {
      displayId: row.display_id,
      externalId: row.external_id
    })
  }));
}
