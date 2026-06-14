import test from 'node:test';
import assert from 'node:assert/strict';
import { settlementsToOrderPackages } from '../lib/channels/uber-eats-orders.js';
import {
  applyUberBenimposFinancials,
  summarizeUberOrderFinancials
} from '../lib/benimpos/channel-sale-financials.js';
import {
  buildChannelSaleFromOrder,
  buildSalesCreatePayload,
  orderTimestampToBenimposParts
} from '../lib/benimpos/sales-create.js';

test('summarizeUberOrderFinancials matches Uber portal settlement totals', () => {
  const orderNumber = '11321986580';
  const sales = Array.from({ length: 10 }, () => ({
    orderNumber,
    barcode: '8680589182803',
    credit: 125,
    commissionRate: 23.75,
    commissionAmount: 27.907,
    description: 'Satış',
    transactionDate: 1
  }));
  const discounts = Array.from({ length: 10 }, () => ({
    orderNumber,
    barcode: '8680589182803',
    debt: 7.5,
    commissionAmount: 0
  }));

  const [orderPackage] = settlementsToOrderPackages(sales, discounts);
  const financials = summarizeUberOrderFinancials(orderPackage);

  assert.equal(financials.grossAmount, 1250);
  assert.equal(financials.sellerDiscount, 75);
  assert.ok(Math.abs(financials.commissionAmount - 279.07) < 0.05);
  assert.ok(Math.abs(financials.netAmount - 895.93) < 0.05);
  assert.ok(financials.discountRate > 28.32 && financials.discountRate < 28.33);
});

test('applyUberBenimposFinancials sets discountRate and note on payload', () => {
  const payload = buildSalesCreatePayload({
    paymentType: '27749256',
    note: 'TRENDGO #11321986580',
    lines: [{ saleBarcode: 'x', title: 'Test', unitPrice: 125, quantity: 10, taxRate: 20 }]
  });

  const orderPackage = {
    packageGrossAmount: 1250,
    packageTotalDiscount: 75,
    lines: [{
      barcode: 'x',
      quantity: 10,
      lineGrossAmount: 1250,
      lineSellerDiscount: 75,
      commissionAmount: 279.07
    }]
  };

  const { payload: adjusted, financials } = applyUberBenimposFinancials(payload, orderPackage);
  assert.ok(adjusted.data.discountRate > 0);
  assert.match(adjusted.data.note, /Kom: 279,07/);
  assert.match(adjusted.data.note, /Net: 895,93 TL/);
  assert.equal(adjusted.data.customerCode, undefined);
  assert.equal(financials.netAmount, 895.93);
});

import { ensureProductMatching } from '../lib/product-matching/schema.js';
import { MAPPING_STATUS } from '../lib/product-matching/constants.js';

test('buildChannelSaleFromOrder attaches uber financials for settlement orders', () => {
  const db = { products: [] };
  ensureProductMatching(db);
  const barcode = '8690000000001';
  db.productMatching.masterProducts.push({
    id: 'mp-1',
    benimposBarcode: barcode,
    name: 'Test Ürün',
    stock: 10,
    buyingPrice: 50
  });
  db.productMatching.channelProducts.push({
    channelId: 'uber-eats',
    channelProductId: barcode,
    channelBarcode: barcode,
    channelName: 'Test Ürün'
  });
  db.productMatching.mappings.push({
    channelId: 'uber-eats',
    channelProductId: barcode,
    masterProductId: 'mp-1',
    status: MAPPING_STATUS.MANUAL_CONFIRMED
  });

  const built = buildChannelSaleFromOrder({
    orderNumber: '11321986580',
    packageGrossAmount: 1250,
    packageTotalDiscount: 75,
    lines: [{
      barcode,
      productName: 'Test',
      quantity: 1,
      lineUnitPrice: 1250,
      lineGrossAmount: 1250,
      lineSellerDiscount: 75,
      commissionAmount: 279.07
    }]
  }, db, { channelId: 'uber-eats', salePolicy: 'sale-strict' });

  assert.ok(built.financials);
  assert.equal(built.payload.data.discountRate, built.financials.discountRate);
  assert.equal(built.payload.data.customerCode, undefined);
  assert.match(built.payload.data.note, /^Trendyol Go #11321986580/);
  assert.ok(Math.abs(built.financials.netAmount - 895.93) < 0.01);
});

test('buildChannelSaleFromOrder uses channel order date in Turkey time for BenimPOS', () => {
  const orderDateMs = 1781436158342; // 11321986580 — 14 Haz 2026 14:22 TR
  assert.deepEqual(orderTimestampToBenimposParts(orderDateMs), {
    date: '2026-06-14',
    time: '14:22:38'
  });

  const payload = buildSalesCreatePayload({
    orderDate: orderDateMs,
    paymentType: '27749256',
    lines: [{ barcode: '5060412214117', title: 'Test', price: 1250, quantity: 1 }]
  });

  assert.equal(payload.data.date, '2026-06-14');
  assert.equal(payload.data.time, '14:22:38');
});
