/**
 * unit_cost backfill — pool yaşam döngüsünü yönetir.
 */
import { readEnvFile } from '../../env.js';
import { paths } from '../../config.js';
import { resolveOpsHubConfig } from '../config.js';
import { createOpsPool, closeOpsPool, applyOpsMigrations } from '../db/migrate.js';
import { backfillOrderLineCosts } from '../sync/order-line-cost-backfill.js';

/**
 * @param {object} [options]
 * @param {number} [options.limit]
 * @param {boolean} [options.dryRun]
 * @param {object} [options.platformEnv]
 * @returns {Promise<object>}
 */
export async function runOrderLineCostBackfill(options = {}) {
  const limit = options.limit ?? 500;
  const platformEnv = options.platformEnv || (await readEnvFile(paths.platformEnv));
  const config = resolveOpsHubConfig(platformEnv);
  if (!config.postgresEnabled) {
    const err = new Error('OPS_POSTGRES_URL tanımlı değil');
    err.code = 'OPS_POSTGRES_DISABLED';
    throw err;
  }

  const pool = await createOpsPool(config.postgresUrl);
  try {
    await applyOpsMigrations(pool);
    return await backfillOrderLineCosts(pool, {
      limit,
      dryRun: Boolean(options.dryRun),
      platformEnv
    });
  } finally {
    await closeOpsPool();
  }
}
