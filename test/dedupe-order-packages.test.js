import test from 'node:test';
import assert from 'node:assert/strict';
import { dedupeOrderPackages, mergeOrderLines } from '../lib/channels/dedupe-order-packages.js';

test('mergeOrderLines replaces generic Satış names from ops/webhook lines', () => {
  const financeLines = [
    { barcode: '000007831301', productName: 'Satış', quantity: 1, lineUnitPrice: 200 },
    { barcode: '0761303837553', productName: 'Satış', quantity: 1, lineUnitPrice: 210 }
  ];
  const opsLines = [
    { barcode: '9003579311301', productName: 'Gravy Sterilised Kısırlaştırılmış Yaş Kedi Maması 85 gr', quantity: 1 },
    { barcode: '07613036075534', productName: 'Açık Purina Proplan Somonlu Kısırlaştırılmış Kedi Maması 500 Gr', quantity: 1 }
  ];

  const merged = mergeOrderLines(financeLines, opsLines);
  assert.equal(merged.length, 2);
  assert.match(merged[0].productName, /Gravy Sterilised/i);
  assert.match(merged[1].productName, /Proplan/i);
  assert.equal(merged[0].lineUnitPrice, 200);
});

test('dedupeOrderPackages merges finance settlement with ops product titles', () => {
  const packages = dedupeOrderPackages([
    {
      orderNumber: '11320270516',
      lines: [
        { barcode: '000007831301', productName: 'Satış', quantity: 1 },
        { barcode: '0761303837553', productName: 'Satış', quantity: 1 }
      ],
      ingestSource: 'partner_api'
    },
    {
      orderNumber: '11320270516',
      lines: [
        { barcode: '9003579311301', productName: 'Gravy Sterilised Kısırlaştırılmış Yaş Kedi Maması 85 gr', quantity: 1 },
        { barcode: '07613036075534', productName: 'Açık Purina Proplan Somonlu Kısırlaştırılmış Kedi Maması 500 Gr', quantity: 1 }
      ],
      ingestSource: 'webhook'
    }
  ]);

  assert.equal(packages.length, 1);
  assert.match(packages[0].lines[0].productName, /Gravy Sterilised/i);
  assert.match(packages[0].lines[1].productName, /Proplan/i);
});

test('mergeOrderLines keeps settlement commission when TGO base line has none', () => {
  const tgoLines = [
    {
      barcode: '8680589182803',
      productName: 'Felix Party Mix 60g',
      quantity: 10,
      lineUnitPrice: 125,
      lineGrossAmount: 1250,
      lineSellerDiscount: 75
    }
  ];
  const settlementLines = [
    {
      barcode: '8680589182803',
      productName: 'Satış',
      quantity: 10,
      lineUnitPrice: 125,
      lineGrossAmount: 1250,
      lineSellerDiscount: 75,
      commissionAmount: 279.07
    }
  ];

  const merged = mergeOrderLines(tgoLines, settlementLines);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].productName, 'Felix Party Mix 60g');
  assert.ok(Math.abs(merged[0].commissionAmount - 279.07) < 0.01);
  assert.equal(merged[0].lineSellerDiscount, 75);
});

test('dedupeOrderPackages merges TGO package with settlement commission and provision', () => {
  const packages = dedupeOrderPackages([
    {
      orderNumber: '11324593366',
      packageGrossAmount: 1550,
      packageTotalDiscount: 150,
      lines: [{
        barcode: '8690000000001',
        productName: 'Test Ürün',
        quantity: 1,
        lineUnitPrice: 1550,
        lineGrossAmount: 1550
      }]
    },
    {
      orderNumber: '11324593366',
      packageGrossAmount: 1550,
      packageTotalDiscount: 150,
      packageCommissionAmount: 332.74,
      packageSaleCommissionAmount: 332.74,
      packageProvisionAmount: 1,
      packageProvisionNet: 1,
      lines: [{
        barcode: '8690000000001',
        productName: 'Satış',
        quantity: 1,
        lineGrossAmount: 1550,
        lineSellerDiscount: 150,
        commissionAmount: 332.74
      }]
    }
  ]);

  assert.equal(packages.length, 1);
  assert.equal(packages[0].lines[0].productName, 'Test Ürün');
  assert.ok(Math.abs(packages[0].lines[0].commissionAmount - 332.74) < 0.01);
  assert.equal(packages[0].packageProvisionAmount, 1);
  assert.equal(packages[0].packageCommissionAmount, 332.74);
  assert.equal(packages[0].packageSaleCommissionAmount, 332.74);
});

test('dedupeOrderPackages prefers completed status when merging Getir duplicate rows', () => {
  const packages = dedupeOrderPackages([
    {
      channel: 'getir',
      orderNumber: 'p599',
      shipmentPackageId: 'p599',
      status: 'picking',
      packageGrossAmount: 321,
      lines: [{ productName: 'Ürün A', quantity: 1 }]
    },
    {
      channel: 'getir',
      orderNumber: 'p599',
      shipmentPackageId: '6a355fa65fe50899ba8e9169',
      status: 'completed',
      packageGrossAmount: 321,
      lines: [{ productName: 'Ürün A', quantity: 1 }]
    }
  ]);

  assert.equal(packages.length, 1);
  assert.equal(packages[0].status, 'completed');
});
