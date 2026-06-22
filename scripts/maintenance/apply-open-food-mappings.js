#!/usr/bin/env node
/**
 * Açık / gramajlı mama eşleştirmelerini uygular (Uber PTFX + Getir menuProductId)
 * ve workbench indeksini yeniden oluşturur.
 *
 *   node scripts/maintenance/apply-open-food-mappings.js
 *   node scripts/maintenance/apply-open-food-mappings.js --dry-run
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
import { clearWorkbenchIndex } from '../../lib/product-matching/workbench-index.js';
import { createProductMatchingService } from '../../lib/platform/services/product-matching.js';
import { paths } from '../../lib/config.js';

const SEED_DIR = path.join(paths.root, 'data', 'seed');

async function loadJson(fileName) {
  const raw = await fs.readFile(path.join(SEED_DIR, fileName), 'utf8');
  return JSON.parse(raw);
}

function findMaster(pm, barcode) {
  const code = normalizeBarcode(barcode);
  return pm.masterProducts.find((row) => normalizeBarcode(row.benimposBarcode) === code) || null;
}

function findChannelProduct(pm, channelId, productKey) {
  const code = String(productKey || '').trim();
  return pm.channelProducts.find(
    (cp) => cp.channelId === channelId
      && (cp.channelProductId === code
        || cp.channelBarcode === code
        || cp.getirMenuProductId === code
        || cp.getirCatalogProductId === code)
  ) || null;
}

function ensureMasterStub(pm, barcode, { name, stockCode }, now, source) {
  const existing = findMaster(pm, barcode);
  if (existing) {
    let updated = false;
    if (String(existing.unitValue || '').toUpperCase() !== 'KG') {
      existing.unitValue = 'KG';
      updated = true;
    }
    if (!existing.normalizedWeightG) {
      existing.normalizedWeightG = 1000;
      updated = true;
    }
    return { master: existing, created: false, updated };
  }

  const master = {
    id: masterProductIdForBarcode(barcode),
    benimposBarcode: barcode,
    name: String(name || `AÇIK KEDİ MAMASI ${barcode}`).trim().toUpperCase(),
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
    stubSource: source
  };
  pm.masterProducts.push(master);
  return { master, created: true, updated: false };
}

function ensureGetirChannelProduct(pm, getirProductId, master, now) {
  const existing = findChannelProduct(pm, 'getir', getirProductId);
  if (existing) return { channelProduct: existing, created: false };

  const channelProduct = {
    id: channelProductIdFor('getir', getirProductId),
    channelId: 'getir',
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

function applyMapping(pm, {
  channelId,
  channelProduct,
  master,
  confirmedBy,
  now
}) {
  const channelProductId = channelProduct.channelProductId;
  let mapping = pm.mappings.find(
    (row) => row.channelId === channelId && row.channelProductId === channelProductId
  );
  if (!mapping) {
    mapping = {
      id: `map-${channelId}-${channelProductId}`,
      channelId,
      channelProductId,
      channelBarcode: channelProduct.channelBarcode || channelProductId
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
    confirmedBy,
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
    source: confirmedBy
  });
}

async function applyUberPairs(pm, pairs, now, dryRun) {
  const results = [];
  for (const row of pairs) {
    const uberBarcode = String(row.uberBarcode || '').trim();
    const benimposBarcode = normalizeBarcode(row.benimposBarcode);
    const channelProduct = findChannelProduct(pm, 'uber-eats', uberBarcode);
    if (!channelProduct) {
      results.push({ channel: 'uber-eats', uberBarcode, benimposBarcode, ok: false, reason: 'missing_channel_product' });
      continue;
    }

    const stub = ensureMasterStub(
      pm,
      benimposBarcode,
      { name: channelProduct.channelName, stockCode: '' },
      now,
      'uber-ptfx-mapping-seed'
    );
    if (!dryRun) {
      applyMapping(pm, {
        channelId: 'uber-eats',
        channelProduct,
        master: stub.master,
        confirmedBy: 'open-food-mapping-seed',
        now
      });
    }
    results.push({
      channel: 'uber-eats',
      uberBarcode,
      benimposBarcode,
      ok: true,
      masterCreated: stub.created,
      masterUpdated: stub.updated
    });
  }
  return results;
}

async function applyGetirPairs(pm, pairs, now, dryRun) {
  const results = [];
  for (const row of pairs) {
    const getirProductId = String(row.getirProductId || '').trim();
    const benimposBarcode = normalizeBarcode(row.benimposBarcode);
    const stub = ensureMasterStub(
      pm,
      benimposBarcode,
      { name: null, stockCode: `${getirProductId} - YOK - YOK` },
      now,
      'getir-benimpos-mapping-seed'
    );
    const { channelProduct, created: channelCreated } = ensureGetirChannelProduct(
      pm,
      getirProductId,
      stub.master,
      now
    );
    if (!dryRun) {
      applyMapping(pm, {
        channelId: 'getir',
        channelProduct,
        master: stub.master,
        confirmedBy: 'open-food-mapping-seed',
        now
      });
    }
    results.push({
      channel: 'getir',
      getirProductId,
      benimposBarcode,
      ok: true,
      masterCreated: stub.created,
      channelCreated
    });
  }
  return results;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const skipIndex = process.argv.includes('--skip-index');

  const uberSeed = await loadJson('uber-ptfx-benimpos-mappings.json');
  const getirSeed = await loadJson('getir-benimpos-mappings.json');
  const db = await readDb();
  const pm = getProductMatching(db);
  const now = new Date().toISOString();

  const uberResults = await applyUberPairs(pm, uberSeed.pairs, now, dryRun);
  const getirResults = await applyGetirPairs(pm, getirSeed.pairs, now, dryRun);
  const results = [...uberResults, ...getirResults];

  if (!dryRun) {
    clearWorkbenchIndex(pm);
    pm.meta = pm.meta || {};
    pm.meta.masterProductCount = pm.masterProducts.length;
    db.meta = db.meta || {};
    db.meta.updatedAt = now;
    await writeDb(db);
  }

  let index = null;
  if (!dryRun && !skipIndex) {
    const productMatching = createProductMatchingService();
    index = await productMatching.rebuildWorkbenchIndex({ persist: true });
  }

  const confirmed = results.filter((row) => row.ok).length;
  const failed = results.filter((row) => !row.ok);

  console.log(JSON.stringify({
    ok: failed.length === 0,
    dryRun,
    confirmed,
    failed: failed.length,
    masterStubsCreated: results.filter((row) => row.masterCreated).length,
    getirChannelCreated: results.filter((row) => row.channelCreated).length,
    workbenchIndex: index,
    failures: failed,
    sample: results.filter((row) => row.ok).slice(0, 5)
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
