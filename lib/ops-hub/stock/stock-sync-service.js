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

export function buildStockPushSimulation(plan) {
  const { opsChannel, items, capability } = plan;
  if (opsChannel === 'trendyol_go') {
    return buildTgoStockPushSimulation(items);
  }
  if (opsChannel === 'yemeksepeti') {
    return {
      channel: 'yemeksepeti',
      dryRun: true,
      payload: buildYemeksepetiStockPayload(items),
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

async function dispatchStockPush(opsChannel, items, platformEnv) {
  if (opsChannel === 'yemeksepeti') {
    return writeYemeksepetiStock(items, platformEnv);
  }
  if (opsChannel === 'trendyol_go') {
    return writeTgoStock(items, platformEnv);
  }
  throw Object.assign(new Error(`Stok push desteklenmiyor: ${opsChannel}`), { statusCode: 400 });
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
  const plan = await previewStockDrift(opsChannel, { ...options, platformEnv });

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
    pushResult = buildStockPushSimulation(plan);
  } else {
    pushResult = await dispatchStockPush(opsChannel, plan.items, platformEnv);
  }

  const branchId = options.branchId;
  if (branchId) {
    await insertShadowEvent(pool, {
      branchId,
      orderId: null,
      eventType: dryRun ? 'stock_push_simulation' : 'stock_push_write',
      payload: {
        channel: opsChannel,
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

  return {
    ok: true,
    dryRun,
    flagEnabled,
    channel: opsChannel,
    plan,
    pushResult,
    message: dryRun
      ? plan.items.length
        ? 'Stok push simüle edildi'
        : 'Güncellenecek stok satırı yok'
      : `${plan.items.length} satır kanala gönderildi`
  };
}
