import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMasterChannelPrices,
  filterMastersByChannel,
  isChannelProductOnSale
} from '../lib/product-matching/master-channel-prices.js';

test('buildMasterChannelPrices resolves barcode match without mapping', () => {
  const master = {
    id: 'mp-1',
    benimposBarcode: '7613287487636',
    salePrice1: 100,
    buyingPrice: 57
  };

  const db = {
    products: [],
    productMatching: {
      masterProducts: [master],
      channelProducts: [
        {
          channelId: 'uber-eats',
          channelProductId: '7613287487636',
          channelBarcode: '7613287487636',
          lastUnitPrice: 125,
          catalogOnSale: true
        },
      ],
      mappings: []
    }
  };

  const prices = buildMasterChannelPrices(db, master);
  const uber = prices.find((p) => p.channelId === 'uber-eats');
  const ys = prices.find((p) => p.channelId === 'yemeksepeti');

  assert.equal(uber.channelPrice, 125);
  assert.equal(uber.saleDiffPct, 25);
  assert.equal(uber.barcodeMatchOnly, true);
  assert.equal(ys.channelPrice, null);
  assert.equal(ys.barcodeMatchOnly, false);
});

test('isChannelProductOnSale uses catalog flag and stock fallback', () => {
  assert.equal(isChannelProductOnSale({ onSale: true, channelPrice: 10 }), true);
  assert.equal(isChannelProductOnSale({ onSale: false, channelPrice: 10, channelStock: 5 }), false);
  assert.equal(isChannelProductOnSale({ channelPrice: 10, channelStock: 0 }), false);
  assert.equal(isChannelProductOnSale({ channelPrice: 10, channelStock: 3 }), true);
  assert.equal(isChannelProductOnSale({ channelPrice: 10, channelStock: null }), false);
});

test('buildMasterChannelPrices marks inactive YS products off sale', () => {
  const db = {
    products: [],
    productMatching: {
      masterProducts: [{ id: 'm1', benimposBarcode: '111', salePrice1: 60, buyingPrice: 40, stock: 0 }],
      channelProducts: [{
        channelId: 'yemeksepeti',
        channelProductId: 'YS1',
        channelPrice: 75,
        ysActive: false
      }],
      mappings: [{
        channelId: 'yemeksepeti',
        channelProductId: 'YS1',
        masterProductId: 'm1',
        status: 'manual_confirmed'
      }]
    }
  };
  const prices = buildMasterChannelPrices(db, db.productMatching.masterProducts[0]);
  const ys = prices.find((row) => row.channelId === 'yemeksepeti');
  assert.equal(ys.onSale, false);
  assert.equal(isChannelProductOnSale(ys), false);
});

test('filterMastersByChannel supports linked, sale and missing modes', () => {
  const masters = [
    { id: 'a', benimposBarcode: '111', salePrice1: 100, buyingPrice: 50, stock: 5 },
    { id: 'b', benimposBarcode: '222', salePrice1: 100, buyingPrice: 50, stock: 5 },
    { id: 'c', benimposBarcode: '333', salePrice1: 100, buyingPrice: 50, stock: 5 }
  ];
  const db = {
    products: [],
    productMatching: {
      masterProducts: masters,
      channelProducts: [
        {
          channelId: 'uber-eats',
          channelProductId: '111',
          channelBarcode: '111',
          lastUnitPrice: 125,
          catalogOnSale: true
        },
        {
          channelId: 'uber-eats',
          channelProductId: '222',
          channelBarcode: '222',
          lastUnitPrice: 125,
          catalogOnSale: false,
          catalogQuantity: 0
        }
      ],
      mappings: []
    }
  };

  const linked = filterMastersByChannel(masters, db, { channelFocus: 'uber-eats' });
  assert.deepEqual(linked.map((row) => row.id), ['a', 'b']);

  const onSale = filterMastersByChannel(masters, db, {
    channelFocus: 'uber-eats',
    channelSaleStatus: 'on'
  });
  assert.deepEqual(onSale.map((row) => row.id), ['a']);

  const missing = filterMastersByChannel(masters, db, {
    channelFocus: 'uber-eats',
    channelSaleStatus: 'missing'
  });
  assert.deepEqual(missing.map((row) => row.id), ['c']);
});
