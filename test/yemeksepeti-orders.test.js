import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isYemeksepetiOrderUuid,
  normalizeYemeksepetiOrder
} from '../lib/channels/yemeksepeti-orders.js';

test('isYemeksepetiOrderUuid accepts UUID v4 format', () => {
  assert.equal(isYemeksepetiOrderUuid('9d4a63b5-3e07-4440-96af-aa04797da3a0'), true);
  assert.equal(isYemeksepetiOrderUuid('ys-wh-test-001'), false);
});

test('normalizeYemeksepetiOrder derives gross from line items when payment missing', () => {
  const row = normalizeYemeksepetiOrder({
    order_id: 'abc',
    order_code: 'YS-1',
    status: 'RECEIVED',
    sys: { created_at: '2026-06-09T10:00:00Z' },
    items: [{
      sku: '2662ZF',
      barcode: ['8690001112223'],
      name: 'Test',
      pricing: { quantity: 2, unit_price: 35.5 }
    }]
  });

  assert.equal(row.packageGrossAmount, 71);
  assert.equal(row.orderNumber, 'YS-1');
});
