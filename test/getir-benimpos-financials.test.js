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

test('computeGetirOrderFinancials applies rules for discount and commission', () => {
  const financials = computeGetirOrderFinancials({
    rawPayload: {
      totalPrice: 500,
      totalPriceWithPackaging: 500,
      merchantCampaignAmount: 50
    }
  });

  assert.equal(financials.grossAmount, 500);
  assert.equal(financials.sellerDiscount, 50);
  assert.equal(financials.discountedBasket, 450);
  assert.equal(financials.netAmount, 386.87);
  assert.equal(financials.source, 'rules');
  assert.equal(financials.settlementLoaded, true);
});

test('computeGetirOrderFinancials computes net payout from rules when gross equals customer charge', () => {
  const financials = computeGetirOrderFinancials({
    rawPayload: {
      totalPrice: 1000,
      totalPriceWithPackaging: 1000,
      deliveryType: 2,
      totalChargedAmountAfterProvisionOrRefund: 1000
    }
  });

  assert.equal(financials.grossAmount, 1000);
  assert.ok(financials.orderCommission > 0, 'komisyon hesaplanmalı');
  assert.ok(financials.withholdingAmount > 0, 'stopaj hesaplanmalı');
  assert.ok(financials.netAmount < financials.grossAmount, 'işletme alacağı brüt tutardan düşük olmalı');
  assert.equal(financials.netAmount, 859.72);
  assert.equal(financials.source, 'rules');
});

test('computeGetirOrderFinancials matches Getir Finansal Hareketler panel row d427 via rules', () => {
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
  assert.equal(financials.commissionRate, GETIR_FINANCIAL_RATES.routingCommissionRate);
  assert.equal(financials.courierFeeRate, GETIR_FINANCIAL_RATES.courierFeeRate);
});

test('computeGetirOrderFinancials shows rule commission rate on discounted basket', () => {
  const financials = computeGetirOrderFinancials({
    rawPayload: {
      totalPrice: 1071.02,
      totalPriceWithPackaging: 1072.02,
      packagingInfo: { totalPackagingPrice: 1 },
      merchantCampaignAmount: 250,
      deliveryType: 1
    }
  });

  assert.equal(financials.discountedBasket, 821.02);
  assert.equal(financials.commissionRate, 13.2);
  assert.ok(Math.abs(financials.orderCommission - 108.37) < 0.05);
  assert.ok(Math.abs(financials.courierFee - 118.23) < 0.05);
  assert.ok(Math.abs(financials.commissionAmount - financials.orderCommission - financials.courierFee) < 0.02);
});

test('computeGetirOrderFinancials extracts bag fee and ignores charged amount for net', () => {
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
  assert.equal(financials.netAmount, 2429.27);
  assert.equal(financials.source, 'rules');
});

test('computeGetirOrderFinancials uses rules for r977 with webhook discount', () => {
  const financials = computeGetirOrderFinancials({
    rawPayload: {
      totalPrice: 5601.96,
      totalPriceWithPackaging: 5603.96,
      totalDiscountAmount: 100,
      packagingInfo: { totalPackagingPrice: 2, bagCount: 1 },
      totalChargedAmountAfterProvisionOrRefund: 5501.96,
      deliveryType: 2
    }
  });

  assert.equal(financials.orderAmount, 5601.96);
  assert.equal(financials.bagFee, 2);
  assert.equal(financials.campaignAmount, 100);
  assert.equal(financials.discountedBasket, 5501.96);
  assert.equal(financials.orderCommission, 726.26);
  assert.equal(financials.withholdingAmount, 45.57);
  assert.equal(financials.netAmount, 4732.13);
  assert.notEqual(financials.netAmount, 5501.96);
});

test('computeGetirOrderFinancials ignores spurious totalDiscountAmount on y800-like basket', () => {
  const financials = computeGetirOrderFinancials({
    rawPayload: {
      totalPrice: 748,
      totalPriceWithPackaging: 749,
      grossAmount: 749,
      totalDiscountAmount: 20,
      totalPriceWithSupplierSupport: 749,
      products: [
        { count: 2, price: 299, finalTotalPrice: 598, name: { tr: 'Kedi kumu' } },
        { count: 1, price: 150, finalTotalPrice: 150, name: { tr: 'Oyuncak' } }
      ]
    }
  });

  assert.equal(financials.sellerDiscount, 0);
  assert.equal(financials.discountedBasket, 748);
  assert.equal(financials.grossAmount, 749);
});

