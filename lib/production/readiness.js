import { validateProductionConfig, listCriticalConfigPresence } from './validate-config.js';
import { checkOpsDbReady, getOpsMigrationStatus } from '../ops-hub/db/migrate.js';
import { resolveOpsHubConfig } from '../ops-hub/config.js';

/**
 * /ready yanıtı — secret içermez.
 */
export async function buildReadinessReport(pool, platformEnv = {}) {
  const nodeEnv = String(process.env.NODE_ENV || platformEnv.NODE_ENV || 'development').toLowerCase();
  const checks = {
    database: 'fail',
    migrations: 'fail',
    config: 'fail',
    queue: 'ok'
  };
  const errors = [];

  if (pool) {
    try {
      const dbOk = await checkOpsDbReady(pool);
      checks.database = dbOk ? 'ok' : 'fail';
      if (!dbOk) errors.push('database_unreachable');
    } catch (error) {
      checks.database = 'fail';
      errors.push('database_error');
    }

    try {
      const migrations = await getOpsMigrationStatus(pool);
      const pending = migrations.filter((m) => !m.applied);
      checks.migrations = pending.length ? 'pending' : 'ok';
      if (pending.length) {
        errors.push(`migrations_pending:${pending.map((m) => m.name).join(',')}`);
      }
    } catch {
      checks.migrations = 'fail';
      errors.push('migrations_check_failed');
    }
  } else {
    errors.push('postgres_not_configured');
  }

  if (nodeEnv === 'production') {
    try {
      validateProductionConfig(platformEnv, process.env);
      checks.config = 'ok';
    } catch {
      checks.config = 'fail';
      errors.push('production_config_invalid');
    }
  } else {
    checks.config = 'ok';
  }

  const opsConfig = resolveOpsHubConfig(platformEnv);
  const ready = checks.database === 'ok'
    && checks.migrations === 'ok'
    && checks.config === 'ok'
    && opsConfig.postgresEnabled;

  return {
    status: ready ? 'ready' : 'not_ready',
    database: checks.database,
    migrations: checks.migrations,
    queue: checks.queue,
    config: checks.config,
    environment: nodeEnv,
    opsHubEnabled: opsConfig.enabled,
    criticalConfig: listCriticalConfigPresence(platformEnv, process.env),
    errors: errors.length ? errors : undefined
  };
}
