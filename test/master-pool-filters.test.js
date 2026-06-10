import test from 'node:test';
import assert from 'node:assert/strict';
import { MAPPING_STATUS } from '../lib/product-matching/mapping-types.js';
import { ensureProductMatching } from '../lib/product-matching/schema.js';
import {
  computeMasterPoolTabCounts,
  applyMasterPoolTab,
  summarizeMasterMatchAggregate,
  buildMasterPoolBulkMappingItems,
  listMasterMappingHistory
} from '../lib/product-matching/master-pool-filters.js';

function makeDb() {
  const db = { products: [] };
  ensureProductMatching(db);
  return db;
}

test('computeMasterPoolTabCounts aggregates pool tabs', () => {
  const db = makeDb();
  db.productMatching.masterProducts.push(
    { id: 'm1', name: 'A', stock: 5, isOnline: true },
    { id: 'm2', name: 'B', stock: 0, isOnline: false }
  );
  db.productMatching.mappings.push(
    { id: 'map1', channelId: 'yemeksepeti', channelProductId: 'ys1', masterProductId: 'm1', status: MAPPING_STATUS.MANUAL_CONFIRMED },
    { id: 'map2', channelId: 'uber-eats', channelProductId: 'ue1', masterProductId: 'm2', status: MAPPING_STATUS.REVIEW_REQUIRED }
  );

  const counts = computeMasterPoolTabCounts(db, db.productMatching.masterProducts);
  assert.equal(counts.all, 2);
  assert.equal(counts.passive, 1);
  assert.equal(counts.pending, 1);
});

test('summarizeMasterMatchAggregate reports partial and all matched', () => {
  assert.equal(summarizeMasterMatchAggregate({
    yemeksepeti: 'manual_confirmed',
    'uber-eats': 'manual_confirmed'
  }).code, 'all_matched');

  assert.equal(summarizeMasterMatchAggregate({
    yemeksepeti: 'manual_confirmed',
    'uber-eats': 'review_required'
  }).code, 'partial');
});

test('applyMasterPoolTab filters matched products', () => {
  const db = makeDb();
  const rows = [{ id: 'm1' }, { id: 'm2' }];
  db.productMatching.mappings.push(
    { id: 'map1', channelId: 'yemeksepeti', channelProductId: 'ys1', masterProductId: 'm1', status: MAPPING_STATUS.MANUAL_CONFIRMED }
  );
  const filtered = applyMasterPoolTab(rows, 'matched', db);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, 'm1');
});

test('buildMasterPoolBulkMappingItems collects confirm and unmap items', () => {
  const db = makeDb();
  db.productMatching.masterProducts.push({ id: 'm1' }, { id: 'm2' });
  db.productMatching.mappings.push(
    { id: 'map1', channelId: 'yemeksepeti', channelProductId: 'ys1', masterProductId: 'm1', status: MAPPING_STATUS.AUTO_MATCHED },
    { id: 'map2', channelId: 'uber-eats', channelProductId: 'ue1', masterProductId: 'm1', status: MAPPING_STATUS.MANUAL_CONFIRMED },
    { id: 'map3', channelId: 'yemeksepeti', channelProductId: 'ys2', masterProductId: 'm2', status: MAPPING_STATUS.REVIEW_REQUIRED }
  );

  const confirmItems = buildMasterPoolBulkMappingItems(db, ['m1', 'm2'], { mode: 'confirm' });
  assert.equal(confirmItems.length, 2);
  assert.ok(confirmItems.some((i) => i.channelProductId === 'ys1'));
  assert.ok(confirmItems.some((i) => i.channelProductId === 'ys2'));

  const unmapItems = buildMasterPoolBulkMappingItems(db, ['m1'], { mode: 'unmap' });
  assert.equal(unmapItems.length, 2);
});

test('listMasterMappingHistory filters logs for master and channel keys', () => {
  const db = makeDb();
  db.productMatching.mappings.push(
    { id: 'map1', channelId: 'yemeksepeti', channelProductId: 'ys1', masterProductId: 'm1', status: MAPPING_STATUS.MANUAL_CONFIRMED }
  );
  db.productMatching.mappingLogs = [
    { id: 'l1', at: '2026-06-01T10:00:00.000Z', action: 'confirm', masterProductId: 'm1', channelId: 'yemeksepeti', channelProductId: 'ys1' },
    { id: 'l2', at: '2026-06-02T10:00:00.000Z', action: 'confirm', masterProductId: 'm9' },
    { id: 'l3', at: '2026-06-03T10:00:00.000Z', action: 'unmap', channelId: 'yemeksepeti', channelProductId: 'ys1' }
  ];

  const history = listMasterMappingHistory(db, 'm1', 10);
  assert.equal(history.length, 2);
  assert.equal(history[0].id, 'l3');
});