test('computeGetirOrderFinancials ignores portal settlement breakdown in payload', () => {
  const financials = computeGetirOrderFinancials({
    rawPayload: {
      totalPrice: 500,
      totalPriceWithPackaging: 501,
      packagingInfo: { totalPackagingPrice: 1 },
      financialMovement: {
        orderAmount: 500,
        bagAmount: 1,
        merchantCampaignAmount: 50,
        orderCompletionCommission: 80,
        courierServiceFee: 15,
        merchantReceivable: 420.8
      }
    }
  });

  assert.equal(financials.source, 'rules');
  assert.notEqual(financials.netAmount, 420.8);
  assert.equal(financials.netAmount, 430.86);
});

test('applyGetirBenimposFinancials sets customer discount only (no commission/stopaj in BenimPOS)', () => {
  const payload = buildSalesCreatePayload({
    paymentType: '31481957',
    note: 'Getir #G12345',
    lines: [{ saleBarcode: 'x', title: 'Test', unitPrice: 500, quantity: 1, taxRate: 20 }]
  });

  const orderPackage = {
    rawPayload: {
      totalPrice: 500,
      totalPriceWithPackaging: 500,
      merchantCampaignAmount: 50
    }
  };

  const { payload: adjusted, financials, customerCharge } = applyGetirBenimposFinancials(payload, orderPackage);
  assert.ok(Math.abs(adjusted.data.discountRate - 10) < 0.05);
  assert.equal(adjusted.data.note, 'Getir #G12345');
  assert.doesNotMatch(adjusted.data.note, /Stopaj/);
  assert.equal(customerCharge, 450);
  assert.equal(financials.netAmount, 386.87);
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
      merchantCampaignAmount: 50
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
  assert.ok(Math.abs(built.payload.data.discountRate - 10) < 0.05);
  assert.match(built.payload.data.note, /^Getir #G12345/);
  assert.equal(built.benimposSaleTotals.customerCharge, 450);
  assert.equal(built.financials.netAmount, 386.87);
});

test('extractGetirCampaignAmount reads merchantCampaignAmount from webhook payload', () => {
  assert.equal(extractGetirCampaignAmount({ merchantCampaignAmount: 100 }), 100);
});

test('extractGetirCampaignAmount uses product line list minus paid totals', () => {
  assert.equal(extractGetirCampaignAmount({
    totalDiscountAmount: 999,
    products: [
      { count: 2, price: 100, finalTotalPrice: 150 },
      { count: 1, price: 50, finalTotalPrice: 50 }
    ]
  }), 50);
});

test('extractGetirCampaignAmount ignores totalDiscountAmount when product lines show no discount', () => {
  assert.equal(extractGetirCampaignAmount({
    totalPrice: 748,
    totalPriceWithPackaging: 749,
    totalDiscountAmount: 20,
    totalPriceWithSupplierSupport: 749,
    products: [
      { count: 2, price: 299, finalTotalPrice: 598 },
      { count: 1, price: 150, finalTotalPrice: 150 }
    ]
  }), 0);
});

test('extractGetirCampaignAmount ignores removed lines with finalCount zero', () => {
  assert.equal(extractGetirCampaignAmount({
    totalPrice: 596,
    products: [
      { count: 1, price: 205, finalCount: 1, finalTotalPrice: 205 },
      { count: 1, price: 225, finalCount: 0, finalTotalPrice: 0 },
      { count: 1, price: 205, finalCount: 1, finalTotalPrice: 205 },
      { count: 1, price: 185, finalCount: 1, finalTotalPrice: 185 }
    ]
  }), 0);
});

test('extractGetirCampaignAmount accepts totalDiscountAmount when charged amount corroborates', () => {
  assert.equal(extractGetirCampaignAmount({
    totalPrice: 5601.96,
    totalDiscountAmount: 100,
    totalChargedAmountAfterProvisionOrRefund: 5501.96
  }), 100);
});

test('analyzeOrderPackages keeps Getir rule financials on order rows', async () => {
  const { analyzeOrderPackages } = await import('../lib/order-profitability.js');
  const {
    computeGetirOrderFinancials,
    applyGetirFinancialsToPackage
  } = await import('../lib/channels/getir-portal-financials.js');

  const pkg = applyGetirFinancialsToPackage({
    channel: 'getir',
    orderNumber: 'G-100',
    orderDate: '2026-06-18T12:00:00.000Z',
    status: 'completed',
    lines: [{ barcode: '869000000001', productName: 'Test', quantity: 1, lineUnitPrice: 500 }]
  }, computeGetirOrderFinancials({
    rawPayload: { totalPrice: 500, totalPriceWithPackaging: 500 },
    packageGrossAmount: 500
  }));

  const rows = analyzeOrderPackages([pkg], { products: [] }, { channelId: 'getir' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].portalFinancials?.loaded, true);
  assert.equal(rows[0].portalFinancials?.source, 'rules');
  assert.ok(rows[0].getirFinancials?.netAmount > 0);
});
