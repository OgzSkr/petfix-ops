#!/usr/bin/env node
/**
 * OPS-only production: Trendyol Buybox / marketplace JSON verisini db.json'dan temizler.
 * PostgreSQL (Ops Hub siparişleri) dokunulmaz.
 *
 *   node scripts/maintenance/purge-marketplace-local-data.js --dry-run
 *   node scripts/maintenance/purge-marketplace-local-data.js
 *   node scripts/maintenance/purge-marketplace-local-data.js --purge-files
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { paths } from '../../lib/config.js';
import { ensureProductMatching } from '../../lib/product-matching/schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

const REMOVED_CHANNEL_IDS = new Set(['woocommerce', 'trendyol-marketplace']);
const REMOVED_DB_KEYS = [
  'products',
  'costs',
  'buyboxSnapshots',
  'profitSnapshots',
  'commissionRules',
  'commissionTariff',
  'autoTrackList',
  'lossOrderAlerts',
  'lossOrderEmail',
  'buyboxHistoryMeta',
  'dhlShippingCosts',
  'alerts'
];

const PURGE_FILES = [
  'data/buybox-history.jsonl',
  'data/commission-tariff-source.json',
  'data/parity-report.json',
  'data/platform.sqlite',
  'data/platform.sqlite-wal',
  'data/platform.sqlite-shm'
];

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const purgeFiles = args.has('--purge-files');

function countRows(value) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') {
    if (value.byBarcode && typeof value.byBarcode === 'object') {
      return Object.keys(value.byBarcode).length;
    }
    if (value.byTracking || value.byOrderKey) {
      const a = Object.keys(value.byTracking || {}).length;
      const b = Object.keys(value.byOrderKey || {}).length;
      return a + b;
    }
    return Object.keys(value).length;
  }
  return value == null ? 0 : 1;
}

function purgeProductMatching(db) {
  ensureProductMatching(db);
  const pm = db.productMatching;
  const before = {
    channelProducts: pm.channelProducts.length,
    mappings: pm.mappings.length,
    conflicts: pm.conflicts.length,
    mappingLogs: pm.mappingLogs.length
  };

  const keepChannelProduct = (row) => !REMOVED_CHANNEL_IDS.has(String(row?.channelId || '').trim());
  pm.channelProducts = pm.channelProducts.filter(keepChannelProduct);
  pm.mappings = pm.mappings.filter(keepChannelProduct);
  pm.conflicts = pm.conflicts.filter(keepChannelProduct);
  pm.mappingLogs = pm.mappingLogs.filter((row) => !REMOVED_CHANNEL_IDS.has(String(row?.channelId || '').trim()));
  pm.orderMappingLogs = (pm.orderMappingLogs || []).filter((row) => !REMOVED_CHANNEL_IDS.has(String(row?.channelId || '').trim()));

  const ingest = pm.meta?.channelIngest || {};
  for (const key of Object.keys(ingest)) {
    if (key === 'woocommerce'
      || key === 'trendyol-marketplace'
      || key.startsWith('trendyol')) {
      delete ingest[key];
    }
  }

  return {
    before,
    after: {
      channelProducts: pm.channelProducts.length,
      mappings: pm.mappings.length,
      conflicts: pm.conflicts.length,
      mappingLogs: pm.mappingLogs.length
    }
  };
}

async function backupDb(dbPath) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupPath = `${dbPath}.bak-purge-marketplace-${stamp}`;
  await fs.copyFile(dbPath, backupPath);
  return backupPath;
}

async function listPurgeFiles() {
  const rows = [];
  for (const rel of PURGE_FILES) {
    const abs = path.join(ROOT, rel);
    try {
      const stat = await fs.stat(abs);
      rows.push({ path: rel, bytes: stat.size, exists: true });
    } catch {
      rows.push({ path: rel, bytes: 0, exists: false });
    }
  }
  return rows;
}

async function main() {
  const dbPath = paths.db;
  const raw = await fs.readFile(dbPath, 'utf8');
  const db = JSON.parse(raw);

  const removed = {};
  for (const key of REMOVED_DB_KEYS) {
    if (!(key in db)) continue;
    removed[key] = countRows(db[key]);
    delete db[key];
  }

  const matching = purgeProductMatching(db);
  db.meta = db.meta || {};
  db.meta.updatedAt = new Date().toISOString();
  db.meta.opsOnlyPurgedAt = new Date().toISOString();

  const files = await listPurgeFiles();
  const summary = {
    ok: true,
    dryRun,
    purgeFiles,
    removedDbKeys: removed,
    productMatching: matching,
    filesToDelete: files.filter((row) => row.exists),
    kept: {
      productMatchingMasterProducts: db.productMatching?.masterProducts?.length || 0,
      productMatchingChannelProducts: db.productMatching?.channelProducts?.length || 0,
      matchingSyncSchedule: Boolean(db.matchingSyncSchedule)
    }
  };

  console.log(JSON.stringify(summary, null, 2));

  if (dryRun) {
    console.log('\nDry-run — dosya yazılmadı. Uygulamak için --dry-run olmadan çalıştırın.');
    return;
  }

  const backupPath = await backupDb(dbPath);
  const compact = !args.has('--pretty');
  const payload = compact ? `${JSON.stringify(db)}\n` : `${JSON.stringify(db, null, 2)}\n`;
  await fs.writeFile(dbPath, payload, 'utf8');
  console.log(`\nYedek: ${backupPath}`);
  console.log(compact ? 'db.json sıkıştırılmış (tek satır) yazıldı.' : 'db.json pretty yazıldı.');

  if (purgeFiles) {
    for (const row of files) {
      if (!row.exists) continue;
      await fs.unlink(path.join(ROOT, row.path));
      console.log(`Silindi: ${row.path}`);
    }
  } else {
    console.log('Disk dosyaları silinmedi. Silmek için --purge-files ekleyin.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
