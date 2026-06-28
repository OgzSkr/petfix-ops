import test from 'node:test';
import assert from 'node:assert/strict';
import { captureOrderLineCosts } from '../lib/ops-hub/ingest/order-line-cost.js';
import { analyzeOrderPackages } from '../lib/order-profitability.js';
import { ensureProductMatching } from '../lib/product-matching/schema.js';
import { MAPPING_STATUS } from '../lib/product-matching/constants.js';
import { costScopeForChannel } from '../lib/cost-scopes.js';
import { profitAnalysisSettingsForChannel } from '../lib/profit-constants.js';

function sampleDb() {
  const db = { productMatching: {}, channelCosts: [] };
  ensureProductMatching(db);
  db.productMatching.masterProducts.push({
    id: 'm1',
    benimposBarcode: '8691112222',
    name: 'Test Mama',
    buyingPrice: 95,
    taxRate: 20
  });
  db.productMatching.channelProducts.push({
    id: 'cp1',
    channelId: 'uber-eats',
    channelProductId: 'p1',
    channelBarcode: '8691112222',
    channelName: 'Test Mama'
  });
  db.productMatching.mappings.push({
    id: 'map1',
    channelId: 'uber-eats',
    channelProductId: 'p1',
    channelBarcode: '8691112222',
    masterProductId: 'm1',
    status: MAPPING_STATUS.MANUAL_CONFIRMED
  });
  return db;
}

test('captureOrderLineCosts stamps unitCost from master pool at ingest', async () => {
  const db = sampleDb();
  const lines = await captureOrderLineCosts({
    channel: 'trendyol_go',
    lines: [{
      lineIndex: 0,
      channelProductId: 'p1',
      barcode: '8691112222',
      title: 'Test Mama',
      quantity: 2,
      unitPrice: 150,
      matchingStatus: 'unmapped',
      benimposSalesCode: null,
      reservedQty: 0
    }],
    platformEnv: {
      PRODUCT_MATCHING_MODE: 'hybrid',
      PRODUCT_MATCHING_ENABLED: 'true'
    },
    db
  });

  assert.equal(lines[0].unitCost, 95);
  assert.equal(lines[0].costSource, 'master_buying_price');
  assert.ok(lines[0].costCapturedAt);
});

test('analyzeOrderPackages prefers frozen unitCost from order line snapshot', () => {
  const db = sampleDb();
  const rows = analyzeOrderPackages([{
    orderNumber: 'T1',
    orderDate: Date.now(),
    status: 'completed',
    lines: [{
      barcode: '8691112222',
      productName: 'Test Mama',
      quantity: 1,
      unitPrice: 200,
      frozenUnitCost: 80,
      costSource: 'order_snapshot'
    }]
  }], db, {
    ...profitAnalysisSettingsForChannel('uber-eats'),
    costScope: costScopeForChannel('uber-eats'),
    channelId: 'uber-eats',
    productMatchingMode: 'hybrid'
  });

  assert.equal(rows[0].lines[0].unitCost, 80);
  assert.equal(rows[0].lines[0].costSource, 'order_snapshot');
  assert.equal(rows[0].productCost, 80);
});

test('captureOrderLineCosts does not overwrite existing unitCost', async () => {
  const db = sampleDb();
  const lines = await captureOrderLineCosts({
    channel: 'trendyol_go',
    lines: [{
      lineIndex: 0,
      channelProductId: 'p1',
      barcode: '8691112222',
      title: 'Test Mama',
      quantity: 1,
      unitPrice: 150,
      unitCost: 80,
      costSource: 'order_snapshot',
      matchingStatus: 'unmapped',
      benimposSalesCode: null,
      reservedQty: 0
    }],
    platformEnv: { PRODUCT_MATCHING_MODE: 'hybrid' },
    db
  });

  assert.equal(lines[0].unitCost, 80);
  assert.equal(lines[0].costSource, 'order_snapshot');
});
