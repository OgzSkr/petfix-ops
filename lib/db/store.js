import fs from 'node:fs/promises';
import path from 'node:path';
import { paths } from '../config.js';
import { ensureAlertState } from '../loss-order-monitor.js';
import { createLogger } from '../logger.js';
import {
  isSqliteAvailable,
  readDbFromSqlite,
  syncJsonToSqlite
} from './sqlite-store.js';
import { checkReadParity } from './parity.js';
import { ensureProductMatching } from '../product-matching/schema.js';
import { ensureMatchingSyncState } from '../product-matching/matching-sync-schedule.js';
import { ensureDhlShippingCosts } from '../carriers/dhl-shipping-costs.js';

const log = createLogger('DB');

let storeConfig = {
  dualWrite: false,
  readBackend: 'json'
};

let lastReadMeta = {
  source: 'json',
  fallback: false,
  parity: null,
  readAt: null,
  error: null
};

export function configureDbStore({
  sqliteDualWrite = false,
  dbReadBackend = 'json'
} = {}) {
  storeConfig = {
    dualWrite: Boolean(sqliteDualWrite),
    readBackend: normalizeReadBackend(dbReadBackend)
  };
}

export function getDbReadMeta() {
  return { ...lastReadMeta, readBackend: storeConfig.readBackend };
}

function normalizeReadBackend(value) {
  const backend = String(value || 'json').toLowerCase();
  return backend === 'sqlite' ? 'sqlite' : 'json';
}

function productMatchingMasterCount(db) {
  return Array.isArray(db?.productMatching?.masterProducts)
    ? db.productMatching.masterProducts.length
    : 0;
}

function commissionTariffItemCount(db) {
  const tariff = db?.commissionTariff;
  if (!tariff?.byBarcode) return 0;
  return Object.keys(tariff.byBarcode).length;
}

/** JSON fallback sırasında productMatching yalnızca SQLite'ta kalmış olabilir. */
function mergeProductMatchingFromSqlite(targetDb, sqliteDb) {
  const sqliteCount = productMatchingMasterCount(sqliteDb);
  const jsonCount = productMatchingMasterCount(targetDb);
  if (sqliteCount > 0 && jsonCount === 0) {
    targetDb.productMatching = sqliteDb.productMatching;
    log.info(`productMatching SQLite kaynağından tamamlandı (${sqliteCount} ana ürün)`);
    return true;
  }
  return false;
}

/** Komisyon tarifesi dual-write / parity fallback sonrası tek tarafta kalabilir. */
function mergeCommissionTariffPreferNonEmpty(targetDb, sourceDb) {
  const sourceCount = commissionTariffItemCount(sourceDb);
  const targetCount = commissionTariffItemCount(targetDb);
  if (sourceCount > 0 && targetCount === 0) {
    targetDb.commissionTariff = sourceDb.commissionTariff;
    log.info(`commissionTariff kaynak birleştirildi (${sourceCount} ürün)`);
    return true;
  }
  return false;
}

export async function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return fallback;
    }
    throw error;
  }
}

export async function readJsonDb() {
  return readJsonFile(paths.db, {});
}

