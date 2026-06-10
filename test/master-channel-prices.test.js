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
        {
          channelId: 'woocommerce',
          channelProductId: 'FLX1',
          channelBarcode: '7613287487636',
          channelPrice: 100
        }
      ],
      mappings: [{
        id: 'map-wc',
        channelId: 'woocommerce',
        channelProductId: 'FLX1',
        masterProductId: 'mp-1',
        status: 'manual_confirmed'
      }]
    }
  };

  const prices = buildMasterChannelPrices(db, master);
  const uber = prices.find((p) => p.channelId === 'uber-eats');
  const wc = prices.find((p) => p.channelId === 'woocommerce');

  assert.equal(uber.channelPrice, 125);
  assert.equal(uber.saleDiffPct, 25);
  assert.equal(uber.barcodeMatchOnly, true);
  assert.equal(wc.channelPrice, 100);
  assert.equal(wc.saleDiffPct, 0);
  assert.equal(wc.hasConfirmedMapping, true);
});
