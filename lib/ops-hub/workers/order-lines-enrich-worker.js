/**
 * Yemeksepeti portal özet siparişlerine Partner API satır detayı ekleyen worker.
 * CLI'dan bağımsız; pool yaşam döngüsünü kendi yönetir, rapor döndürür.
 */
import { readEnvFile } from '../../env.js';
import { paths } from '../../config.js';
import { resolveOpsHubConfig } from '../config.js';
import { createOpsPool, closeOpsPool, applyOpsMigrations } from '../db/migrate.js';
import { ensureDefaultBranch } from '../db/repository.js';
import { enrichYemeksepetiOpsOrderLines } from '../sync/ys-order-lines-enrich.js';

/**
 * @param {object} [options]
 * @param {number} [options.limit]
 * @param {object} [options.platformEnv]
 * @returns {Promise<object>} enrich raporu
 */
export async function runYemeksepetiLinesEnrich(options = {}) {
  const limit = options.limit ?? 100;
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
    await ensureDefaultBranch(pool);
    return await enrichYemeksepetiOpsOrderLines(pool, { platformEnv, limit });
  } finally {
    await closeOpsPool();
  }
}
