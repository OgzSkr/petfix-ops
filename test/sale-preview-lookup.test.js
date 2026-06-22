import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveOrderLineLookupKeys,
  resolveChannelLineForSale
} from '../lib/product-matching/sale-preview.js';
import { MAPPING_STATUS } from '../lib/product-matching/constants.js';

test('resolveOrderLineLookupKeys includes stockCode and name slug', () => {
  const keys = resolveOrderLineLookupKeys({
    barcode: '',
    stockCode: 'GETIR-SKU-99',
    productName: 'Royal Canin Adult 500 g'
  });
  assert.ok(keys.includes('GETIR-SKU-99'));
  assert.ok(keys.some((k) => k.startsWith('order-name-')));
});

test('resolveChannelLineForSale finds mapping by stockCode when barcode empty', () => {
  const db = {
    productMatching: {
      masterProducts: [{
        id: 'm-1',
        name: 'Royal Canin Adult 1 kg',
        benimposBarcode: '2900049',
        buyingPrice: 100,
        stock: 5
      }],
      channelProducts: [{
        id: 'cp-getir-99',
        channelId: 'getir',
        channelProductId: 'GETIR-SKU-99',
        channelBarcode: '',
        channelName: 'Royal Canin Adult Cat Mama'
      }],
      mappings: [{
        id: 'map-1',
        channelId: 'getir',
        channelProductId: 'GETIR-SKU-99',
        masterProductId: 'm-1',
        status: MAPPING_STATUS.MANUAL_CONFIRMED
      }],
      conflicts: []
    }
  };

  const result = resolveChannelLineForSale(db, {
    channelId: 'getir',
    rawLine: {
      barcode: '',
      stockCode: 'GETIR-SKU-99',
      productName: 'Royal Canin Adult Cat Mama'
    }
  });

  assert.equal(result.saleAllowed, true);
  assert.equal(result.master?.id, 'm-1');
  assert.equal(result.saleBarcode, '2900049');
});

test('resolveChannelLineForSale allows manual_confirmed mapping despite out_of_scope internal SKU', () => {
  const db = {
    productMatching: {
      masterProducts: [{
        id: 'mp-7736938',
        name: 'WANPY TEKLİ KEDİ ÖDÜLÜ 14GR',
        benimposBarcode: '7736938',
        buyingPrice: 8,
        stock: 10
      }],
      channelProducts: [{
        id: 'cp-uber-eats-titan307',
        channelId: 'uber-eats',
        channelProductId: 'titan307',
        channelBarcode: 'titan307',
        channelName: 'Bağışıklığı Güçlendirici Sıvı Ödül 14 Gr',
        reviewClassification: 'out_of_scope',
        reviewNote: 'Uber dahili / test SKU kodu — standart EAN değil'
      }],
      mappings: [{
        id: 'map-uber-eats-titan307',
        channelId: 'uber-eats',
        channelProductId: 'titan307',
        channelBarcode: 'titan307',
        masterProductId: 'mp-7736938',
        status: MAPPING_STATUS.MANUAL_CONFIRMED
      }],
      conflicts: []
    }
  };

  const result = resolveChannelLineForSale(db, {
    channelId: 'uber-eats',
    channelBarcode: 'titan307'
  });

  assert.equal(result.saleAllowed, true);
  assert.equal(result.master?.benimposBarcode, '7736938');
  assert.equal(result.blockReason, null);
});
