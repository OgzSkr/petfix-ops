#!/usr/bin/env node
/**
 * Migration 006 idempotency check — temiz veya mevcut DB'de iki kez uygulanabilir olmalı.
 * Kullanım: node scripts/verify-migration-006.js
 */
import { readEnvFile } from '../lib/env.js';
import { paths } from '../lib/config.js';
import { getOpsPool, applyOpsMigrations, getOpsMigrationStatus } from '../lib/ops-hub/db/migrate.js';

async function main() {
  const env = await readEnvFile(paths.platformEnv);
  const url = env.OPS_POSTGRES_URL || process.env.OPS_POSTGRES_URL;
  if (!url) {
    console.error(JSON.stringify({ ok: false, error: 'OPS_POSTGRES_URL tanımlı değil' }));
    process.exit(1);
  }

  const pool = await getOpsPool(url);
  const before = await getOpsMigrationStatus(pool);
  const applied1 = await applyOpsMigrations(pool);
  const applied2 = await applyOpsMigrations(pool);
  const after = await getOpsMigrationStatus(pool);

  const migration006 = after.find((row) => row.name === '006_performance_indexes.sql');
  if (!migration006?.applied) {
    throw new Error('006_performance_indexes.sql uygulanmadı');
  }

  if (applied2.length > 0) {
    throw new Error(`İkinci apply beklenmedik migration uyguladı: ${applied2.join(', ')}`);
  }

  console.log(JSON.stringify({
    ok: true,
    migration006: migration006.applied,
    firstRunApplied: applied1,
    secondRunApplied: applied2,
    totalMigrations: after.length
  }, null, 2));
  await pool.end();
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exit(1);
});
