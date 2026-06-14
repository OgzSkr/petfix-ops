import test from 'node:test';
import assert from 'node:assert/strict';
import { settlementsToOrderPackages } from '../lib/channels/uber-eats-orders.js';
import { analyzeOrderPackages, buildChannelProductTitleByBarcode, buildProductTitleByBarcode } from '../lib/order-profitability.js';
import { ensureProductMatching } from '../lib/product-matching/schema.js';

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
  assert.equal(pkg.lines.length, 1);
  assert.equal(pkg.lines[0].quantity, 6);
  assert.equal(pkg.packageGrossAmount, 750);
  assert.equal(pkg.packageTotalDiscount, 75);
  assert.equal(pkg.lines[0].lineGrossAmount, 750);
  assert.equal(pkg.lines[0].lineSellerDiscount, 75);
  assert.ok(Math.abs(pkg.lines[0].commissionAmount - 195.96) < 0.1);
});

test('analyzeOrderPackages replaces generic Satış line names from catalog/master', () => {
  const barcode = '8680589182803';
  const db = { products: [] };
  ensureProductMatching(db);
  db.productMatching.channelProducts.push({
    channelId: 'uber-eats',
    channelProductId: barcode,
    channelBarcode: barcode,
    channelName: 'Felix Party Mix Karışık 60 Gr',
    uberBrand: 'Felix'
  });
  db.productMatching.masterProducts.push({
    id: 'mp-1',
    benimposBarcode: barcode,
    name: 'Felix Party Mix 60g'
  });

  const titles = buildProductTitleByBarcode(db);
  assert.equal(titles[barcode], 'Felix Party Mix Karışık 60 Gr');

  const packages = settlementsToOrderPackages([{
    orderNumber: '11320477240',
    barcode,
    credit: 125,
    commissionRate: 20,
    commissionAmount: 25,
    description: 'Satış',
    transactionDate: Date.now()
  }], []);

  const rows = analyzeOrderPackages(packages, db, {
    channelId: 'uber-eats',
    productMatchingMode: 'legacy',
    costScope: 'uber-eats'
  });

  assert.equal(rows[0].lines[0].productName, 'Felix Party Mix Karışık 60 Gr');
  assert.notEqual(rows[0].lines[0].productName.toLowerCase(), 'satış');
});

test('analyzeOrderPackages does not use master or other-channel names for order lines', () => {
  const barcode = '8680589182803';
  const db = { products: [] };
  ensureProductMatching(db);
  db.productMatching.channelProducts.push({
    channelId: 'uber-eats',
    channelProductId: barcode,
    channelBarcode: barcode,
    channelName: 'Satış',
    uberBrand: 'Felix'
  });
  db.productMatching.channelProducts.push({
    channelId: 'yemeksepeti',
    channelProductId: 'YS-1',
    channelBarcode: barcode,
    channelName: 'Yanlış YS adı'
  });
  db.productMatching.masterProducts.push({
    id: 'mp-1',
    benimposBarcode: barcode,
    name: 'Felix Party Mix 60g'
  });

  const packages = settlementsToOrderPackages([{
    orderNumber: '11320477240',
    barcode,
    credit: 125,
    description: 'Satış',
    transactionDate: Date.now()
  }], []);

  const rows = analyzeOrderPackages(packages, db, {
    channelId: 'uber-eats',
    productMatchingMode: 'legacy',
    costScope: 'other-channels'
  });

  assert.equal(rows[0].lines[0].productName, '—');
  assert.notEqual(rows[0].lines[0].productName, 'Yanlış YS adı');
  assert.notEqual(rows[0].lines[0].productName, 'Felix Party Mix 60g');
});

test('buildChannelProductTitleByBarcode ignores other channels on same barcode', () => {
  const barcode = '07613036508032';
  const db = { products: [] };
  ensureProductMatching(db);
  db.productMatching.channelProducts.push(
    {
      channelId: 'uber-eats',
      channelBarcode: barcode,
      channelName: 'Açık Purina Pro Plan Tavuklu Yetişkin Kedi Maması 500 gr'
    },
    {
      channelId: 'yemeksepeti',
      channelBarcode: barcode,
      channelName: 'Purina Pro Plan Renal Plus Tavuk Etli Yetişkin Kedi Maması 10 kg'
    }
  );

  assert.equal(
    buildChannelProductTitleByBarcode(db, 'uber-eats')[barcode],
    'Açık Purina Pro Plan Tavuklu Yetişkin Kedi Maması 500 gr'
  );
  assert.equal(
    buildProductTitleByBarcode(db)[barcode],
    'Purina Pro Plan Renal Plus Tavuk Etli Yetişkin Kedi Maması 10 kg'
  );
});
