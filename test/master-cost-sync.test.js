import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCostByBarcode } from '../lib/order-profitability.js';
import {
  buildMasterCostIndex,
  mergeCostIndexes,
  syncChannelCostsFromMasterProducts
} from '../lib/product-matching/master-cost-sync.js';
import { labelProfitConfidenceForRow } from '../lib/production/profit-confidence.js';
import { normalizeMatchingSyncSettings } from '../lib/product-matching/matching-sync-schedule.js';

test('buildMasterCostIndex uses buyingPrice from masterProducts', () => {
  const db = {
    productMatching: {
      masterProducts: [
        { benimposBarcode: '869111', buyingPrice: 120, taxRate: 20 },
        { benimposBarcode: '869222', buyingPrice: 0 }
      ]
    }
  };
  const index = buildMasterCostIndex(db);
  assert.equal(index['869111'].unitCost, 120);
  assert.equal(index['869111'].costSource, 'master_buying_price');
  assert.equal(index['869222'], undefined);
});

test('mergeCostIndexes prefers master unitCost over channelCosts', () => {
  const merged = mergeCostIndexes(
    { '869111': { unitCost: 50, desi: 3, costSource: 'channel_cost' } },
    { '869111': { unitCost: 120, costSource: 'master_buying_price' } }
  );
  assert.equal(merged['869111'].unitCost, 120);
  assert.equal(merged['869111'].desi, 3);
});

test('buildCostByBarcode reads master buyingPrice without channelCosts row', () => {
  const db = {
    channelCosts: [],
    productMatching: {
      masterProducts: [{ benimposBarcode: '869333', buyingPrice: 85, taxRate: 10 }]
    }
  };
  const costs = buildCostByBarcode(db);
  assert.equal(costs['869333'].unitCost, 85);
});

test('syncChannelCostsFromMasterProducts writes channelCosts from master', () => {
  const db = {
    channelCosts: [],
    productMatching: {
      masterProducts: [{ benimposBarcode: '869444', buyingPrice: 42, taxRate: 20, name: 'Test' }]
    }
  };
  const summary = syncChannelCostsFromMasterProducts(db);
  assert.equal(summary.added, 1);
  assert.equal(db.channelCosts[0].productCost, 42);
});

test('labelProfitConfidenceForRow adds guidance for missing cost and mapping', () => {
  assert.match(
    labelProfitConfidenceForRow({ profitConfidence: 'missing_mapping', salesAmount: 100, productCost: 10 }),
    /kanal eşleştir/
  );
  assert.match(
    labelProfitConfidenceForRow({ profitConfidence: 'missing_cost', salesAmount: 100, productCost: 0 }),
    /alış fiyatı/
  );
});

test('normalizeMatchingSyncSettings enables sync when PRODUCT_MATCHING_ENABLED=true', () => {
  const settings = normalizeMatchingSyncSettings({}, { PRODUCT_MATCHING_ENABLED: 'true' });
  assert.equal(settings.enabled, true);
});
