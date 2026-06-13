import test from 'node:test';
import assert from 'node:assert/strict';
import { consolidateOrderLines } from '../lib/channels/consolidate-order-lines.js';

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
