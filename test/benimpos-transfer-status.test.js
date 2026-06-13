import test from 'node:test';
import assert from 'node:assert/strict';
import { computeBenimposTransferStatus } from '../lib/product-matching/benimpos-transfer-status.js';
import { MAPPING_STATUS } from '../lib/product-matching/mapping-types.js';
import { ensureProductMatching } from '../lib/product-matching/schema.js';

function makeDb() {
  const db = {};
  ensureProductMatching(db);
  return db;
}

test('computeBenimposTransferStatus returns transferred when sales code exists', () => {
  const meta = computeBenimposTransferStatus(
    { benimposSalesCode: 'S-100', lines: [{ barcode: '8690001112223', quantity: 1 }] },
    makeDb(),
    'yemeksepeti'
  );
  assert.equal(meta.benimposTransferStatus, 'transferred');
  assert.match(meta.benimposTransferNote, /S-100/);
});

test('computeBenimposTransferStatus returns blocked without barcode match', () => {
  const meta = computeBenimposTransferStatus(
    {
      orderNumber: 'YS-1',
      lines: [{ barcode: '8690001112223', quantity: 1, productName: 'Test' }]
    },
    makeDb(),
    'uber-eats'
  );
  assert.equal(meta.benimposTransferStatus, 'blocked');
});

test('computeBenimposTransferStatus returns ready when all lines are sale-allowed', () => {
  const db = makeDb();
  db.productMatching.masterProducts.push({
    id: 'mp-1',
    benimposBarcode: '8690001112223',
    name: 'Test',
    stock: 5,
    buyingPrice: 10
  });
  db.productMatching.mappings.push({
    id: 'map-ys-1',
    channelId: 'yemeksepeti',
    channelProductId: '8690001112223',
    channelBarcode: '8690001112223',
    masterProductId: 'mp-1',
    status: MAPPING_STATUS.MANUAL_CONFIRMED,
    matchMethod: 'manual'
  });
  db.productMatching.channelProducts.push({
    channelId: 'yemeksepeti',
    channelBarcode: '8690001112223',
    channelProductId: 'cp-1',
    name: 'Kanal Test'
  });

  const meta = computeBenimposTransferStatus(
    {
      orderNumber: 'YS-2',
      lines: [{ barcode: '8690001112223', quantity: 1, productName: 'Test' }]
    },
    db,
    'yemeksepeti'
  );
  assert.equal(meta.benimposTransferStatus, 'ready');
});

test('computeBenimposTransferStatus ignores non-benimpos channels', () => {
  assert.equal(
    computeBenimposTransferStatus({ lines: [] }, makeDb(), 'trendyol-marketplace'),
    null
  );
});
