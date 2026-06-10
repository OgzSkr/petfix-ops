import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyProductMatching } from '../lib/product-matching/schema.js';
import { MAPPING_STATUS } from '../lib/product-matching/mapping-types.js';
import { buildStockSyncPlan, STOCK_CHANNEL_CAPABILITIES } from '../lib/ops-hub/stock/stock-plan.js';
import {
  buildStockPushSimulation,
  isStockPushEnabled
} from '../lib/ops-hub/stock/stock-sync-service.js';
import { buildYemeksepetiStockPayload } from '../lib/ops-hub/channels/yemeksepeti-stock-write.js';
import { buildTgoStockPushSimulation } from '../lib/ops-hub/channels/tgo-stock-write.js';

function sampleDb() {
  return {
    productMatching: {
      ...createEmptyProductMatching(),
      masterProducts: [
        {
          id: 'mp-1',
          benimposBarcode: '8690001112223',
          name: 'Su 1L',
          stock: 12
        },
        {
          id: 'mp-2',
          benimposBarcode: '8690004445556',
          name: 'Cips',
          stock: 5
        }
      ],
      channelProducts: [
        {
          channelId: 'yemeksepeti',
          channelProductId: 'SKU-1',
          channelName: 'Su 1L',
          ysActive: true
        },
        {
          channelId: 'uber-eats',
          channelProductId: 'TGO-1',
          channelBarcode: '8690001112223',
          catalogQuantity: 10
        }
      ],
      mappings: [
        {
          channelId: 'yemeksepeti',
          channelProductId: 'SKU-1',
          masterProductId: 'mp-1',
          status: MAPPING_STATUS.MANUAL_CONFIRMED
        },
        {
          channelId: 'uber-eats',
          channelProductId: 'TGO-1',
          masterProductId: 'mp-1',
          status: MAPPING_STATUS.MANUAL_CONFIRMED
        },
        {
          channelId: 'yemeksepeti',
          channelProductId: 'SKU-2',
          masterProductId: 'mp-2',
          status: MAPPING_STATUS.PENDING
        }
      ]
    }
  };
}

test('buildStockSyncPlan computes TGO drift from catalogQuantity', () => {
  const plan = buildStockSyncPlan(sampleDb(), 'trendyol_go');
  assert.equal(plan.buyboxChannelId, 'uber-eats');
  assert.equal(plan.items.length, 1);
  assert.equal(plan.items[0].targetQuantity, 12);
  assert.equal(plan.items[0].channelQuantity, 10);
  assert.equal(plan.items[0].drift, 2);
  assert.equal(plan.capability.livePush, false);
});

test('buildStockSyncPlan builds YS push rows without channel quantity', () => {
  const plan = buildStockSyncPlan(sampleDb(), 'yemeksepeti');
  assert.equal(plan.items.length, 1);
  assert.equal(plan.items[0].channelProductId, 'SKU-1');
  assert.equal(plan.items[0].targetQuantity, 12);
  assert.equal(plan.items[0].channelQuantity, null);
  assert.equal(plan.capability.livePush, true);
});

test('buildStockSyncPlan enforces coverage threshold', () => {
  const db = sampleDb();
  db.productMatching.channelProducts.push({
    channelId: 'yemeksepeti',
    channelProductId: 'SKU-UNMAPPED',
    channelName: 'Eksik',
    ysActive: true
  });
  const plan = buildStockSyncPlan(db, 'yemeksepeti', { minCoveragePercent: 90 });
  assert.equal(plan.summary.blockedByCoverage, true);
});

test('buildYemeksepetiStockPayload maps quantity and active flag', () => {
  const payload = buildYemeksepetiStockPayload([
    { channelProductId: 'SKU-1', targetQuantity: 3 },
    { channelProductId: 'SKU-2', targetQuantity: 0 }
  ]);
  assert.equal(payload.products.length, 2);
  assert.equal(payload.products[0].quantity, 3);
  assert.equal(payload.products[0].active, true);
  assert.equal(payload.products[1].active, false);
});

test('buildTgoStockPushSimulation marks G2 blocked', () => {
  const sim = buildTgoStockPushSimulation([{ barcode: '869', targetQuantity: 1, channelProductId: 'x' }]);
  assert.equal(sim.blocked, true);
  assert.match(sim.reason, /G2_FAIL/);
});

test('buildStockPushSimulation returns dry-run payload', () => {
  const plan = buildStockSyncPlan(sampleDb(), 'yemeksepeti');
  const sim = buildStockPushSimulation(plan);
  assert.equal(sim.dryRun, true);
  assert.equal(sim.itemCount, 1);
});

test('isStockPushEnabled reads env flag', () => {
  assert.equal(isStockPushEnabled({ FF_STOCK_PUSH: 'false' }), false);
  assert.equal(isStockPushEnabled({ FF_STOCK_PUSH: 'true' }), true);
});

test('STOCK_CHANNEL_CAPABILITIES documents getir blocked', () => {
  assert.equal(STOCK_CHANNEL_CAPABILITIES.getir.livePush, false);
});
