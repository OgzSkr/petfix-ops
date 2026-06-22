import test from 'node:test';
import assert from 'node:assert/strict';
import { MAPPING_STATUS } from '../lib/product-matching/mapping-types.js';
import { ensureProductMatching } from '../lib/product-matching/schema.js';
import {
  buildMatchingQueue,
  matchingQueueActionItems,
  catalogChannelOpsConfig,
  resolveInboxHref,
  channelReadyPercent
} from '../lib/product-matching/matching-queue.js';
import { buildCatalogMatchingOpsChecklist } from '../lib/platform/services/channel-matching-ops-checklist.js';

function makeDb() {
  const db = { products: [{ barcode: '8690001112223', title: 'Test' }] };
  ensureProductMatching(db);
  return db;
}

test('buildMatchingQueue counts unmapped channel products in queue', () => {
  const db = makeDb();
  db.productMatching.channelProducts.push(
    {
      channelId: 'uber-eats',
      channelProductId: 'ue-1',
      channelBarcode: '111',
      channelName: 'Unmapped A'
    },
    {
      channelId: 'uber-eats',
      channelProductId: 'ue-2',
      channelBarcode: '222',
      channelName: 'Unmapped B'
    }
  );

  const queue = buildMatchingQueue(db, { productMatchingMode: 'hybrid' });
  const uber = queue.channels.find((row) => row.channelId === 'uber-eats');
  assert.ok(uber);
  assert.equal(uber.unmapped, 2);
  assert.equal(uber.queueTotal, 2);
  assert.equal(queue.totals.queue, 2);
  assert.equal(queue.totals.unmapped, 2);
});

test('buildMatchingQueue aggregates channel backlog', () => {
  const db = makeDb();
  db.productMatching.masterProducts.push({
    id: 'mp-8690001112223',
    benimposBarcode: '8690001112223',
    name: 'Test'
  });
  db.productMatching.channelProducts.push({
    channelId: 'yemeksepeti',
    channelProductId: '8690001112223',
    channelBarcode: '8690001112223',
    channelName: 'Test'
  });
  db.productMatching.mappings.push({
    id: 'map-1',
    channelId: 'yemeksepeti',
    channelProductId: '8690001112223',
    channelBarcode: '8690001112223',
    masterProductId: 'mp-8690001112223',
    status: MAPPING_STATUS.AUTO_MATCHED
  });

  const queue = buildMatchingQueue(db, { productMatchingMode: 'hybrid' });
  const ys = queue.channels.find((row) => row.channelId === 'yemeksepeti');
  assert.ok(ys);
  assert.equal(ys.autoPendingConfirm, 1);
  assert.equal(queue.totals.queue, 1);
});

test('matchingQueueActionItems returns actionable cards', () => {
  const queue = {
    totals: { queue: 3, missingMaster: 1, needsReview: 0, autoPendingConfirm: 2 },
    channels: [{
      channelId: 'yemeksepeti',
      label: 'Yemeksepeti',
      queueTotal: 3,
      missingMaster: 1,
      autoPendingConfirm: 2,
      needsReview: 0,
      readyForSales: false,
      blockers: ['1 otomatik eşleşme manuel onay bekliyor'],
      href: '/hzlmrktops/urunler?channelId=yemeksepeti'
    }]
  };
  const items = matchingQueueActionItems(queue);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'matching-readiness-yemeksepeti');
  assert.match(items[0].href, /\/hzlmrktops\/urunler/);
});

test('resolveInboxHref links to hzlmrktops products page', () => {
  assert.match(
    resolveInboxHref({
      channelId: 'yemeksepeti',
      queueTotal: 100,
      missingMaster: 5,
      needsReview: 418,
      autoPendingConfirm: 10
    }),
    /\/hzlmrktops\/urunler/
  );
  assert.match(
    resolveInboxHref({
      channelId: 'uber-eats',
      queueTotal: 50,
      missingMaster: 20,
      needsReview: 5,
      autoPendingConfirm: 3
    }),
    /\/hzlmrktops\/urunler/
  );
});

test('channelReadyPercent calculates confirmed ratio', () => {
  assert.equal(channelReadyPercent({ productCount: 100, manualConfirmed: 80 }), 80);
  assert.equal(channelReadyPercent({ productCount: 0, manualConfirmed: 0 }), 0);
});

test('catalogChannelOpsConfig exposes HzlMrktOps yemeksepeti only', () => {
  assert.equal(catalogChannelOpsConfig('trendyol-marketplace'), null);
  assert.ok(catalogChannelOpsConfig('yemeksepeti'));
  assert.equal(catalogChannelOpsConfig('uber-eats'), null);
});

test('buildCatalogMatchingOpsChecklist marks master and catalog steps', () => {
  const checklist = buildCatalogMatchingOpsChecklist({
    channelId: 'yemeksepeti',
    channelLabel: 'Yemeksepeti',
    catalogLabel: 'Yemeksepeti katalog',
    matchingStatus: {
      masterProductCount: 10,
      masterSyncedAt: '2026-01-01T00:00:00.000Z',
      yemeksepetiCatalogSyncedAt: '2026-01-02T00:00:00.000Z',
      channelStats: {
        yemeksepeti: {
          productCount: 5,
          mappingCount: 3,
          byStatus: { manual_confirmed: 2, auto_matched: 1 }
        }
      }
    },
    readiness: { readyForSales: false, blockers: ['1 otomatik eşleşme manuel onay bekliyor'] }
  });

  assert.equal(checklist[0].id, 'master');
  assert.equal(checklist[0].done, true);
  assert.equal(checklist[1].done, true);
  assert.equal(checklist[2].done, true);
});
