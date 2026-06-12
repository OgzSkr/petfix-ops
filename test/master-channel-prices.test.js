import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMasterChannelPrices } from '../lib/product-matching/master-channel-prices.js';

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
