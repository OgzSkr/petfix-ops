import test from 'node:test';
import assert from 'node:assert/strict';
import { backfillOrderLineCosts, BACKFILL_COST_SOURCE } from '../lib/ops-hub/sync/order-line-cost-backfill.js';
import { ensureProductMatching } from '../lib/product-matching/schema.js';
import { MAPPING_STATUS } from '../lib/product-matching/constants.js';

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
  db.productMatching.mappings.push({
    id: 'map1',
    channelId: 'uber-eats',
    channelProductId: 'p1',
    channelBarcode: '8691112222',
    masterProductId: 'm1',
    status: MAPPING_STATUS.MANUAL_CONFIRMED
  });
  db.productMatching.channelProducts.push({
    id: 'cp1',
    channelId: 'uber-eats',
    channelProductId: 'p1',
    channelBarcode: '8691112222',
    channelName: 'Test Mama'
  });
  return db;
}

test('backfillOrderLineCosts updates lines with master buying price', async () => {
  const db = sampleDb();
  const updates = [];
  const pool = {
    query: async (sql, params) => {
      if (sql.includes('SELECT l.id')) {
        return {
          rows: [{
            id: 'line-1',
            order_id: 'order-1',
            line_index: 0,
            barcode: '8691112222',
            title: 'Test Mama',
            quantity: 1,
            unit_price: 150,
            channel_product_id: 'p1',
            matching_status: 'unmapped',
            benimpos_sales_code: null,
            reserved_qty: 0,
            channel: 'trendyol_go',
            ordered_at: new Date('2026-03-01T12:00:00Z'),
            display_id: 'T1'
          }]
        };
      }
      if (sql.startsWith('UPDATE ops_order_lines')) {
        updates.push(params);
        return { rowCount: 1 };
      }
      return { rows: [] };
    }
  };

  const result = await backfillOrderLineCosts(pool, {
    limit: 10,
    platformEnv: { PRODUCT_MATCHING_MODE: 'hybrid', PRODUCT_MATCHING_ENABLED: 'true' },
    db
  });

  assert.equal(result.ok, true);
  assert.equal(result.updated, 1);
  assert.equal(updates.length, 1);
  assert.equal(updates[0][1], 95);
  assert.equal(updates[0][2], BACKFILL_COST_SOURCE);
});

test('backfillOrderLineCosts dry-run does not update', async () => {
  const db = sampleDb();
  let updateCount = 0;
  const pool = {
    query: async (sql) => {
      if (sql.includes('SELECT l.id')) {
        return {
          rows: [{
            id: 'line-1',
            order_id: 'order-1',
            line_index: 0,
            barcode: '8691112222',
            title: 'Test Mama',
            quantity: 1,
            unit_price: 150,
            channel_product_id: 'p1',
            matching_status: 'unmapped',
            benimpos_sales_code: null,
            reserved_qty: 0,
            channel: 'trendyol_go',
            ordered_at: new Date(),
            display_id: 'T1'
          }]
        };
      }
      if (sql.startsWith('UPDATE')) updateCount += 1;
      return { rows: [] };
    }
  };

  const result = await backfillOrderLineCosts(pool, {
    dryRun: true,
    platformEnv: { PRODUCT_MATCHING_MODE: 'hybrid' },
    db
  });
  assert.equal(result.updated, 1);
  assert.equal(updateCount, 0);
});
