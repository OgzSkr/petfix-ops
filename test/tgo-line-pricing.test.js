import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTgoLinePricing } from '../lib/channels/tgo-line-pricing.js';

test('resolveTgoLinePricing treats price as unit price when amount missing', () => {
  const result = resolveTgoLinePricing({
    price: 131,
    items: [
      { id: '1', isCancelled: false },
      { id: '2', isCancelled: false },
      { id: '3', isCancelled: false },
      { id: '4', isCancelled: false },
      { id: '5', isCancelled: false }
    ]
  });
  assert.equal(result.quantity, 5);
  assert.equal(result.unitPrice, 131);
  assert.equal(result.lineGross, 655);
});

test('resolveTgoLinePricing prefers amount as line gross', () => {
  const result = resolveTgoLinePricing({
    price: 131,
    amount: 655,
    items: [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }, { id: '5' }]
  });
  assert.equal(result.unitPrice, 131);
  assert.equal(result.listUnitPrice, 131);
  assert.equal(result.lineGross, 655);
});

test('resolveTgoLinePricing keeps list unit when amount is discounted line total', () => {
  const result = resolveTgoLinePricing({
    price: 300,
    amount: 300,
    items: [{ id: '1' }, { id: '2' }]
  });
  assert.equal(result.quantity, 2);
  assert.equal(result.unitPrice, 300);
  assert.equal(result.paidUnitPrice, 150);
  assert.equal(result.listUnitPrice, 300);
  assert.equal(result.lineGross, 600);
  assert.equal(result.paidLineGross, 300);
});

test('resolveTgoLinePricing treats duplicated line total in price field as paid unit', () => {
  const result = resolveTgoLinePricing({
    price: 655,
    amount: 655,
    items: [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }, { id: '5' }]
  });
  assert.equal(result.unitPrice, 131);
  assert.equal(result.listUnitPrice, 131);
  assert.equal(result.lineGross, 655);
});
