import { fetchGetirOrderById } from '../../channels/getir-api.js';
import { resolveGetirExternalId, unwrapGetirOrderPayload } from '../../channels/getir-order-payload.js';
import { findOpsOrderByChannelExternalId, ensureDefaultBranch } from '../db/repository.js';
import { normalizeGetirPollOrder } from '../channels/getir-normalize.js';
import { ingestNormalizedGetirPollOrder } from './getir-sync.js';
import { createLogger } from '../../logger.js';

const log = createLogger('GETIR-GAP');

export function collectUnapprovedExternalIds(unapproved = []) {
  const ids = new Set();
  for (const rawRow of unapproved) {
    const externalId = resolveGetirExternalId(unwrapGetirOrderPayload(rawRow));
    if (externalId) ids.add(externalId);
  }
  return ids;
}

async function resolveBranchId(pool, branchId) {
  if (branchId) return branchId;
  const branch = await ensureDefaultBranch(pool);
  return branch.id;
}

async function upsertUnapprovedSnapshot(pool, branchId, unapproved = []) {
  for (const rawRow of unapproved) {
    const row = unwrapGetirOrderPayload(rawRow);
    const externalId = resolveGetirExternalId(row);
    if (!externalId) continue;

    await pool.query(
      `INSERT INTO ops_getir_unapproved_seen (branch_id, external_id, confirmation_id, last_seen_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (branch_id, external_id)
       DO UPDATE SET
         last_seen_at = NOW(),
         confirmation_id = COALESCE(EXCLUDED.confirmation_id, ops_getir_unapproved_seen.confirmation_id)`,
      [branchId, externalId, row?.confirmationId ? String(row.confirmationId) : null]
    );
  }
}

async function listPreviouslySeenUnapproved(pool, branchId, currentIds) {
  const result = await pool.query(
    `SELECT external_id, confirmation_id
     FROM ops_getir_unapproved_seen
     WHERE branch_id = $1`,
    [branchId]
  );

  return result.rows.filter((row) => !currentIds.has(row.external_id));
}

async function clearUnapprovedSnapshot(pool, branchId, externalId) {
  await pool.query(
    `DELETE FROM ops_getir_unapproved_seen
     WHERE branch_id = $1 AND external_id = $2`,
    [branchId, externalId]
  );
}

/**
 * Getir unapproved kuyruğunda görülüp sonra kaybolan (onaylanmış) siparişleri
 * fetch-by-id ile ingest eder — webhook kaçırıldıysa yedek yol.
 */
export async function recoverVanishedGetirUnapprovedOrders(pool, options = {}) {
  const branchId = await resolveBranchId(pool, options.branchId);
  const unapproved = options.unapproved || [];
  const currentIds = collectUnapprovedExternalIds(unapproved);
  const vanished = await listPreviouslySeenUnapproved(pool, branchId, currentIds);

  const results = {
    snapshotCount: currentIds.size,
    vanishedChecked: vanished.length,
    recovered: 0,
    alreadyKnown: 0,
    failed: 0,
    errors: []
  };

  if (!vanished.length) {
    await upsertUnapprovedSnapshot(pool, branchId, unapproved);
    return results;
  }

  const cfg = options.cfg;
  const session = options.session;
  const db = options.db;
  const platformEnv = options.platformEnv;

  for (const row of vanished) {
    const externalId = row.external_id;
    const existing = await findOpsOrderByChannelExternalId(pool, 'getir', externalId);
    if (existing) {
      results.alreadyKnown += 1;
      await clearUnapprovedSnapshot(pool, branchId, externalId);
      continue;
    }

    try {
      const remote = await fetchGetirOrderById(cfg, session, externalId);
      if (!remote) {
        results.failed += 1;
        results.errors.push({ externalId, confirmationId: row.confirmation_id, errors: ['Getir fetch boş'] });
        await clearUnapprovedSnapshot(pool, branchId, externalId);
        continue;
      }

      const normalized = await normalizeGetirPollOrder(remote, {
        db,
        platformEnv,
        shopId: cfg.shopId,
        endpointKind: 'partner_api',
        shadowMode: options.shadowMode ?? true,
        ingestSource: 'partner_api'
      });

      if (!normalized.ok) {
        results.failed += 1;
        results.errors.push({
          externalId,
          confirmationId: row.confirmation_id,
          errors: normalized.errors
        });
        continue;
      }

      const ingest = await ingestNormalizedGetirPollOrder(pool, normalized, options);
      results.recovered += ingest.duplicate ? 0 : 1;
      if (ingest.duplicate) results.alreadyKnown += 1;

      log.info(`Unapproved gap recovery: ${normalized.order.displayId || externalId} ingest=${ingest.duplicate ? 'duplicate' : 'new'}`);
    } catch (error) {
      results.failed += 1;
      results.errors.push({
        externalId,
        confirmationId: row.confirmation_id,
        errors: [error.message]
      });
    } finally {
      await clearUnapprovedSnapshot(pool, branchId, externalId);
    }
  }

  await upsertUnapprovedSnapshot(pool, branchId, unapproved);
  return results;
}
