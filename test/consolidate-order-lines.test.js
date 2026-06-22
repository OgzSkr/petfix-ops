import test from 'node:test';
import assert from 'node:assert/strict';
import {
  consolidateOrderLines,
  normalizeOrderLinePricingFields
} from '../lib/channels/consolidate-order-lines.js';

test('normalizeOrderLinePricingFields multiplies unit by qty for line gross', () => {
  const line = normalizeOrderLinePricingFields({
    barcode: '6927749871088',
    quantity: 5,
    lineUnitPrice: 131
  });
  assert.equal(line.lineUnitPrice, 131);
  assert.equal(line.lineGrossAmount, 655);
});

test('normalizeOrderLinePricingFields fixes line total stored as both unit and gross', () => {
  const line = normalizeOrderLinePricingFields({
    barcode: '6927749871088',
    quantity: 5,
    lineUnitPrice: 131,
    lineGrossAmount: 131
  });
  assert.equal(line.lineUnitPrice, 131);
  assert.equal(line.lineGrossAmount, 655);
});

test('normalizeOrderLinePricingFields keeps correct unit and gross', () => {
  const line = normalizeOrderLinePricingFields({
    barcode: '052742059532',
    quantity: 1,
    lineUnitPrice: 1700,
    lineGrossAmount: 1700
  });
  assert.equal(line.lineUnitPrice, 1700);
  assert.equal(line.lineGrossAmount, 1700);
});

test('consolidateOrderLines merges same barcode and unit price', () => {
  const lines = [
    { barcode: '111', productName: 'Ürün A', quantity: 1, lineUnitPrice: 85, lineGrossAmount: 85 },
    { barcode: '111', productName: 'Ürün A', quantity: 1, lineUnitPrice: 85, lineGrossAmount: 85 },
    { barcode: '111', productName: 'Ürün A', quantity: 1, lineUnitPrice: 85, lineGrossAmount: 85 },
    { barcode: '222', productName: 'Ürün B', quantity: 1, lineUnitPrice: 119.99, lineGrossAmount: 119.99 }
  ];
  const out = consolidateOrderLines(lines);
  assert.equal(out.length, 2);
  const a = out.find((line) => line.barcode === '111');
  const b = out.find((line) => line.barcode === '222');
  assert.equal(a.quantity, 3);
  assert.equal(a.lineGrossAmount, 255);
  assert.equal(b.quantity, 1);
});
