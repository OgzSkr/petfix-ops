import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeYemeksepetiOrder } from '../lib/channels/yemeksepeti-orders.js';

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
