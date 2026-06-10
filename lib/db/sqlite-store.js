import fs from 'node:fs/promises';
import path from 'node:path';
import { paths } from '../config.js';
import { createLogger } from '../logger.js';

const log = createLogger('SQLITE');

let sqliteModule = null;
let DatabaseSync = null;

async function loadSqliteModule() {
  if (sqliteModule !== null) {
    return sqliteModule;
  }

  try {
    sqliteModule = await import('node:sqlite');
    DatabaseSync = sqliteModule.DatabaseSync;
    return sqliteModule;
  } catch (error) {
    sqliteModule = false;
    log.warn(`node:sqlite kullanılamıyor — dual-write devre dışı: ${error.message}`);
    return false;
  }
}

export async function isSqliteAvailable() {
  return Boolean(await loadSqliteModule());
}

function openDatabase() {
  if (!DatabaseSync) {
    throw new Error('SQLite modülü yüklü değil.');
  }

  const db = new DatabaseSync(paths.sqlite);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  return db;
}

export function initSqliteSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel TEXT NOT NULL DEFAULT 'trendyol',
      barcode TEXT NOT NULL,
      title TEXT,
      brand TEXT,
      commission_rate REAL,
      payload_json TEXT,
      updated_at TEXT,
      UNIQUE(channel, barcode)
    );

    CREATE TABLE IF NOT EXISTS product_costs (
      barcode TEXT PRIMARY KEY,
      product_cost REAL,
      desi REAL,
      commission_rate REAL,
      cost_vat_rate REAL DEFAULT 20,
      extra_expense REAL DEFAULT 0,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS buybox_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel TEXT NOT NULL DEFAULT 'trendyol',
      barcode TEXT NOT NULL,
      buybox_price REAL,
      buybox_order TEXT,
      seller_id TEXT,
      seller_name TEXT,
      snapshot_key TEXT NOT NULL UNIQUE,
      captured_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS platform_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_buybox_snapshots_barcode ON buybox_snapshots(barcode, captured_at DESC);
  `);
}

function upsertProduct(db, product) {
  const stmt = db.prepare(`
    INSERT INTO products (channel, barcode, title, brand, commission_rate, payload_json, updated_at)
    VALUES ('trendyol', ?, ?, ?, ?, ?, ?)
    ON CONFLICT(channel, barcode) DO UPDATE SET
      title = excluded.title,
      brand = excluded.brand,
      commission_rate = excluded.commission_rate,
      payload_json = excluded.payload_json,
      updated_at = excluded.updated_at
  `);
  stmt.run(
    String(product.barcode || ''),
    product.title || '',
    product.brand || '',
    product.commissionRate ?? null,
    JSON.stringify(product),
    product.updatedAt || new Date().toISOString()
  );
}

const SETTING_KEYS = [
  'profitSnapshots',
  'commissionRules',
  'commissionTariff',
  'alerts',
  'lossOrderAlerts',
  'lossOrderEmail',
  'autoTrackList',
  'buyboxHistoryMeta',
  'channelCosts',
  'meta',
  'productMatching'
];

function ensureColumn(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function migrateSqliteSchema(db) {
  ensureColumn(db, 'product_costs', 'payload_json', 'TEXT');
  ensureColumn(db, 'buybox_snapshots', 'payload_json', 'TEXT');
}

function parseJson(value, fallback = null) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function snapshotFromRow(row) {
  const payload = parseJson(row.payload_json);
  if (payload) return payload;

  return {
    barcode: row.barcode,
    buyboxPrice: row.buybox_price,
    buyboxOrder: row.buybox_order,
    sellerId: row.seller_id,
    merchantId: row.seller_id,
    sellerName: row.seller_name,
    merchantName: row.seller_name,
    updatedAt: row.captured_at
  };
}

function costFromRow(row) {
  const payload = parseJson(row.payload_json);
  if (payload) return payload;

  return {
    barcode: row.barcode,
    productCost: row.product_cost,
    desi: row.desi,
    commissionRate: row.commission_rate,
    costVatRate: row.cost_vat_rate ?? 20,
    extraExpense: row.extra_expense ?? 0,
    updatedAt: row.updated_at
  };
}

export async function readDbFromSqlite() {
  if (!(await isSqliteAvailable())) {
    throw new Error('sqlite_unavailable');
  }

  if (!(await fs.stat(paths.sqlite).catch(() => null))) {
    throw new Error('sqlite_file_missing');
  }

  const db = openDatabase();

  try {
    initSqliteSchema(db);
    migrateSqliteSchema(db);

    const products = db.prepare('SELECT payload_json FROM products').all()
      .map((row) => parseJson(row.payload_json))
      .filter(Boolean);

    const costs = db.prepare('SELECT * FROM product_costs').all()
      .map(costFromRow)
      .filter((row) => row?.barcode);

    const buyboxSnapshots = db.prepare('SELECT * FROM buybox_snapshots').all()
      .map(snapshotFromRow)
      .filter((row) => row?.barcode);

    const settings = {};
    for (const row of db.prepare('SELECT key, value_json FROM platform_settings').all()) {
      settings[row.key] = parseJson(row.value_json);
    }

    return {
      products,
      costs,
      channelCosts: settings.channelCosts || [],
      buyboxSnapshots,
      profitSnapshots: settings.profitSnapshots || [],
      commissionRules: settings.commissionRules || [],
      commissionTariff: settings.commissionTariff || null,
      alerts: settings.alerts || [],
      lossOrderEmail: settings.lossOrderEmail,
      lossOrderAlerts: settings.lossOrderAlerts,
      autoTrackList: settings.autoTrackList || [],
      buyboxHistoryMeta: settings.buyboxHistoryMeta,
      meta: settings.meta || {},
      productMatching: settings.productMatching || null
    };
  } finally {
    db.close();
  }
}

export async function getSqliteFileStats() {
  if (!(await isSqliteAvailable())) {
    return { available: false };
  }

  const stat = await fs.stat(paths.sqlite).catch(() => null);
  if (!stat) {
    return { available: true, exists: false };
  }

  const db = openDatabase();
  try {
    initSqliteSchema(db);
    return {
      available: true,
      exists: true,
      bytes: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      products: db.prepare('SELECT COUNT(*) AS c FROM products').get().c,
      costs: db.prepare('SELECT COUNT(*) AS c FROM product_costs').get().c,
      snapshots: db.prepare('SELECT COUNT(*) AS c FROM buybox_snapshots').get().c
    };
  } finally {
    db.close();
  }
}


function upsertCost(db, cost) {
  const stmt = db.prepare(`
    INSERT INTO product_costs (barcode, product_cost, desi, commission_rate, cost_vat_rate, extra_expense, updated_at, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(barcode) DO UPDATE SET
      product_cost = excluded.product_cost,
      desi = excluded.desi,
      commission_rate = excluded.commission_rate,
      cost_vat_rate = excluded.cost_vat_rate,
      extra_expense = excluded.extra_expense,
      updated_at = excluded.updated_at,
      payload_json = excluded.payload_json
  `);
  stmt.run(
    String(cost.barcode || ''),
    cost.productCost ?? null,
    cost.desi ?? null,
    cost.commissionRate ?? null,
    cost.costVatRate ?? 20,
    cost.extraExpense ?? 0,
    cost.updatedAt || new Date().toISOString(),
    JSON.stringify(cost)
  );
}

function upsertSnapshot(db, snapshot) {
  const snapshotKey = `${snapshot.barcode}|${snapshot.updatedAt || ''}`;
  const stmt = db.prepare(`
    INSERT INTO buybox_snapshots (channel, barcode, buybox_price, buybox_order, seller_id, seller_name, snapshot_key, captured_at, payload_json)
    VALUES ('trendyol', ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(snapshot_key) DO UPDATE SET
      buybox_price = excluded.buybox_price,
      buybox_order = excluded.buybox_order,
      seller_id = excluded.seller_id,
      seller_name = excluded.seller_name,
      payload_json = excluded.payload_json
  `);
  stmt.run(
    String(snapshot.barcode || ''),
    snapshot.buyboxPrice ?? null,
    String(snapshot.buyboxOrder ?? ''),
    String(snapshot.sellerId ?? snapshot.merchantId ?? ''),
    String(snapshot.sellerName ?? snapshot.merchantName ?? ''),
    snapshotKey,
    snapshot.updatedAt || new Date().toISOString(),
    JSON.stringify(snapshot)
  );
}

function upsertSetting(db, key, value) {
  const stmt = db.prepare(`
    INSERT INTO platform_settings (key, value_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
  `);
  stmt.run(key, JSON.stringify(value), new Date().toISOString());
}

function productMatchingMasterCount(pm) {
  return Array.isArray(pm?.masterProducts) ? pm.masterProducts.length : 0;
}

function shouldPreserveSqliteProductMatching(jsonDb, db) {
  const jsonCount = productMatchingMasterCount(jsonDb?.productMatching);
  if (jsonCount > 0) return false;
  const row = db.prepare('SELECT value_json FROM platform_settings WHERE key = ?').get('productMatching');
  const sqliteCount = productMatchingMasterCount(parseJson(row?.value_json));
  return sqliteCount > 0;
}

export async function syncJsonToSqlite(jsonDb) {
  if (!(await isSqliteAvailable())) {
    return { ok: false, skipped: true, reason: 'sqlite_unavailable' };
  }

  await fs.mkdir(path.dirname(paths.sqlite), { recursive: true });
  const db = openDatabase();

  try {
    initSqliteSchema(db);
    migrateSqliteSchema(db);
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const product of jsonDb.products || []) {
        upsertProduct(db, product);
      }
      for (const cost of jsonDb.costs || []) {
        upsertCost(db, cost);
      }
      // Snapshot geçmişi JSON'da trim edilebilir; tam senkron için önce temizle.
      db.exec('DELETE FROM buybox_snapshots');
      for (const snapshot of jsonDb.buyboxSnapshots || []) {
        upsertSnapshot(db, snapshot);
      }
      for (const key of SETTING_KEYS) {
        if (jsonDb[key] === undefined) continue;
        if (key === 'productMatching' && shouldPreserveSqliteProductMatching(jsonDb, db)) {
          log.warn('productMatching SQLite korundu — JSON boş, üzerine yazılmadı');
          continue;
        }
        upsertSetting(db, key, jsonDb[key]);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }

    return { ok: true, syncedAt: new Date().toISOString() };
  } finally {
    db.close();
  }
}

export async function checkSqliteParity(jsonDb) {
  if (!(await isSqliteAvailable())) {
    return { ok: true, skipped: true, reason: 'sqlite_unavailable' };
  }

  if (!(await fs.stat(paths.sqlite).catch(() => null))) {
    return { ok: false, reason: 'sqlite_file_missing' };
  }

  const db = openDatabase();

  try {
    const productCount = db.prepare('SELECT COUNT(*) AS c FROM products').get().c;
    const costCount = db.prepare('SELECT COUNT(*) AS c FROM product_costs').get().c;
    const snapshotCount = db.prepare('SELECT COUNT(*) AS c FROM buybox_snapshots').get().c;

    const jsonProducts = (jsonDb.products || []).length;
    const jsonCosts = (jsonDb.costs || []).length;
    const jsonSnapshots = (jsonDb.buyboxSnapshots || []).length;

    const mismatches = [];
    if (productCount !== jsonProducts) {
      mismatches.push({ table: 'products', json: jsonProducts, sqlite: productCount });
    }
    if (costCount !== jsonCosts) {
      mismatches.push({ table: 'product_costs', json: jsonCosts, sqlite: costCount });
    }
    if (snapshotCount !== jsonSnapshots) {
      mismatches.push({ table: 'buybox_snapshots', json: jsonSnapshots, sqlite: snapshotCount });
    }

    const sampleBarcodes = (jsonDb.buyboxSnapshots || [])
      .slice(-20)
      .map((s) => s.barcode)
      .filter(Boolean);

    const priceMismatches = [];
    for (const barcode of sampleBarcodes) {
      const jsonLatest = [...(jsonDb.buyboxSnapshots || [])]
        .filter((s) => s.barcode === barcode)
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
      const sqliteLatest = db.prepare(`
        SELECT buybox_price, captured_at FROM buybox_snapshots
        WHERE barcode = ? ORDER BY captured_at DESC LIMIT 1
      `).get(barcode);

      if (jsonLatest && sqliteLatest) {
        const jsonPrice = Number(jsonLatest.buyboxPrice);
        const sqlitePrice = Number(sqliteLatest.buybox_price);
        if (Math.abs(jsonPrice - sqlitePrice) > 0.001) {
          priceMismatches.push({ barcode, jsonPrice, sqlitePrice });
        }
      }
    }

    return {
      ok: mismatches.length === 0 && priceMismatches.length === 0,
      counts: {
        products: { json: jsonProducts, sqlite: productCount },
        costs: { json: jsonCosts, sqlite: costCount },
        snapshots: { json: jsonSnapshots, sqlite: snapshotCount }
      },
      mismatches,
      priceMismatches
    };
  } finally {
    db.close();
  }
}
