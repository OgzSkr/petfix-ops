import { randomUUID } from 'node:crypto';
import { readEnvFile, readPlatformConfigEnv, envValue } from '../../env.js';
import { paths, resolveRuntimeConfig } from '../../config.js';
import { readDb } from '../../db/store.js';
import { createBenimposClient, readBenimposConfig } from '../../benimpos/client.js';
import {
  buildChannelSaleFromOrder,
  createSale,
  saleOrderFromBuilt
} from '../../benimpos/sales-create.js';
import { BENIMPOS_SALE_CONFIRM_LEVELS } from '../../product-matching/sales-readiness.js';
import { resolveOpsHubConfig } from '../config.js';
import { getOpsOrderById } from '../db/repository.js';
import { insertShadowEvent } from '../db/repository.js';
import { mapOrderRow } from '../picking/picking-service.js';
import { mapOpsChannelToBuybox, opsOrderToBenimposPackage } from './ops-order-mapper.js';
import { buildChannelSalePreview } from '../../product-matching/sale-preview.js';
import { enrichPreviewWithSaleGate } from '../../product-matching/sales-readiness.js';

const SETTLEMENT_PACKAGE_KEYS = [
  'portalFinancials',
  'packageGrossAmount',
  'packageTotalDiscount',
  'packagePortalCommissionAmount',
  'packageSaleCommissionAmount',
  'packageDiscountCommissionAmount',
  'packageSellerRevenue',
  'packageDiscountSellerRevenue',
  'packageProvisionAmount',
  'packageProvisionNet',
  'getirFinancials'
];

function mergeSettlementFields(basePackage, livePackage) {
  if (!livePackage) return basePackage;
  const merged = { ...basePackage };
  for (const key of SETTLEMENT_PACKAGE_KEYS) {
    const value = livePackage[key];
    if (value != null && value !== '') {
      merged[key] = value;
    }
  }
  if (livePackage.portalFinancials?.loaded) {
    merged.portalFinancials = livePackage.portalFinancials;
  }
  if (livePackage.getirFinancials?.loaded) {
    merged.getirFinancials = livePackage.getirFinancials;
  }
  return merged;
}

async function enrichBenimposPackageWithSettlement(orderPackage, order, pool, platformEnv) {
  const channel = String(order?.channel || '').trim();
  if (channel === 'trendyol_go') {
    try {
      const { resolveTgoOpsConfig } = await import('../integrations/branch-config-resolver.js');
      const { isTgoOpsConfigured } = await import('../channels/tgo-normalize.js');
      const { fetchUberEatsOrderPackageByNumber } = await import('../../channels/uber-eats-orders.js');
      const cfg = await resolveTgoOpsConfig(pool, {
        branchId: order.branch_id,
        platformEnv
      });
      if (!isTgoOpsConfigured(cfg)) return orderPackage;

      const orderRef = String(order.display_id || order.external_id || '').trim();
      const orderDateMs = order.ordered_at ? new Date(order.ordered_at).getTime() : null;
      const live = await fetchUberEatsOrderPackageByNumber(cfg, orderRef, { orderDateMs });
      return mergeSettlementFields(orderPackage, live);
    } catch {
      return orderPackage;
    }
  }

  if (channel === 'getir') {
    try {
      const { resolveGetirOpsConfig } = await import('../integrations/branch-config-resolver.js');
      const { fetchGetirOrderPackageByNumber, orderPackageHasGetirFinancials } =
        await import('../../channels/getir-orders.js');
      const cfg = await resolveGetirOpsConfig(pool, {
        branchId: order.branch_id,
        platformEnv
      });
      const orderRef = String(order.display_id || order.external_id || '').trim();
      if (orderPackageHasGetirFinancials(orderPackage)) {
        return orderPackage;
      }
      const orderDateMs = order.ordered_at ? new Date(order.ordered_at).getTime() : null;
      const live = await fetchGetirOrderPackageByNumber(cfg, orderRef, { orderDateMs });
      return mergeSettlementFields(orderPackage, live);
    } catch {
      return orderPackage;
    }
  }

  return orderPackage;
}

async function ensureTgoSourceLines(order, pool, platformEnv) {
  if (order?.channel !== 'trendyol_go') return order;
  if (order.raw_payload?.tgoSourceLines?.length) return order;

  try {
    const { resolveTgoOpsConfig } = await import('../integrations/branch-config-resolver.js');
    const { fetchTgoGroceryPackages } = await import('../channels/tgo-grocery-fetch.js');
    const { isTgoOpsConfigured } = await import('../channels/tgo-normalize.js');
    const cfg = await resolveTgoOpsConfig(pool, {
      branchId: order.branch_id,
      platformEnv
    });
    if (!isTgoOpsConfigured(cfg)) return order;

    const displayId = String(order.display_id || order.external_id || '').trim();
    const packages = await fetchTgoGroceryPackages(cfg, { maxPages: 25, pageSize: 100 });
    const pkg = packages.find((row) => String(row.orderNumber || '').trim() === displayId);
    if (!pkg?.lines?.length) return order;

    return {
      ...order,
      raw_payload: {
        ...(order.raw_payload || {}),
        tgoSourceLines: pkg.lines
      }
    };
  } catch {
    return order;
  }
}

