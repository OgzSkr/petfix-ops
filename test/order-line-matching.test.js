import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeOrderPackages } from '../lib/order-profitability.js';
import { MAPPING_STATUS } from '../lib/product-matching/constants.js';
import { syncChannelProductsFromOrderPackages } from '../lib/product-matching/ensure-channel-product.js';
import { resolveChannelLineForOrder } from '../lib/product-matching/resolve.js';

function sampleDb() {
  return {
    products: [],
    productMatching: {
      masterProducts: [{
        id: 'm-rc-1kg',
        name: 'Royal Canin Açık Kısırlaştırılmış Kedi Maması 1 kg',
        benimposBarcode: '2900052',
        buyingPrice: 100,
        stock: 5
      }],
      channelProducts: [{
        id: 'cp-tgo-rc',
        channelId: 'uber-eats',
        channelProductId: 'seller-sku-rc-open',
        channelBarcode: '07613036508032',
        channelName: 'Royal Canin Açık Kısırlaştırılmış Kedi Maması'
      }],
      mappings: [{
        id: 'map-tgo-rc',
        channelId: 'uber-eats',
        channelProductId: 'seller-sku-rc-open',
        channelBarcode: '07613036508032',
        masterProductId: 'm-rc-1kg',
        status: MAPPING_STATUS.MANUAL_CONFIRMED
      }],
      conflicts: [],
      meta: {}
    }
  };
}

test('resolveChannelLineForOrder finds mapping by stockCode when barcode differs', () => {
  const db = sampleDb();
  const resolved = resolveChannelLineForOrder(db, {
    channelId: 'uber-eats',
    mode: 'hybrid',
    rawLine: {
      barcode: '9999999999999',
      stockCode: 'seller-sku-rc-open',
      productName: 'Royal Canin Açık Kısırlaştırılmış Kedi Maması · 1000 g'
    }
  });

  assert.equal(resolved.source, 'mapping');
  assert.equal(resolved.mappingStatus, MAPPING_STATUS.MANUAL_CONFIRMED);
  assert.equal(resolved.master?.id, 'm-rc-1kg');
});

test('analyzeOrderPackages uses stockCode for matching resolution', () => {
  const db = sampleDb();
  const rows = analyzeOrderPackages([{
    orderNumber: 'n212',
    orderDate: Date.now(),
    status: 'Yeni',
    lines: [{
      barcode: '9999999999999',
      stockCode: 'seller-sku-rc-open',
      productName: 'Royal Canin Açık Kısırlaştırılmış Kedi Maması · 1000 g',
      quantity: 1,
      lineUnitPrice: 300
    }]
  }], db, {
    channelId: 'uber-eats',
    productMatchingMode: 'hybrid',
    costScope: 'uber-eats'
  });

  assert.equal(rows[0].lines[0].mappingSource, 'mapping');
  assert.equal(rows[0].lines[0].mappingStatus, MAPPING_STATUS.MANUAL_CONFIRMED);
  assert.equal(rows[0].lines[0].masterBarcode, '2900052');
});

test('syncChannelProductsFromOrderPackages adds missing order-only products', () => {
  const db = {
    products: [],
    productMatching: {
      masterProducts: [],
      channelProducts: [],
      mappings: [],
      conflicts: [],
      meta: {}
    }
  };

  const { created } = syncChannelProductsFromOrderPackages(db, [{
    lines: [{
      barcode: '',
      stockCode: 'new-open-sku',
      productName: 'Royal Canin Açık Kısırlaştırılmış Kedi Maması · 1000 g',
      quantity: 1
    }]
  }], 'uber-eats');

  assert.equal(created, 1);
  assert.equal(db.productMatching.channelProducts.length, 1);
  assert.equal(db.productMatching.channelProducts[0].channelProductId, 'new-open-sku');
  assert.equal(db.productMatching.channelProducts[0].ingestSource, 'order_line');
  assert.equal(db.productMatching.channelProducts[0].mappingStatus, undefined);
});
