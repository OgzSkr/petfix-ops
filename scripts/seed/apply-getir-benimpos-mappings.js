#!/usr/bin/env node
/**
 * Getir menuProductId → BenimPOS terazi ana barkodu manuel eşleştirmesi.
 * Kanal ürünü yoksa oluşturur (Getir katalog henüz ingest edilmemişse).
 *
 *   node scripts/seed/apply-getir-benimpos-mappings.js
 *   node scripts/seed/apply-getir-benimpos-mappings.js --dry-run
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { readDb, writeDb } from '../../lib/db/store.js';
import { getProductMatching } from '../../lib/product-matching/store.js';
import {
  MAPPING_STATUS,
  MATCH_METHOD,
  channelProductIdFor,
  masterProductIdForBarcode
} from '../../lib/product-matching/constants.js';
import { normalizeBarcode } from '../../lib/product-matching/normalize.js';
import { paths } from '../../lib/config.js';

const SEED_FILE = path.join(paths.root, 'data', 'seed', 'getir-benimpos-mappings.json');

function loadSeedPairs(seed) {
  const channelId = String(seed.channelId || 'getir').trim();
  const pairs = (seed.pairs || [])
    .map((row) => ({
      channelId,
      getirProductId: String(row.getirProductId || '').trim(),
      benimposBarcode: normalizeBarcode(row.benimposBarcode)
    }))
    .filter((row) => row.getirProductId && row.benimposBarcode);
  return { channelId, pairs };
}

function findMaster(pm, barcode) {
  const code = normalizeBarcode(barcode);
  return pm.masterProducts.find((row) => normalizeBarcode(row.benimposBarcode) === code) || null;
}

function findChannelProduct(pm, channelId, getirProductId) {
  const code = String(getirProductId || '').trim();
  return pm.channelProducts.find(
    (cp) => cp.channelId === channelId
      && (cp.channelProductId === code
        || cp.getirMenuProductId === code
        || cp.getirCatalogProductId === code
        || cp.channelBarcode === code)
  ) || null;
}

function ensureMasterStub(pm, barcode, { channelName, stockCode }, now) {
  const existing = findMaster(pm, barcode);
  if (existing) return { master: existing, created: false };

  const master = {
    id: masterProductIdForBarcode(barcode),
    benimposBarcode: barcode,
    name: String(channelName || `AÇIK KEDİ MAMASI ${barcode}`).trim().toUpperCase(),
    brand: '',
    categoryName: '',
    stock: 0,
    buyingPrice: 0,
    salePrice1: 0,
    salePrice2: 0,
    taxRate: 20,
    stockCode: String(stockCode || '').trim(),
    unitValue: 'KG',
    isOnline: true,
    normalizedWeightG: 1000,
    variantKey: null,
    syncedAt: now,
    stubSource: 'getir-benimpos-mapping-seed'
  };
  pm.masterProducts.push(master);
  return { master, created: true };
}

function ensureChannelProduct(pm, channelId, getirProductId, master, now) {
  const existing = findChannelProduct(pm, channelId, getirProductId);
  if (existing) return { channelProduct: existing, created: false };

  const channelProduct = {
    id: channelProductIdFor(channelId, getirProductId),
    channelId,
    channelProductId: getirProductId,
    channelBarcode: getirProductId,
    channelBarcodes: [getirProductId],
    channelName: master?.name || getirProductId,
    getirMenuProductId: getirProductId,
    getirCatalogProductId: null,
    getirActive: true,
    ingestSource: 'getir_mapping_seed',
    ingestedAt: now
  };
  pm.channelProducts.push(channelProduct);
  return { channelProduct, created: true };
}

function applyPair(pm, { channelId, getirProductId, benimposBarcode }, now, { createMissingMasters }) {
  let master = findMaster(pm, benimposBarcode);
  let masterCreated = false;
  if (!master && createMissingMasters) {
    const stockCode = `${getirProductId} - YOK - YOK`;
    const ensured = ensureMasterStub(pm, benimposBarcode, { stockCode }, now);
    master = ensured.master;
    masterCreated = ensured.created;
  }
  if (!master) {
    return { getirProductId, benimposBarcode, ok: false, reason: 'missing_master' };
  }

  const { channelProduct, created: channelCreated } = ensureChannelProduct(
    pm,
    channelId,
    getirProductId,
    master,
    now
  );

  const channelProductId = channelProduct.channelProductId;
  let mapping = pm.mappings.find(
    (row) => row.channelId === channelId && row.channelProductId === channelProductId
  );
  if (!mapping) {
    mapping = {
      id: `map-${channelId}-${channelProductId}`,
      channelId,
      channelProductId,
      channelBarcode: channelProduct.channelBarcode || getirProductId
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
    confirmedBy: 'getir-benimpos-seed',
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
    source: 'getir-benimpos-seed'
  });

  return {
    getirProductId,
    benimposBarcode,
    ok: true,
    masterCreated,
    channelCreated,
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
  const results = pairs.map((pair) => applyPair(pm, pair, now, { createMissingMasters }));

  const confirmed = results.filter((row) => row.ok).length;
  const skipped = results.filter((row) => !row.ok).length;
  const masterStubs = results.filter((row) => row.masterCreated).length;
  const channelCreated = results.filter((row) => row.channelCreated).length;

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
    masterStubsCreated: masterStubs,
    channelProductsCreated: channelCreated,
    results
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
