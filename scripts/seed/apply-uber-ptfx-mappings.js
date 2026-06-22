#!/usr/bin/env node
/**
 * Uber PTFX barkodlarını BenimPOS terazi ana barkodlarına manuel eşleştirir.
 *
 *   node scripts/seed/apply-uber-ptfx-mappings.js
 *   node scripts/seed/apply-uber-ptfx-mappings.js --dry-run
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDb, writeDb } from '../../lib/db/store.js';
import { getProductMatching } from '../../lib/product-matching/store.js';
import { MAPPING_STATUS, MATCH_METHOD, masterProductIdForBarcode } from '../../lib/product-matching/constants.js';
import { normalizeBarcode } from '../../lib/product-matching/normalize.js';
import { paths } from '../../lib/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_FILE = path.join(paths.root, 'data', 'seed', 'uber-ptfx-benimpos-mappings.json');

function loadSeedPairs(seed) {
  const channelId = String(seed.channelId || 'uber-eats').trim();
  const pairs = (seed.pairs || [])
    .map((row) => ({
      channelId,
      benimposBarcode: normalizeBarcode(row.benimposBarcode),
      uberBarcode: String(row.uberBarcode || '').trim()
    }))
    .filter((row) => row.benimposBarcode && row.uberBarcode);
  return { channelId, pairs };
}

function findMaster(pm, barcode) {
  const code = normalizeBarcode(barcode);
  return pm.masterProducts.find((row) => normalizeBarcode(row.benimposBarcode) === code) || null;
}

function findChannelProduct(pm, channelId, uberBarcode) {
  const code = String(uberBarcode || '').trim();
  return pm.channelProducts.find(
    (cp) => cp.channelId === channelId
      && (cp.channelProductId === code || cp.channelBarcode === code)
  ) || null;
}

function ensureMasterStub(pm, barcode, channelProduct, now) {
  const existing = findMaster(pm, barcode);
  if (existing) return { master: existing, created: false };

  const name = String(channelProduct?.channelName || `AÇIK KEDİ MAMASI ${barcode}`).trim().toUpperCase();
  const master = {
    id: masterProductIdForBarcode(barcode),
    benimposBarcode: barcode,
    name,
    brand: '',
    categoryName: '',
    stock: 0,
    buyingPrice: 0,
    salePrice1: 0,
    salePrice2: 0,
    taxRate: 20,
    stockCode: '',
    unitValue: 'KG',
    isOnline: true,
    normalizedWeightG: null,
    variantKey: null,
    syncedAt: now,
    stubSource: 'uber-ptfx-mapping-seed'
  };
  pm.masterProducts.push(master);
  return { master, created: true };
}

function applyPair(db, pm, { channelId, benimposBarcode, uberBarcode }, now, { createMissingMasters }) {
  const channelProduct = findChannelProduct(pm, channelId, uberBarcode);
  if (!channelProduct) {
    return { uberBarcode, benimposBarcode, ok: false, reason: 'missing_channel_product' };
  }

  let master = findMaster(pm, benimposBarcode);
  let masterCreated = false;
  if (!master && createMissingMasters) {
    const ensured = ensureMasterStub(pm, benimposBarcode, channelProduct, now);
    master = ensured.master;
    masterCreated = ensured.created;
  }
  if (!master) {
    return { uberBarcode, benimposBarcode, ok: false, reason: 'missing_master' };
  }

  const channelProductId = channelProduct.channelProductId;
  let mapping = pm.mappings.find(
    (row) => row.channelId === channelId && row.channelProductId === channelProductId
  );
  if (!mapping) {
    mapping = {
      id: `map-${channelId}-${channelProductId}`,
      channelId,
      channelProductId,
      channelBarcode: channelProduct.channelBarcode || uberBarcode
    };
    pm.mappings.push(mapping);
  }

  Object.assign(mapping, {
    masterProductId: master.id,
    status: MAPPING_STATUS.MANUAL_CONFIRMED,
    matchMethod: MATCH_METHOD.MANUAL,
    confidenceScore: 100,
    reasons: [],
    confirmedAt: now,
    confirmedBy: 'uber-ptfx-seed',
    updatedAt: now
  });

  pm.conflicts = pm.conflicts.filter(
    (row) => !(row.channelId === channelId && row.channelProductId === channelProductId)
  );

  pm.mappingLogs.push({
    at: now,
    action: 'manual_confirm',
    channelId,
    channelProductId,
    masterProductId: master.id,
    masterName: master.name,
    channelName: channelProduct.channelName,
    source: 'uber-ptfx-seed'
  });

  return {
    uberBarcode,
    benimposBarcode,
    ok: true,
    masterCreated,
    masterName: master.name,
    channelName: channelProduct.channelName
  };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const createMissingMasters = !process.argv.includes('--skip-stubs');

  const seedRaw = await fs.readFile(SEED_FILE, 'utf8');
  const { channelId, pairs } = loadSeedPairs(JSON.parse(seedRaw));
  const db = await readDb();
  const pm = getProductMatching(db);
  const now = new Date().toISOString();
  const results = [];

  for (const pair of pairs) {
    results.push(applyPair(db, pm, { channelId, ...pair }, now, { createMissingMasters }));
  }

  const confirmed = results.filter((row) => row.ok).length;
  const skipped = results.filter((row) => !row.ok).length;
  const stubs = results.filter((row) => row.masterCreated).length;

  if (!dryRun && confirmed > 0) {
    pm.meta = pm.meta || {};
    pm.meta.masterProductCount = pm.masterProducts.length;
    db.meta = db.meta || {};
    db.meta.updatedAt = now;
    await writeDb(db);
  }

  console.log(JSON.stringify({
    ok: true,
    dryRun,
    channelId,
    requested: pairs.length,
    confirmed,
    skipped,
    masterStubsCreated: stubs,
    results
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
