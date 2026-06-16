import { randomUUID } from 'node:crypto';
import { readEnvFile } from '../../env.js';
import { paths } from '../../config.js';
import { readDb } from '../../db/store.js';
import { resolveOpsHubConfig } from '../config.js';
import { insertShadowEvent } from '../db/repository.js';
import { buildStockSyncPlan } from './stock-plan.js';
import { writeYemeksepetiStock, buildYemeksepetiStockPayload } from '../channels/yemeksepeti-stock-write.js';
import { buildTgoStockPushSimulation, writeTgoStock } from '../channels/tgo-stock-write.js';

export function isStockPushEnabled(platformEnv = {}) {
  return Boolean(resolveOpsHubConfig(platformEnv).flags.FF_STOCK_PUSH);
}

export function buildStockPushSimulation(plan, pushOptions = {}) {
  const { opsChannel, items, capability } = plan;
  if (opsChannel === 'trendyol_go') {
    return buildTgoStockPushSimulation(items, pushOptions);
  }
  if (opsChannel === 'yemeksepeti') {
    return {
      channel: 'yemeksepeti',
      dryRun: true,
      mode: pushOptions.mode || 'full',
      payload: buildYemeksepetiStockPayload(items, pushOptions),
      itemCount: items.length,
      note: 'FF_STOCK_PUSH kapalı — YS catalog PUT çağrılmadı'
    };
  }
  return {
    channel: opsChannel,
    dryRun: true,
    blocked: true,
    reason: capability?.reason || 'Kanal stok push desteklenmiyor',
    itemCount: items.length
  };
}

export async function previewStockDrift(opsChannel, options = {}) {
  const db = await readDb();
  const env = options.platformEnv || (await readEnvFile(paths.platformEnv));
  const minCoveragePercent =
    options.minCoveragePercent ??
    Number(env.OPS_STOCK_MIN_COVERAGE_PERCENT || process.env.OPS_STOCK_MIN_COVERAGE_PERCENT || 0);

  return buildStockSyncPlan(db, opsChannel, {
    ...options,
    minCoveragePercent
  });
}

async function dispatchStockPush(opsChannel, items, platformEnv, pushOptions = {}) {
  if (opsChannel === 'yemeksepeti') {
    return writeYemeksepetiStock(items, platformEnv, pushOptions);
  }
  if (opsChannel === 'trendyol_go') {
    return writeTgoStock(items, platformEnv, pushOptions);
  }
  throw Object.assign(new Error(`Stok push desteklenmiyor: ${opsChannel}`), { statusCode: 400 });
}

function normalizePushMode(mode) {
  const value = String(mode || 'full').trim();
  if (value === 'price' || value === 'stock') return value;
  return 'full';
}

function applyCustomPriceToPlan(plan, customPrice) {
  const price = Number(customPrice);
  if (!Number.isFinite(price) || price <= 0) return plan;
  return {
    ...plan,
    items: plan.items.map((item) => ({ ...item, targetPrice: price }))
  };
}

function validatePriceModePlan(plan) {
  if (plan.items.some((item) => !(Number(item.targetPrice) > 0))) {
    throw Object.assign(new Error('Fiyat gönderimi için geçerli bir satış fiyatı gerekli'), {
      statusCode: 400
    });
  }
}

async function enqueueStockOutbox(pool, { branchId, dryRun, payload, idempotencyKey }) {
  await pool.query(
    `INSERT INTO ops_outbox (
       id, branch_id, order_id, message_type, payload, status, idempotency_key, processed_at
     ) VALUES ($1, $2, NULL, 'stock_push', $3::jsonb, 'done', $4, NOW())
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [randomUUID(), branchId, JSON.stringify({ dryRun, payload }), idempotencyKey]
  );
}

export async function runStockSync(pool, options = {}) {
  const platformEnv = options.platformEnv || (await readEnvFile(paths.platformEnv));
  const opsChannel = String(options.channel || '').trim();
  if (!opsChannel) {
    throw Object.assign(new Error('channel zorunlu (trendyol_go | yemeksepeti | getir)'), {
      statusCode: 400
    });
  }

  const flagEnabled = isStockPushEnabled(platformEnv);
  const pushMode = normalizePushMode(options.mode);
  const pushOptions = { mode: pushMode };
  const forcePush = options.forcePush === true || pushMode === 'price' || pushMode === 'stock';
  let plan = await previewStockDrift(opsChannel, { ...options, platformEnv, forcePush });
  plan = applyCustomPriceToPlan(plan, options.customPrice);

  if (pushMode === 'price') {
    validatePriceModePlan(plan);
  }

  if (plan.summary.blockedByCoverage) {
    const error = new Error(
      `Eşleştirme coverage %${plan.summary.coveragePercent} — minimum %${plan.summary.minCoveragePercent} gerekli`
    );
    error.statusCode = 409;
    error.plan = plan;
    throw error;
  }

  const canLivePush = flagEnabled && plan.capability.livePush;
  const dryRun = !canLivePush || options.forceLive !== true;

  let pushResult;
  if (dryRun || !plan.items.length) {
    pushResult = buildStockPushSimulation(plan, pushOptions);
  } else {
    pushResult = await dispatchStockPush(opsChannel, plan.items, platformEnv, pushOptions);
  }

  const branchId = options.branchId;
  if (branchId) {
    await insertShadowEvent(pool, {
      branchId,
      orderId: null,
      eventType: dryRun ? 'stock_push_simulation' : 'stock_push_write',
      payload: {
        channel: opsChannel,
        mode: pushMode,
        dryRun,
        flagEnabled,
        summary: plan.summary,
        driftSummary: plan.driftSummary,
        pushCount: plan.items.length,
        pushResult
      }
    });

    const stamp = new Date().toISOString().slice(0, 16);
    await enqueueStockOutbox(pool, {
      branchId,
      dryRun,
      payload: { channel: opsChannel, summary: plan.summary, pushResult },
      idempotencyKey: `stock_push:${opsChannel}:${stamp}:${dryRun ? 'dry' : 'live'}`
    });
  }

  const actionLabel = pushMode === 'price' ? 'Fiyat' : pushMode === 'stock' ? 'Stok' : 'Stok/fiyat';

  const manualBarcodes = Array.isArray(options.barcodes)
    ? options.barcodes.map((barcode) => String(barcode || '').trim()).filter(Boolean)
    : [];

  return {
    ok: true,
    dryRun,
    flagEnabled,
    channel: opsChannel,
    mode: pushMode,
    plan,
    pushResult,
    message: dryRun
      ? plan.items.length
        ? `${actionLabel} push simüle edildi`
        : describeEmptyManualPush(plan, manualBarcodes, pushMode)
      : plan.items.length
        ? `${plan.items.length} satır ${actionLabel.toLowerCase()} kanala gönderildi`
        : describeEmptyManualPush(plan, manualBarcodes, pushMode)
  };
}

function describeEmptyManualPush(plan, manualBarcodes, pushMode) {
  if (manualBarcodes.length && plan.skipped.inactiveChannelProduct > 0 && pushMode !== 'price') {
    return 'YS\'de pasif ürün — stok gönderimi yapılamaz';
  }
  if (manualBarcodes.length) {
    return 'Gönderilecek ürün bulunamadı — eşleştirme veya barkodu kontrol edin';
  }
  return 'Güncellenecek satır yok';
}