export async function readDb() {
  const readAt = new Date().toISOString();

  if (storeConfig.readBackend !== 'sqlite') {
    const db = await readJsonDb();
    lastReadMeta = {
      source: 'json',
      fallback: false,
      parity: null,
      readAt,
      error: null
    };
    return db;
  }

  const jsonDb = await readJsonDb();

  try {
    if (!(await isSqliteAvailable())) {
      throw new Error('sqlite_unavailable');
    }

    const sqliteDb = await readDbFromSqlite();
    const parity = await checkReadParity(jsonDb, sqliteDb);

    if (!parity.ok) {
      log.warn(`SQLite read parity uyuşmazlığı — JSON fallback (${JSON.stringify({
        mismatches: parity.mismatches,
        collectionMismatches: parity.collectionMismatches,
        priceMismatches: parity.priceMismatches?.length || 0
      })})`);
      mergeProductMatchingFromSqlite(jsonDb, sqliteDb);
      mergeCommissionTariffPreferNonEmpty(jsonDb, sqliteDb);
      lastReadMeta = {
        source: 'json',
        fallback: true,
        parity,
        readAt,
        error: 'parity_mismatch'
      };
      return jsonDb;
    }

    log.info(`SQLite read OK (${parity.counts?.products?.sqlite ?? 0} ürün)`);
    // productMatching henüz SQLite'a yazılmamış olabilir — JSON kaynağından tamamla
    if (jsonDb.productMatching && (!sqliteDb.productMatching?.masterProducts?.length)) {
      sqliteDb.productMatching = jsonDb.productMatching;
    }
    mergeCommissionTariffPreferNonEmpty(sqliteDb, jsonDb);
    lastReadMeta = {
      source: 'sqlite',
      fallback: false,
      parity,
      readAt,
      error: null
    };
    return sqliteDb;
  } catch (error) {
    log.warn(`SQLite read başarısız (${error.message}) — JSON fallback`);
    try {
      if (await isSqliteAvailable()) {
        const sqliteDb = await readDbFromSqlite();
        mergeProductMatchingFromSqlite(jsonDb, sqliteDb);
        mergeCommissionTariffPreferNonEmpty(jsonDb, sqliteDb);
      }
    } catch {
      /* productMatching tamamlanamazsa JSON ile devam */
    }
    lastReadMeta = {
      source: 'json',
      fallback: true,
      parity: null,
      readAt,
      error: error.message
    };
    return jsonDb;
  }
}

function uniqueDbTmpPath() {
  const suffix = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 10)}`;
  return `${paths.db}.tmp.${suffix}`;
}

export async function writeDb(db) {
  await fs.mkdir(path.dirname(paths.db), { recursive: true });
  const pretty = process.env.DB_PRETTY_WRITE === 'true';
  const payload = pretty ? `${JSON.stringify(db, null, 2)}\n` : `${JSON.stringify(db)}\n`;
  const tmpPath = uniqueDbTmpPath();
  try {
    await fs.writeFile(tmpPath, payload, 'utf8');
    await fs.rename(tmpPath, paths.db);
  } catch (error) {
    await fs.unlink(tmpPath).catch(() => {});
    throw error;
  }

  if (storeConfig.dualWrite) {
    try {
      await syncJsonToSqlite(db);
    } catch (error) {
      log.error(`SQLite dual-write hatası: ${error.message}`);
    }
  }
}

export async function ensureDb() {
  const now = new Date().toISOString();
  const db = await readJsonFile(paths.db, null);
  if (db) return;

  await fs.mkdir(path.dirname(paths.db), { recursive: true });
  await writeDb({
    products: [],
    costs: [],
    channelCosts: [],
    commissionRules: [],
    commissionTariff: null,
    buyboxSnapshots: [],
    profitSnapshots: [],
    alerts: [],
    meta: { createdAt: now, updatedAt: now }
  });
}

export async function migrateDb() {
  const db = await readJsonDb();
  ensureAlertState(db);

  if (db.whatsapp) {
    delete db.whatsapp;
  }

  if (!db.buyboxHistoryMeta) {
    db.buyboxHistoryMeta = {
      enabled: true,
      format: 'jsonl',
      file: 'data/buybox-history.jsonl',
      archiveDir: 'data/archive',
      retentionDays: 30
    };
  }

  if (!Array.isArray(db.channelCosts)) {
    db.channelCosts = [];
  }

  ensureProductMatching(db);
  ensureMatchingSyncState(db);
  ensureDhlShippingCosts(db);

  if (storeConfig.readBackend === 'sqlite') {
    try {
      if (await isSqliteAvailable()) {
        const sqliteDb = await readDbFromSqlite();
        mergeProductMatchingFromSqlite(db, sqliteDb);
        mergeCommissionTariffPreferNonEmpty(db, sqliteDb);
      }
    } catch {
      /* JSON migrate devam eder */
    }
  }

  await writeDb(db);
}

export { paths } from '../config.js';

// Backward compatibility
export const configureDbBackend = configureDbStore;
