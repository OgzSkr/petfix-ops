import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyProductMatching } from '../lib/product-matching/schema.js';
import {
  resolveYemeksepetiCatalogSyncOptions,
  persistYemeksepetiCatalogResume,
  yemeksepetiCatalogStatusLabel
} from '../lib/product-matching/ys-catalog-resume.js';
import {
  pruneAbsentMasterProducts,
  autoApplyAllCleanupSuggestions
} from '../lib/product-matching/post-sync-cleanup.js';

test('resolveYemeksepetiCatalogSyncOptions resumes from nextPage', () => {
  const pm = createEmptyProductMatching();
  pm.meta.channelIngest = { yemeksepeti: { nextPage: 41 } };
  const opts = resolveYemeksepetiCatalogSyncOptions(pm, { maxPages: 120 });
  assert.equal(opts.startPage, 41);
  assert.equal(opts.maxPages, 120);
});

test('persistYemeksepetiCatalogResume stores next page when truncated', () => {
  const pm = createEmptyProductMatching();
  persistYemeksepetiCatalogResume(pm, {
    startPage: 1,
    fetchedPages: 120,
    lastFetchedPage: 120,
    totalPages: 300,
    truncated: true,
    maxPages: 120
  });
  assert.equal(pm.meta.channelIngest.yemeksepeti.nextPage, 121);
  assert.equal(pm.meta.channelIngest.yemeksepeti.catalogComplete, false);
});

test('yemeksepetiCatalogStatusLabel warns on truncated catalog', () => {
  const label = yemeksepetiCatalogStatusLabel({
    ingestedAt: '2026-06-01T00:00:00.000Z',
    prepared: 1000,
    truncated: true,
    lastFetchedPage: 120,
    totalPages: 300
  });
  assert.match(label, /eksik/i);
});

test('autoApplyAllCleanupSuggestions removes stale mappings and absent masters', () => {
  const db = { meta: {}, productMatching: createEmptyProductMatching() };
  const pm = db.productMatching;
  pm.masterProducts.push(
    {
      id: 'mp-gone',
      benimposBarcode: '8690000000001',
      name: 'Silinen',
      absentFromBenimposSince: '2026-06-19T00:00:00.000Z'
    },
    {
      id: 'mp-mapped',
      benimposBarcode: '8690000000002',
      name: 'Eşleşmeli'
    }
  );
  pm.channelProducts.push({
    channelId: 'getir',
    channelProductId: 'G-1',
    channelName: 'Getir ürün',
    absentFromCatalogSince: '2026-06-19T00:00:00.000Z'
  });
  pm.mappings.push(
    {
      channelId: 'getir',
      channelProductId: 'G-1',
      masterProductId: 'mp-gone',
      status: 'manual_confirmed'
    }
  );

  const result = autoApplyAllCleanupSuggestions(db, pm);
  assert.equal(result.removedMappings, 1);
  assert.equal(result.prunedMasters, 1);
  assert.equal(pm.masterProducts.length, 1);
  assert.equal(pm.masterProducts[0].id, 'mp-mapped');
});

test('pruneAbsentMasterProducts keeps masters with mappings', () => {
  const pm = createEmptyProductMatching();
  pm.masterProducts.push({
    id: 'mp-1',
    benimposBarcode: '8690000000001',
    absentFromBenimposSince: '2026-06-19T00:00:00.000Z'
  });
  pm.mappings.push({
    channelId: 'getir',
    channelProductId: 'G-1',
    masterProductId: 'mp-1',
    status: 'manual_confirmed'
  });
  const result = pruneAbsentMasterProducts(pm);
  assert.equal(result.removedProducts, 0);
  assert.equal(pm.masterProducts.length, 1);
});
