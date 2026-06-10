import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeOrderPackages } from '../lib/order-profitability.js';
import {
  buildShippingCostIndex,
  ensureDhlShippingCosts,
  extractTrendyolTrackingId,
  syncDhlCostsForPackages,
  trendyolOrderKey
} from '../lib/carriers/dhl-shipping-costs.js';

test('extractTrendyolTrackingId prefers cargoTrackingNumber', () => {
  assert.equal(
    extractTrendyolTrackingId({ cargoTrackingNumber: 7280027504111111, cargoSenderNumber: '210090111111' }),
    '7280027504111111'
  );
});

test('analyzeOrderPackages uses DHL shipping costs when indexed', () => {
  const orderKey = '2111681160|3330111111';
  const packages = [{
    orderNumber: '2111681160',
    shipmentPackageId: 3330111111,
    cargoTrackingNumber: 7280027504111111,
    orderDate: Date.now(),
    status: 'Delivered',
    lines: [{ barcode: '8683772071724', quantity: 1, lineGrossAmount: 100, lineUnitPrice: 100, commission: 13 }]
  }];

  const rows = analyzeOrderPackages(packages, { products: [] }, {
    costByBarcode: {},
    cargoByDesi: { 1: 86.4 },
    defaultShippingCost: 0,
    serviceFee: 0,
    stoppageRate: 0,
    adCostRate: 0,
    shippingCostByOrderKey: {
      [orderKey]: {
        outbound: 92.5,
        returnTotal: 34.24,
        total: 126.74,
        source: 'invoiced'
      }
    }
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].shippingCost, 126.74);
  assert.equal(rows[0].outboundShippingCost, 92.5);
  assert.equal(rows[0].returnShippingCost, 34.24);
  assert.equal(rows[0].shippingCostSource, 'dhl');
  assert.equal(rows[0].shippingCostEstimated, false);
});

test('syncDhlCostsForPackages stores resolved amounts in db index', async () => {
  const db = { products: [] };
  ensureDhlShippingCosts(db);

  const packages = [{
    orderNumber: '9001',
    shipmentPackageId: 55,
    cargoTrackingNumber: '614118757013',
    orderDate: Date.now(),
    status: 'Delivered',
    lines: []
  }];

  const env = {
    DHL_API_CLIENT_ID: 'cid',
    DHL_API_CLIENT_SECRET: 'sec',
    DHL_CUSTOMER_NUMBER: '1234567890',
    DHL_API_PASSWORD: 'pw',
    DHL_API_ENV: 'STAGE'
  };

  const originalFetch = global.fetch;
  let call = 0;
  global.fetch = async (url, init = {}) => {
    call += 1;
    const path = String(url);

    if (path.endsWith('/mngapi/api/token')) {
      return new Response(JSON.stringify({ jwt: 'test-jwt' }), { status: 200 });
    }

    if (path.includes('getshipmentstatusByShipmentId/614118757013')) {
      return new Response(JSON.stringify({ shipmentStatusCode: 5, shipmentId: '614118757013' }), { status: 200 });
    }

    if (path.includes('financequeryapi') && path.includes('614118757013')) {
      return new Response(JSON.stringify({ amount: 88.2, desi: 2 }), { status: 200 });
    }

    return new Response('{}', { status: 404 });
  };

  try {
    const result = await syncDhlCostsForPackages(packages, env, db, { maxLookups: 5 });
    assert.equal(result.configured, true);
    assert.equal(result.summary.resolved, 1);
    assert.equal(buildShippingCostIndex(db)['9001|55'].total, 88.2);
    assert.equal(db.dhlShippingCosts.byTracking['614118757013'].source, 'invoiced');
    assert.ok(call >= 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test('trendyolOrderKey matches order-profitability key format', () => {
  const pkg = { orderNumber: 'A', shipmentPackageId: 9, id: 9 };
  assert.equal(trendyolOrderKey(pkg), 'A|9');
});

test('seller cargo agreement ignores Trendyol cargoPrice — uses desi only', () => {
  const packages = [{
    orderNumber: '9002',
    shipmentPackageId: 77,
    whoPays: 1,
    cargoPrice: 45,
    orderDate: Date.now(),
    status: 'Delivered',
    lines: [{ barcode: '8683772071724', quantity: 1, lineGrossAmount: 100, lineUnitPrice: 100, commission: 13 }]
  }];

  const rows = analyzeOrderPackages(packages, {
    products: [],
    costs: [{ barcode: '8683772071724', desi: 3, productCost: 10, commissionRate: 13 }]
  }, {
    costScope: 'trendyol-marketplace',
    cargoByDesi: { 3: 90 },
    defaultShippingCost: 0,
    serviceFee: 0,
    stoppageRate: 0,
    adCostRate: 0
  });

  assert.equal(rows[0].shippingCost, 90);
  assert.equal(rows[0].shippingCostSource, 'desi');
  assert.notEqual(rows[0].shippingCost, 45);
});
