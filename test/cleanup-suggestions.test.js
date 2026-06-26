import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyProductMatching } from '../lib/product-matching/schema.js';
import {
  markChannelCatalogPresence,
  markMasterPresenceAfterSync,
  pruneAbsentCatalogChannelProducts,
  shouldHideAbsentCatalogChannelProduct
} from '../lib/product-matching/source-presence.js';
import {
  buildCleanupSuggestions,
  dismissCleanupSuggestions
} from '../lib/product-matching/cleanup-suggestions.js';

function makeDb() {
  return {
    meta: {},
    productMatching: createEmptyProductMatching()
  };
}

test('markMasterPresenceAfterSync flags masters missing from BenimPOS API', () => {
  const db = makeDb();
  const pm = db.productMatching;
  pm.masterProducts.push({
    id: 'mp-old',
    benimposBarcode: '8690000000001',
    name: 'Eski Ürün',
    syncedAt: '2026-01-01T00:00:00.000Z',
    lastSeenInBenimposAt: '2026-01-01T00:00:00.000Z'
  });

  markMasterPresenceAfterSync(pm, [{
    id: 'mp-new',
    benimposBarcode: '8690000000002',
    name: 'Yeni Ürün'
  }], '2026-06-19T00:00:00.000Z');

  assert.ok(pm.masterProducts[0].absentFromBenimposSince);
  assert.equal(pm.masterProducts[0].benimposBarcode, '8690000000001');
});

test('markChannelCatalogPresence flags channel products missing from catalog', () => {
  const db = makeDb();
  const pm = db.productMatching;
  pm.channelProducts.push({
    channelId: 'getir',
    channelProductId: 'G-1',
    channelName: 'Eski Getir',
    ingestSource: 'getir_catalog',
    lastSeenInCatalogAt: '2026-01-01T00:00:00.000Z'
  });

  markChannelCatalogPresence(pm, 'getir', ['G-2'], '2026-06-19T00:00:00.000Z');

  assert.ok(pm.channelProducts[0].absentFromCatalogSince);
});

test('pruneAbsentCatalogChannelProducts removes uber catalog rows after absence', () => {
  const db = makeDb();
  const pm = db.productMatching;
  pm.channelProducts.push({
    channelId: 'uber-eats',
    channelProductId: '8690000000999',
    channelBarcode: '8690000000999',
    channelName: 'Silinen Uber ürün',
    ingestSource: 'catalog',
    absentFromCatalogSince: '2026-06-19T00:00:00.000Z'
  });

  const result = pruneAbsentCatalogChannelProducts(pm, 'uber-eats');
  assert.equal(result.removedProducts, 1);
  assert.equal(pm.channelProducts.length, 0);
});

test('pruneAbsentCatalogChannelProducts removes all absent catalog rows including manual matches', () => {
  const db = makeDb();
  const pm = db.productMatching;
  pm.channelProducts.push(
    {
      channelId: 'getir',
      channelProductId: 'gone-1',
      channelName: 'Silinen',
      ingestSource: 'getir_catalog',
      absentFromCatalogSince: '2026-06-19T00:00:00.000Z'
    },
    {
      channelId: 'getir',
      channelProductId: 'keep-1',
      channelName: 'Onaylı',
      ingestSource: 'getir_catalog',
      absentFromCatalogSince: '2026-06-19T00:00:00.000Z'
    },
    {
      channelId: 'getir',
      channelProductId: 'order-1',
      channelName: 'Siparişten',
      ingestSource: 'order_line',
      absentFromCatalogSince: '2026-06-19T00:00:00.000Z'
    }
  );
  pm.mappings.push(
    { channelId: 'getir', channelProductId: 'gone-1', masterProductId: 'mp-1', status: 'pending' },
    { channelId: 'getir', channelProductId: 'keep-1', masterProductId: 'mp-2', status: 'manual_confirmed' }
  );

  const result = pruneAbsentCatalogChannelProducts(pm, 'getir');
  assert.equal(result.removedProducts, 2);
  assert.equal(result.removedMappings, 2);
  assert.equal(pm.channelProducts.length, 1);
  assert.ok(pm.channelProducts.some((cp) => cp.channelProductId === 'order-1'));
  assert.ok(shouldHideAbsentCatalogChannelProduct({
    ingestSource: 'getir_catalog',
    absentFromCatalogSince: '2026-06-19T00:00:00.000Z'
  }));
});

test('buildCleanupSuggestions surfaces stale mappings with messages', () => {
  const db = makeDb();
  const pm = db.productMatching;
  pm.masterProducts.push({
    id: 'mp-1',
    benimposBarcode: '8682291404563',
    name: 'ROYALİST SOMONLU',
    absentFromBenimposSince: '2026-06-19T00:00:00.000Z',
    lastSeenInBenimposAt: '2026-01-01T00:00:00.000Z'
  });
  pm.channelProducts.push({
    channelId: 'getir',
    channelProductId: 'G-99',
    channelName: 'ROYALİST Getir',
    lastSeenInCatalogAt: '2026-01-01T00:00:00.000Z'
  });
  pm.mappings.push({
    channelId: 'getir',
    channelProductId: 'G-99',
    masterProductId: 'mp-1',
    status: 'manual_confirmed'
  });

  const report = buildCleanupSuggestions(db);
  assert.equal(report.total, 1);
  assert.ok(report.items[0].message.includes('BenimPOS'));
  assert.ok(report.items[0].reasons.includes('master_absent'));
});

test('dismissCleanupSuggestions hides items from report', () => {
  const db = makeDb();
  const pm = db.productMatching;
  pm.masterProducts.push({
    id: 'mp-1',
    benimposBarcode: '8682291404563',
    name: 'Test',
    absentFromBenimposSince: '2026-06-19T00:00:00.000Z',
    lastSeenInBenimposAt: '2026-01-01T00:00:00.000Z'
  });
  pm.channelProducts.push({
    channelId: 'getir',
    channelProductId: 'G-1',
    channelName: 'Test',
    lastSeenInCatalogAt: '2026-01-01T00:00:00.000Z'
  });
  pm.mappings.push({
    channelId: 'getir',
    channelProductId: 'G-1',
    masterProductId: 'mp-1',
    status: 'manual_confirmed'
  });

  const before = buildCleanupSuggestions(db);
  dismissCleanupSuggestions(pm, [before.items[0].id]);
  const after = buildCleanupSuggestions(db);
  assert.equal(before.total, 1);
  assert.equal(after.total, 0);
});
