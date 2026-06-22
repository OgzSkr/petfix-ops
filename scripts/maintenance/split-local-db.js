#!/usr/bin/env node
/**
 * Monolit db.json'ı iki repoya böler:
 *   - petfix-ops (buybox-platform): HzlMrktOps verisi
 *   - petfix-marketplace: Trendyol Buybox verisi
 *
 *   node scripts/maintenance/split-local-db.js --dry-run
 *   node scripts/maintenance/split-local-db.js
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureProductMatching } from '../../lib/product-matching/schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OPS_ROOT = path.resolve(__dirname, '../..');
const MARKETPLACE_ROOT = path.resolve(OPS_ROOT, '..', 'petfix-marketplace');

const OPS_CHANNEL_IDS = new Set(['getir', 'uber-eats', 'yemeksepeti']);
const MARKETPLACE_CHANNEL_IDS = new Set(['trendyol-marketplace']);

const MARKETPLACE_DB_KEYS = [
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

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function countRows(value) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') {
    if (value.byBarcode && typeof value.byBarcode === 'object') {
      return Object.keys(value.byBarcode).length;
    }
    return Object.keys(value).length;
  }
  return value == null ? 0 : 1;
}

function filterProductMatching(db, keepChannelIds) {
  ensureProductMatching(db);
  const pm = db.productMatching;
  const keep = (row) => keepChannelIds.has(String(row?.channelId || '').trim());

  pm.channelProducts = (pm.channelProducts || []).filter(keep);
  pm.mappings = (pm.mappings || []).filter(keep);
  pm.conflicts = (pm.conflicts || []).filter(keep);
  pm.mappingLogs = (pm.mappingLogs || []).filter((row) => keep(row));
  pm.orderMappingLogs = (pm.orderMappingLogs || []).filter((row) => keep(row));

  const ingest = pm.meta?.channelIngest || {};
  for (const key of Object.keys(ingest)) {
    const channelKey = key.replace(/^channel:/, '');
    if (!keepChannelIds.has(channelKey) && !keepChannelIds.has(key)) {
      delete ingest[key];
    }
  }

  return {
    masters: pm.masterProducts?.length || 0,
    channelProducts: pm.channelProducts.length,
    mappings: pm.mappings.length
  };
}

function buildOpsDb(source) {
  const db = clone(source);
  for (const key of MARKETPLACE_DB_KEYS) {
    delete db[key];
  }
  delete db.matchingSyncSchedule;
  const matching = filterProductMatching(db, OPS_CHANNEL_IDS);
  db.meta = db.meta || {};
  db.meta.updatedAt = new Date().toISOString();
  db.meta.splitRepo = 'petfix-ops';
  return { db, matching };
}

function buildMarketplaceDb(source) {
  const db = {
    meta: {
      updatedAt: new Date().toISOString(),
      splitRepo: 'petfix-marketplace',
      splitFrom: path.basename(OPS_ROOT)
    }
  };

  for (const key of MARKETPLACE_DB_KEYS) {
    if (key in source) db[key] = clone(source[key]);
  }

  db.productMatching = clone(source.productMatching || {});
  ensureProductMatching(db);
  const matching = filterProductMatching(db, MARKETPLACE_CHANNEL_IDS);

  if (source.runtimeSecrets) db.runtimeSecrets = clone(source.runtimeSecrets);
  if (source.channelCosts) db.channelCosts = [];

  return { db, matching };
}

async function backup(filePath) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupPath = `${filePath}.bak-split-${stamp}`;
  await fs.copyFile(filePath, backupPath);
  return backupPath;
}

async function main() {
  const sourcePath = path.join(OPS_ROOT, 'data', 'db.json');
  const opsPath = sourcePath;
  const marketplacePath = path.join(MARKETPLACE_ROOT, 'data', 'db.json');

  const raw = await fs.readFile(sourcePath, 'utf8');
  const source = JSON.parse(raw);

  const opsResult = buildOpsDb(source);
  const marketplaceResult = buildMarketplaceDb(source);

  const summary = {
    ok: true,
    dryRun,
    source: sourcePath,
    ops: {
      path: opsPath,
      removedMarketplaceKeys: Object.fromEntries(
        MARKETPLACE_DB_KEYS.filter((key) => key in source).map((key) => [key, countRows(source[key])])
      ),
      productMatching: opsResult.matching
    },
    marketplace: {
      path: marketplacePath,
      keptKeys: Object.fromEntries(
        MARKETPLACE_DB_KEYS.filter((key) => key in marketplaceResult.db).map((key) => [key, countRows(marketplaceResult.db[key])])
      ),
      productMatching: marketplaceResult.matching
    }
  };

  console.log(JSON.stringify(summary, null, 2));

  if (dryRun) {
    console.log('\nDry-run — dosya yazılmadı.');
    return;
  }

  await fs.mkdir(path.dirname(marketplacePath), { recursive: true });
  const backupPath = await backup(sourcePath);
  await fs.writeFile(opsPath, `${JSON.stringify(opsResult.db)}\n`, 'utf8');
  await fs.writeFile(marketplacePath, `${JSON.stringify(marketplaceResult.db)}\n`, 'utf8');
  console.log(`\nYedek: ${backupPath}`);
  console.log(`OPS db: ${opsPath}`);
  console.log(`Marketplace db: ${marketplacePath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