export function isBenimposAutoSaleEnabled(platformEnv = {}) {
  const raw = envValue(process.env, platformEnv, 'BENIMPOS_AUTO_SALE', 'false');
  return String(raw).toLowerCase() === 'true' || raw === '1';
}

export function isBenimposSaleWriteEnabled(platformEnv = {}) {
  // Panel/runtime birleşik env tek kaynak — uzun ömürlü process.env gölge modunu ezmesin.
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

async function loadBenimposPlatformEnv(platformEnv = null) {
  return platformEnv || (await readPlatformConfigEnv(paths.platformEnv));
}

export async function buildOpsBenimposSale(pool, orderId, platformEnv = null, options = {}) {
  const env = await loadBenimposPlatformEnv(platformEnv);
  const detail = await getOpsOrderById(pool, orderId);
  if (!detail) {
    return null;
  }

  let { order, lines } = detail;
  order = await ensureTgoSourceLines(order, pool, env);
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
  let orderPackage = opsOrderToBenimposPackage(order, lines);
  orderPackage = await enrichBenimposPackageWithSettlement(orderPackage, order, pool, env);

  const built = buildChannelSaleFromOrder(orderPackage, db, {
    channelId: buyboxChannelId,
    salePolicy: 'sale-strict',
    confirmLevel,
    mode: runtime.productMatchingMode,
    allowEmpty: options.preview === true
  });

  return { order, lines, built, buyboxChannelId, confirmLevel };
}

export async function buildOpsBenimposPreviewPayload(pool, orderId, platformEnv = null) {
  const env = await loadBenimposPlatformEnv(platformEnv);
  const prepared = await buildOpsBenimposSale(pool, orderId, env, { preview: true });
  if (!prepared) return null;

  const { order, lines, built, buyboxChannelId, confirmLevel } = prepared;
  const db = await readDb();
  let orderPackage = opsOrderToBenimposPackage(order, lines);
  orderPackage = await enrichBenimposPackageWithSettlement(orderPackage, order, pool, env);
  const channelPreview = enrichPreviewWithSaleGate(
    buildChannelSalePreview(orderPackage, db, { channelId: buyboxChannelId }),
    confirmLevel
  );

  const saleBlocked = built.saleBlocked || !channelPreview.canSendRealSale;
  const blockReason = built.saleBlocked
    ? built.blockReason
    : (channelPreview.blockReasons[0] || null);

  return {
    ok: !saleBlocked,
    saleBlocked,
    error: saleBlocked ? blockReason : null,
    payload: saleBlocked ? null : built.payload,
    saleLines: built.saleLines,
    skippedLines: built.skippedLines,
    lines: channelPreview.lines,
    channelId: buyboxChannelId,
    canSend: channelPreview.canSendRealSale,
    sendableLines: channelPreview.sendableLines,
    blockedLines: channelPreview.blockedLines,
    totalLines: channelPreview.totalLines,
    blockReasons: channelPreview.blockReasons,
    financials: built.financials || null,
    benimposSaleTotals: built.benimposSaleTotals || null,
    discountRate: built.payload?.data?.discountRate ?? null,
    settlementLoaded: Boolean(
      built.financials?.settlementLoaded ||
        orderPackage?.portalFinancials?.loaded ||
        orderPackage?.getirFinancials?.loaded
    )
  };
}

export async function submitBenimposSale(pool, orderId, options = {}) {
  const env = await loadBenimposPlatformEnv(options.platformEnv);
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

  if (!['picked', 'ready', 'dispatched', 'completed'].includes(order.status)) {
    const error = new Error(`BenimPOS satışı için sipariş hazırlanmış olmalı (durum: ${order.status})`);
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
    result = await createSale(client, saleOrderFromBuilt(built), { dryRun: false });
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

export async function maybeAutoSubmitBenimposSale(pool, orderId, platformEnv) {
  const env = await loadBenimposPlatformEnv(platformEnv);
  if (!isBenimposAutoSaleEnabled(env)) {
    return null;
  }

  try {
    return await submitBenimposSale(pool, orderId, { platformEnv: env });
  } catch (error) {
    return {
      ok: false,
      autoSaleError: error.message || String(error),
      statusCode: error.statusCode || 500
    };
  }
}

export async function cancelBenimposSale(pool, orderId, options = {}) {
  const env = await loadBenimposPlatformEnv(options.platformEnv);
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
