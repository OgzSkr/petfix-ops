import test from 'node:test';
import assert from 'node:assert/strict';
import { computeUberPortalFinancials } from '../lib/channels/uber-eats-portal-financials.js';

test('computeUberPortalFinancials matches Trendyol Go partner portal daily record', () => {
  const orderNumber = '11324593366';
  const settlement = {
    sales: [{
      orderNumber,
      credit: 1550,
      commissionRate: 23.75,
      commissionAmount: 368.13,
      sellerRevenue: 1181.87
    }],
    discounts: [{
      orderNumber,
      debt: 150,
      commissionAmount: 35.63,
      sellerRevenue: 114.37
    }],
    returns: [],
    provisionNegative: [],
    provisionPositive: [{
      orderNumber,
      credit: 1,
      commissionAmount: 0.24,
      sellerRevenue: 0.76
    }]
  };

  const portal = computeUberPortalFinancials(settlement, orderNumber);

  assert.equal(portal.loaded, true);
  assert.equal(portal.price, 1550);
  assert.equal(portal.discount, 150);
  assert.ok(Math.abs(portal.commission - 332.74) < 0.01);
  assert.equal(portal.commissionRate, 23.75);
  assert.equal(portal.partialRefund, 0);
  assert.equal(portal.deliveryFee, 0);
  assert.equal(portal.provision, 1);
  assert.ok(Math.abs(portal.netEarning - 1068.26) < 0.01);
});
