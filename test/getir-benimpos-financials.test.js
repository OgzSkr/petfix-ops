import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeGetirOrderFinancials,
  extractGetirCampaignAmount,
  GETIR_FINANCIAL_RATES
} from '../lib/channels/getir-portal-financials.js';
import {
  applyGetirBenimposFinancials,
  summarizeGetirOrderFinancials
} from '../lib/benimpos/channel-sale-financials.js';
import {
  buildChannelSaleFromOrder,
  buildSalesCreatePayload
} from '../lib/benimpos/sales-create.js';
import { ensureProductMatching } from '../lib/product-matching/schema.js';
import { MAPPING_STATUS } from '../lib/product-matching/constants.js';

test('computeGetirOrderFinancials derives commission from gross discount and net charge', () => {
  const financials = computeGetirOrderFinancials({
    rawPayload: {
      totalPrice: 500,
      totalPriceWithPackaging: 500,
      totalDiscountAmount: 50,
      totalChargedAmountAfterProvisionOrRefund: 350
    }
  });

  assert.equal(financials.grossAmount, 500);
  assert.equal(financials.sellerDiscount, 50);
  assert.equal(financials.discountedBasket, 450);
  assert.equal(financials.netAmount, 350);
  assert.ok(financials.discountRate > 29.99 && financials.discountRate < 30.01);
  assert.equal(financials.settlementLoaded, true);
});

test('computeGetirOrderFinancials matches Getir Finansal Hareketler panel row d427', () => {
  const financials = computeGetirOrderFinancials({
    rawPayload: {
      totalPrice: 3579,
      totalPriceWithPackaging: 3581,
      totalSupplierSupportAmount: 250,
      totalPriceWithSupplierSupport: 3331,
      deliveryType: 2,
      packagingInfo: { totalPackagingPrice: 2, bagCount: 1 }
    }
  });

  assert.equal(financials.orderAmount, 3579);
  assert.equal(financials.campaignAmount, 250);
  assert.equal(financials.discountedBasket, 3329);
  assert.equal(financials.bagFee, 2);
  assert.equal(financials.orderCommission, 439.43);
  assert.equal(financials.courierFee, 0);
  assert.equal(financials.withholdingAmount, 27.57);
  assert.equal(financials.netAmount, 2864);
  assert.equal(financials.deliveryType, 'merchant');
});

test('computeGetirOrderFinancials adds courier fee for Getir delivery', () => {
  const financials = computeGetirOrderFinancials({
    rawPayload: {
      totalPrice: 1000,
      totalPriceWithPackaging: 1000,
      deliveryType: 1
    }
  });

  assert.equal(financials.discountedBasket, 1000);
  assert.ok(Math.abs(financials.orderCommission - 132) < 0.02);
  assert.ok(Math.abs(financials.courierFee - 144) < 0.02);
  assert.equal(financials.courierFeeRate, GETIR_FINANCIAL_RATES.courierFeeRate);
});

test('computeGetirOrderFinancials extracts bag fee from packagingInfo', () => {
  const financials = computeGetirOrderFinancials({
    rawPayload: {
      totalPrice: 2824.5,
      totalPriceWithPackaging: 2825.5,
      packagingInfo: { totalPackagingPrice: 1, bagCount: 1 },
      totalChargedAmountAfterProvisionOrRefund: 2725.5
    }
  });

  assert.equal(financials.orderAmount, 2824.5);
  assert.equal(financials.bagFee, 1);
  assert.equal(financials.grossAmount, 2825.5);
  assert.equal(financials.netAmount, 2725.5);
});

test('computeGetirOrderFinancials uses portal settlement breakdown when present', () => {
  const financials = computeGetirOrderFinancials({
    rawPayload: {
      totalPrice: 500,
      totalPriceWithPackaging: 501,
      financialMovement: {
        orderAmount: 500,
        bagAmount: 1,
        merchantCampaignAmount: 50,
        orderCompletionCommission: 80,
        courierServiceFee: 15,
        fixedDistributionAmount: 5,
        withholdingTaxRate: 1,
        withholdingTaxAmount: 4.2,
        merchantReceivable: 420.8
      }
    }
  });

  assert.equal(financials.campaignAmount, 50);
  assert.equal(financials.orderCommission, 80);
  assert.equal(financials.courierFee, 15);
  assert.equal(financials.withholdingAmount, 4.2);
  assert.equal(financials.netAmount, 420.8);
  assert.equal(financials.source, 'portal');
});

test('applyGetirBenimposFinancials sets discountRate and note on payload', () => {
  const payload = buildSalesCreatePayload({
    paymentType: '31481957',
    note: 'Getir #G12345',
    lines: [{ saleBarcode: 'x', title: 'Test', unitPrice: 500, quantity: 1, taxRate: 20 }]
  });

  const orderPackage = {
    rawPayload: {
      totalPrice: 500,
      totalPriceWithPackaging: 500,
      totalDiscountAmount: 50,
      totalChargedAmountAfterProvisionOrRefund: 350
    }
  };

  const { payload: adjusted, financials } = applyGetirBenimposFinancials(payload, orderPackage);
  assert.ok(adjusted.data.discountRate > 0);
  assert.match(adjusted.data.note, /Net: 350,00 TL/);
  assert.equal(financials.netAmount, 350);
});

test('summarizeGetirOrderFinancials uses precomputed getirFinancials when present', () => {
  const orderPackage = {
    getirFinancials: {
      loaded: true,
      grossAmount: 300,
      sellerDiscount: 0,
      commissionAmount: 45,
      netAmount: 255,
      discountRate: 15,
      settlementLoaded: true
    }
  };

  const financials = summarizeGetirOrderFinancials(orderPackage);
  assert.equal(financials.grossAmount, 300);
  assert.equal(financials.commissionAmount, 45);
});

test('buildChannelSaleFromOrder attaches getir financials', () => {
  const db = { products: [] };
  ensureProductMatching(db);
  const barcode = '8690000000002';
  db.productMatching.masterProducts.push({
    id: 'mp-2',
    benimposBarcode: barcode,
    name: 'Getir Ürün',
    stock: 10,
    buyingPrice: 30
  });
  db.productMatching.channelProducts.push({
    channelId: 'getir',
    channelProductId: barcode,
    channelBarcode: barcode,
    channelName: 'Getir Ürün'
  });
  db.productMatching.mappings.push({
    channelId: 'getir',
    channelProductId: barcode,
    masterProductId: 'mp-2',
    status: MAPPING_STATUS.MANUAL_CONFIRMED
  });

  const built = buildChannelSaleFromOrder({
    orderNumber: 'G12345',
    rawPayload: {
      totalPrice: 500,
      totalPriceWithPackaging: 500,
      totalDiscountAmount: 50,
      totalChargedAmountAfterProvisionOrRefund: 350
    },
    lines: [{
      barcode,
      productName: 'Getir Ürün',
      quantity: 1,
      lineUnitPrice: 500,
      lineGrossAmount: 500
    }]
  }, db, { channelId: 'getir', salePolicy: 'sale-strict' });

  assert.ok(built.financials);
  assert.equal(built.payload.data.discountRate, built.financials.discountRate);
  assert.match(built.payload.data.note, /^Getir #G12345/);
  assert.equal(built.financials.netAmount, 350);
});
