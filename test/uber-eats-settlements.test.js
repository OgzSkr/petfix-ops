import test from 'node:test';
import assert from 'node:assert/strict';
import { settlementsToOrderPackages } from '../lib/channels/uber-eats-orders.js';

test('settlementsToOrderPackages splits stacked discounts per sale line', () => {
  const orderNumber = '11284448834';
  const barcode = '8680589182803';

  const sales = Array.from({ length: 6 }, (_, index) => ({
    orderNumber,
    barcode,
    credit: 125,
    commissionRate: 23.75,
    commissionAmount: 29.69,
    description: 'Satış',
    transactionDate: 1
  }));

  const discounts = Array.from({ length: 6 }, () => ({
    orderNumber,
    barcode,
    debt: 12.5,
    credit: 0,
    commissionAmount: 2.97
  }));

  const packages = settlementsToOrderPackages(sales, discounts);
  assert.equal(packages.length, 1);

  const pkg = packages[0];
  assert.equal(pkg.orderNumber, orderNumber);
  assert.equal(pkg.lines.length, 6);
  assert.equal(pkg.packageGrossAmount, 750);
  assert.equal(pkg.packageTotalDiscount, 75);

  for (const line of pkg.lines) {
    assert.equal(line.lineGrossAmount, 125);
    assert.equal(line.lineSellerDiscount, 12.5);
    assert.ok(Math.abs(line.commissionAmount - 32.66) < 0.02);
  }
});
