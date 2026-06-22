import { createLogger } from '../logger.js';
import { resolveOpsHubConfig } from './config.js';
import {
  getOpsPool,
  closeOpsPool,
  checkOpsDbReady,
  applyOpsMigrations
} from './db/migrate.js';
import { ensureDefaultBranch } from './db/repository.js';
import { bootstrapTenantAndGrants } from './branches/branch-service.js';

const log = createLogger('OPS-HUB');

let bootstrapped = false;
let opsState = {
  enabled: false,
  config: null,
  pool: null,
  branch: null,
  error: null
};

export function getOpsHubState() {
  return opsState;
}

export async function bootstrapOpsHub(platformEnv = {}) {
  const config = resolveOpsHubConfig(platformEnv);
  opsState = { enabled: false, config, pool: null, branch: null, error: null };

  if (!config.postgresEnabled) {
    log.warn('OPS_POSTGRES_URL tanımlı değil — Ops Hub devre dışı.');
    return opsState;
  }

  try {
    const pool = await getOpsPool(config.postgresUrl);
    await checkOpsDbReady(pool);
    await applyOpsMigrations(pool);
    await ensureDefaultBranch(pool);
    const { branch } = await bootstrapTenantAndGrants(pool, platformEnv);

    opsState = {
      enabled: true,
      config,
      pool,
      branch,
      error: null
    };
    bootstrapped = true;
    log.info(`Ops Hub hazır — şube: ${branch.slug}`);
  } catch (error) {
    opsState.error = error.message;
    log.error(`Ops Hub bootstrap başarısız: ${error.message}`);
  }

  return opsState;
}

export async function shutdownOpsHub() {
  await closeOpsPool();
  bootstrapped = false;
  opsState = { enabled: false, config: null, pool: null, branch: null, error: null };
}

export function isOpsHubReady() {
  return Boolean(opsState.enabled && opsState.pool);
}

export function getOpsHubPool() {
  if (!opsState.enabled || !opsState.pool) {
    const error = new Error(opsState.error || 'Ops Hub etkin değil (OPS_POSTGRES_URL gerekli).');
    error.statusCode = 503;
    throw error;
  }
  return opsState.pool;
}

export { bootstrapped };
