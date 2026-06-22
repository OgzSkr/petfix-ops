import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger } from '../../logger.js';

const log = createLogger('OPS-HUB-DB');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

let poolInstance = null;
let pgModule = null;

async function loadPg() {
  if (pgModule !== null) {
    return pgModule;
  }
  try {
    pgModule = await import('pg');
    return pgModule;
  } catch (error) {
    pgModule = false;
    throw new Error(`pg paketi yüklü değil: ${error.message}`);
  }
}

export async function createOpsPool(postgresUrl) {
  const { Pool } = await loadPg();
  const pool = new Pool({
    connectionString: postgresUrl,
    max: Number(process.env.OPS_POSTGRES_POOL_MAX || 10),
    idleTimeoutMillis: 30_000
  });

  pool.on('error', (error) => {
    log.error(`PostgreSQL pool hatası: ${error.message}`);
  });

  return pool;
}

export async function getOpsPool(postgresUrl) {
  if (!postgresUrl) {
    throw new Error('OPS_POSTGRES_URL tanımlı değil.');
  }
  if (!poolInstance) {
    poolInstance = await createOpsPool(postgresUrl);
  }
  return poolInstance;
}

export async function closeOpsPool() {
  if (poolInstance) {
    await poolInstance.end();
    poolInstance = null;
  }
}

export async function checkOpsDbReady(pool) {
  const result = await pool.query('SELECT 1 AS ok');
  return result.rows[0]?.ok === 1;
}

export async function listMigrationFiles() {
  const entries = await fs.readdir(MIGRATIONS_DIR);
  return entries
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort((a, b) => Number(a.split('_')[0]) - Number(b.split('_')[0]));
}

async function ensureMigrationTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ops_schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function getAppliedVersions(pool) {
  await ensureMigrationTable(pool);
  const result = await pool.query(
    'SELECT version FROM ops_schema_migrations ORDER BY version ASC'
  );
  return new Set(result.rows.map((row) => row.version));
}

// Sabit advisory lock anahtarı — api ve poll süreçleri aynı anda migrate çalıştırırsa
// yarışı (PK çakışması / yarım DDL) engeller. Tek bir migrator aynı anda ilerler.
const MIGRATION_ADVISORY_LOCK_KEY = 4815162342;

export async function applyOpsMigrations(pool) {
  const appliedNow = [];
  const lockClient = await pool.connect();
  try {
    await lockClient.query('SELECT pg_advisory_lock($1)', [MIGRATION_ADVISORY_LOCK_KEY]);

    const files = await listMigrationFiles();
    const applied = await getAppliedVersions(pool);

    for (const file of files) {
      const version = Number(file.split('_')[0]);
      if (applied.has(version)) {
        continue;
      }

      const sqlPath = path.join(MIGRATIONS_DIR, file);
      const sql = await fs.readFile(sqlPath, 'utf8');

      try {
        await lockClient.query('BEGIN');
        await lockClient.query(sql);
        await lockClient.query(
          `INSERT INTO ops_schema_migrations (version, name)
           VALUES ($1, $2)
           ON CONFLICT (version) DO NOTHING`,
          [version, file]
        );
        await lockClient.query('COMMIT');
        appliedNow.push(file);
        log.info(`Migration uygulandı: ${file}`);
      } catch (error) {
        await lockClient.query('ROLLBACK');
        throw new Error(`Migration başarısız (${file}): ${error.message}`);
      }
    }
  } finally {
    try {
      await lockClient.query('SELECT pg_advisory_unlock($1)', [MIGRATION_ADVISORY_LOCK_KEY]);
    } catch {
      // unlock başarısızlığı kritik değil — bağlantı kapanınca lock düşer
    }
    lockClient.release();
  }

  return appliedNow;
}

export async function getOpsMigrationStatus(pool) {
  const files = await listMigrationFiles();
  const applied = await getAppliedVersions(pool);
  return files.map((file) => {
    const version = Number(file.split('_')[0]);
    return {
      version,
      name: file,
      applied: applied.has(version)
    };
  });
}
