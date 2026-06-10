import { randomUUID } from 'node:crypto';
import { readEnvFile } from '../../env.js';
import { paths, resolveRuntimeConfig } from '../../config.js';
import { readDb } from '../../db/store.js';
import { createBenimposClient, readBenimposConfig } from '../../benimpos/client.js';
import {
  buildChannelSaleFromOrder,
  createSale
} from '../../benimpos/sales-create.js';
import { BENIMPOS_SALE_CONFIRM_LEVELS } from '../../product-matching/sales-readiness.js';
import { resolveOpsHubConfig } from '../config.js';
import { getOpsOrderById } from '../db/repository.js';
import { insertShadowEvent } from '../db/repository.js';
import { mapOrderRow } from '../picking/picking-service.js';
import { mapOpsChannelToBuybox, opsOrderToBenimposPackage } from './ops-order-mapper.js';

export function isBenimposSaleWriteEnabled(platformEnv = {}) {
  return Boolean(resolveOpsHubConfig(platformEnv).flags.FF_BENIMPOS_SALE_WRITE);
}

export function buildBenimposSaleSimulation(order, built) {
  return {
    dryRun: true,
    channel: order.channel,
    displayId: order.display_id,
    payload: built?.payload || null,
    saleLineCount: built?.saleLines?.length || 0,
    skippedLineCount: built?.skippedLines?.length || 0,
    note: 'FF_BENIMPOS_SALE_WRITE kapalı — BenimPOS create çağrılmadı'
  };
}

export async function buildOpsBenimposSale(pool, orderId, platformEnv = null) {
  const env = platformEnv || (await readEnvFile(paths.platformEnv));
  const detail = await getOpsOrderById(pool, orderId);
  if (!detail) {
    return null;
  }

  const { order, lines } = detail;
  const buyboxChannelId = mapOpsChannelToBuybox(order.channel);
  if (!buyboxChannelId) {
    throw new Error(`BenimPOS eşlemesi yok: ${order.channel}`);
  }

  const runtime = resolveRuntimeConfig(env);
  const confirmLevel =
    runtime.benimposSaleConfirmLevel === 'manual_only'
      ? BENIMPOS_SALE_CONFIRM_LEVELS.MANUAL_ONLY
      : BENIMPOS_SALE_CONFIRM_LEVELS.AUTO_OR_MANUAL;

  const db = await readDb();
  const orderPackage = opsOrderToBenimposPackage(order, lines);

  const built = buildChannelSaleFromOrder(orderPackage, db, {
    channelId: buyboxChannelId,
    salePolicy: 'sale-strict',
    confirmLevel,
    mode: runtime.productMatchingMode
  });

  return { order, lines, built, buyboxChannelId, confirmLevel };
}

export async function submitBenimposSale(pool, orderId, options = {}) {
  const env = options.platformEnv || (await readEnvFile(paths.platformEnv));
  const flagEnabled = isBenimposSaleWriteEnabled(env);
  const prepared = await buildOpsBenimposSale(pool, orderId, env);

  if (!prepared) {
    return null;
  }

  const { order, built } = prepared;

  if (order.benimpos_sales_code) {
    return {
      duplicate: true,
      salesCode: order.benimpos_sales_code,
      order: mapOrderRow(order)
    };
  }

  if (!['picked', 'ready', 'completed'].includes(order.status)) {
    const error = new Error(`BenimPOS satışı için picking tamamlanmalı (durum: ${order.status})`);
    error.statusCode = 409;
    throw error;
  }

  const dryRun = !flagEnabled || (order.shadow_mode && !options.forceLive);

  let result;
  if (dryRun) {
    result = {
      ok: true,
      dryRun: true,
      ...buildBenimposSaleSimulation(order, built)
    };
  } else {
    const cfg = await readBenimposConfig(env);
    const client = createBenimposClient(cfg);
    const saleOrder = {
      paymentType: built.payload.data.paymentType,
      note: built.payload.data.note,
      customerCode: built.payload.data.customerCode,
      lines: built.saleLines
    };
    result = await createSale(client, saleOrder, { dryRun: false });
  }

  if (!dryRun && result.salesCode) {
    await pool.query(
      `UPDATE ops_orders
       SET benimpos_sales_code = $1, updated_at = NOW()
       WHERE id = $2`,
      [result.salesCode, orderId]
    );

    for (const line of built.saleLines) {
      await pool.query(
        `UPDATE ops_order_lines
         SET benimpos_sales_code = $1, updated_at = NOW()
         WHERE order_id = $2 AND barcode = $3`,
        [result.salesCode, orderId, line.saleBarcode]
      );
    }
  }

  await insertShadowEvent(pool, {
    branchId: order.branch_id,
    orderId,
    eventType: dryRun ? 'benimpos_sale_simulation' : 'benimpos_sale_write',
    payload: {
      dryRun,
      salesCode: result.salesCode || null,
      payload: built.payload,
      skippedLines: built.skippedLines
    }
  });

  await enqueueBenimposOutbox(pool, {
    branchId: order.branch_id,
    orderId,
    dryRun,
    payload: result,
    salesCode: result.salesCode || null
  });

  const updated = await getOpsOrderById(pool, orderId);
  return {
    duplicate: false,
    dryRun,
    flagEnabled,
    salesCode: result.salesCode || null,
    message: result.message || (dryRun ? 'Satış simüle edildi' : 'Satış oluşturuldu'),
    payload: built.payload,
    skippedLines: built.skippedLines,
    saleLines: built.saleLines,
    order: mapOrderRow(updated.order)
  };
}

export async function cancelBenimposSale(pool, orderId, options = {}) {
  const env = options.platformEnv || (await readEnvFile(paths.platformEnv));
  const flagEnabled = isBenimposSaleWriteEnabled(env);
  const detail = await getOpsOrderById(pool, orderId);

  if (!detail) {
    return null;
  }

  const { order } = detail;
  const salesCode = order.benimpos_sales_code;
  if (!salesCode) {
    const error = new Error('İptal edilecek BenimPOS salesCode yok');
    error.statusCode = 404;
    throw error;
  }

  const dryRun = !flagEnabled || (order.shadow_mode && !options.forceLive);

  let result;
  if (dryRun) {
    result = { ok: true, dryRun: true, salesCode, note: 'İptal simüle edildi' };
  } else {
    const cfg = await readBenimposConfig(env);
    const client = createBenimposClient(cfg);
    result = await client.request('sales', {
      processType: 'cancel',
      data: { salesCode }
    });
  }

  if (!dryRun) {
    await pool.query(
      `UPDATE ops_orders SET benimpos_sales_code = NULL, updated_at = NOW() WHERE id = $1`,
      [orderId]
    );
  }

  await insertShadowEvent(pool, {
    branchId: order.branch_id,
    orderId,
    eventType: dryRun ? 'benimpos_cancel_simulation' : 'benimpos_cancel_write',
    payload: { dryRun, salesCode, result }
  });

  return { dryRun, flagEnabled, salesCode, result, order: mapOrderRow(order) };
}

async function enqueueBenimposOutbox(pool, { branchId, orderId, dryRun, payload, salesCode }) {
  const idempotencyKey = `benimpos_sale:${orderId}:${dryRun ? 'dry' : 'live'}`;
  await pool.query(
    `INSERT INTO ops_outbox (
       id, branch_id, order_id, message_type, payload, status, idempotency_key, processed_at
     ) VALUES ($1, $2, $3, 'benimpos_sale', $4::jsonb, 'done', $5, NOW())
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [randomUUID(), branchId, orderId, JSON.stringify({ dryRun, payload, salesCode }), idempotencyKey]
  );
}
