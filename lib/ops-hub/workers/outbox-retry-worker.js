import { randomUUID } from 'node:crypto';
import { createLogger } from '../../logger.js';
import { submitBenimposSale } from '../benimpos/sale-outbox.js';
import { applyChannelStatus } from '../channel/channel-status-service.js';

const log = createLogger('OUTBOX-RETRY');

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 20;

async function claimPendingRows(pool) {
  const result = await pool.query(
    `SELECT ob.id, ob.branch_id, ob.order_id, ob.message_type, ob.payload, ob.attempts
     FROM ops_outbox ob
     WHERE ob.status IN ('pending', 'failed')
       AND ob.attempts < $1
     ORDER BY ob.created_at ASC
     LIMIT $2`,
    [MAX_ATTEMPTS, BATCH_SIZE]
  );
  return result.rows;
}

async function markProcessing(pool, id) {
  await pool.query(
    `UPDATE ops_outbox
     SET status = 'processing', attempts = attempts + 1
     WHERE id = $1`,
    [id]
  );
}

async function markDone(pool, id) {
  await pool.query(
    `UPDATE ops_outbox
     SET status = 'done', processed_at = NOW(), last_error = NULL
     WHERE id = $1`,
    [id]
  );
}

async function markFailed(pool, id, errorMessage) {
  await pool.query(
    `UPDATE ops_outbox
     SET status = CASE WHEN attempts >= $2 THEN 'failed' ELSE 'pending' END,
         last_error = $3
     WHERE id = $1`,
    [id, MAX_ATTEMPTS, String(errorMessage || 'unknown').slice(0, 500)]
  );
}

async function dispatchOutboxRow(pool, row, platformEnv) {
  const payload = row.payload || {};
  const orderId = row.order_id;

  switch (row.message_type) {
    case 'benimpos_sale':
      if (!orderId) throw new Error('benimpos_sale outbox order_id eksik');
      return submitBenimposSale(pool, orderId, {
        platformEnv,
        forceLive: payload.forceLive === true
      });
    case 'channel_status': {
      if (!orderId) throw new Error('channel_status outbox order_id eksik');
      const action = payload.action || 'accept';
      return applyChannelStatus(pool, orderId, action, {
        platformEnv,
        forceLive: payload.forceLive === true
      });
    }
    case 'stock_push':
      return { ok: true, skipped: true, note: 'stock_push retry henüz desteklenmiyor' };
    case 'benimpos_cancel':
      return { ok: true, skipped: true, note: 'benimpos_cancel retry henüz desteklenmiyor' };
    default:
      throw new Error(`Bilinmeyen outbox message_type: ${row.message_type}`);
  }
}

export async function runOutboxRetry(pool, options = {}) {
  if (!pool) {
    return { ok: false, skipped: true, reason: 'no_pool' };
  }

  const platformEnv = options.platformEnv || {};
  const rows = await claimPendingRows(pool);
  const report = {
    startedAt: new Date().toISOString(),
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    errors: []
  };

  for (const row of rows) {
    report.processed += 1;
    await markProcessing(pool, row.id);

    try {
      const result = await dispatchOutboxRow(pool, row, platformEnv);
      if (result?.skipped) {
        report.skipped += 1;
      } else {
        report.succeeded += 1;
      }
      await markDone(pool, row.id);
    } catch (error) {
      report.failed += 1;
      report.errors.push({
        id: row.id,
        messageType: row.message_type,
        error: error.message || String(error)
      });
      await markFailed(pool, row.id, error.message || String(error));
      log.warn(`Outbox retry başarısız (${row.message_type}/${row.id}): ${error.message}`);
    }
  }

  report.finishedAt = new Date().toISOString();
  report.ok = report.failed === 0;

  if (report.processed > 0) {
    log.info(`Outbox retry: ${report.succeeded} başarılı, ${report.failed} hata, ${report.skipped} atlandı`);
  }

  return report;
}

export async function getOutboxQueueSummary(pool) {
  if (!pool) {
    return { pending: 0, failed: 0, processing: 0 };
  }

  const result = await pool.query(
    `SELECT status, COUNT(*)::int AS count
     FROM ops_outbox
     WHERE status IN ('pending', 'failed', 'processing')
     GROUP BY status`
  );

  const summary = { pending: 0, failed: 0, processing: 0 };
  for (const row of result.rows) {
    summary[row.status] = Number(row.count) || 0;
  }
  return summary;
}

export async function enqueueBenimposSaleRetry(pool, { branchId, orderId, payload = {} }) {
  const idempotencyKey = `benimpos_sale_retry:${orderId}:${Date.now()}`;
  await pool.query(
    `INSERT INTO ops_outbox (
       id, branch_id, order_id, message_type, payload, status, idempotency_key
     ) VALUES ($1, $2, $3, 'benimpos_sale', $4::jsonb, 'pending', $5)`,
    [randomUUID(), branchId, orderId, JSON.stringify(payload), idempotencyKey]
  );
}
