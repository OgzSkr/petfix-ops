import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isGetirApiConfigComplete,
  resolveGetirApiConfig,
  buildGetirPreparePayload
} from '../lib/channels/getir-api.js';
import { isGetirConfigComplete } from '../lib/ops-hub/integrations/config-bridge.js';
import { findLineOverrideForGetirProduct } from '../lib/ops-hub/channels/getir-normalize.js';

test('resolveGetirApiConfig maps env-style fields', () => {
  const cfg = resolveGetirApiConfig({
    apiBaseUrl: 'https://api.example.getirapi.com',
    apiUsername: 'petfix',
    apiPassword: 'secret',
    shopId: 'shop-1'
  });
  assert.equal(cfg.baseUrl, 'https://api.example.getirapi.com');
  assert.equal(cfg.username, 'petfix');
  assert.equal(cfg.shopId, 'shop-1');
});

test('isGetirConfigComplete requires shop and credentials (base URL defaults)', () => {
  assert.equal(isGetirConfigComplete({ shopId: 'x' }), false);
  assert.equal(isGetirConfigComplete({
    shopId: '6a310a9818ce7da2135a05c9',
    apiUsername: 'petfix',
    apiPassword: 'test',
    apiEnv: 'prod'
  }), true);
  assert.equal(isGetirConfigComplete({
    shopId: '6a310a9818ce7da2135a05c9',
    apiUsername: 'petfix',
    apiPassword: 'test',
    apiBaseUrl: 'https://api.example.getirapi.com'
  }), true);
  assert.equal(isGetirApiConfigComplete({
    shopId: '6a310a9818ce7da2135a05c9',
    username: 'petfix',
    password: 'test',
    baseUrl: 'https://api.example.getirapi.com'
  }), true);
});

test('findLineOverrideForGetirProduct matches by catalog id when array order differs', () => {
  const products = [
    { id: 'line-a', catalogProductId: 'cat-a', count: 1, barcode: '111' },
    { id: 'line-b', catalogProductId: 'cat-b', count: 2, barcode: '222' }
  ];
  const lines = [
    { line_index: 0, channel_product_id: 'cat-b', picked_qty: 2, barcode: '222' },
    { line_index: 1, channel_product_id: 'cat-a', picked_qty: 1, barcode: '111' }
  ];

  assert.equal(
    findLineOverrideForGetirProduct(lines, products[0], 0)?.channel_product_id,
    'cat-a'
  );
  assert.equal(
    findLineOverrideForGetirProduct(lines, products[1], 1)?.picked_qty,
    2
  );
});

test('buildGetirPreparePayload uses picked qty and skips weight for type=count', () => {
  const payload = buildGetirPreparePayload({
    products: [
      {
        id: 'line-1',
        type: 'count',
        count: 2,
        totalWeight: 2200,
        catalogProductId: 'cat-1',
        name: { tr: 'Paket ürün' }
      },
      {
        id: 'line-2',
        type: 'gr',
        count: 1,
        totalWeight: 500,
        catalogProductId: 'cat-2',
        name: { tr: 'Açık mama' }
      }
    ]
  }, {
    lines: [
      { line_index: 0, channel_product_id: 'cat-1', picked_qty: 2 },
      { line_index: 1, channel_product_id: 'cat-2', picked_qty: 1, orderGrams: 500 }
    ]
  });

  assert.deepEqual(payload.updatedProducts, [
    { id: 'line-1', newCount: 2 },
    { id: 'line-2', newCount: 1, newTotalWeight: 500 }
  ]);
});

test('buildGetirPreparePayload prefers picked_qty over remote count', () => {
  const payload = buildGetirPreparePayload({
    products: [{
      id: 'line-dreamies',
      type: 'count',
      count: 2,
      catalogProductId: 'dreamies-1',
      barcode: '5998749130445'
    }]
  }, {
    lines: [{
      line_index: 0,
      channel_product_id: 'dreamies-1',
      barcode: '5998749130445',
      picked_qty: 2,
      quantity: 2
    }]
  });

  assert.equal(payload.updatedProducts[0].newCount, 2);
  assert.equal(payload.updatedProducts[0].newTotalWeight, undefined);
});
