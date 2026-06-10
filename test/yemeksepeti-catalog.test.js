import test from 'node:test';
import assert from 'node:assert/strict';
import { mapYemeksepetiCatalogProduct } from '../lib/product-matching/channel-ingest/yemeksepeti.js';
import { catalogChannelOpsConfig } from '../lib/product-matching/matching-queue.js';
import { getChannel } from '../lib/channels/registry.js';

test('mapYemeksepetiCatalogProduct maps SKU and barcode', () => {
  const mapped = mapYemeksepetiCatalogProduct({
    remoteProductId: '50653895',
    sku: '2662ZF',
    barcode: '06927749871378',
    title: 'Wanpy Krema Kedi Ödülü',
    price: 613,
    active: true
  });

  assert.ok(mapped);
  assert.equal(mapped.channelId, 'yemeksepeti');
  assert.equal(mapped.channelProductId, '2662ZF');
  assert.equal(mapped.channelBarcode, '06927749871378');
  assert.equal(mapped.channelName, 'Wanpy Krema Kedi Ödülü');
  assert.equal(mapped.ysRemoteProductId, '50653895');
});

test('mapYemeksepetiCatalogProduct falls back to remote id without SKU', () => {
  const mapped = mapYemeksepetiCatalogProduct({
    remoteProductId: '999',
    sku: '',
    barcode: '8690001112223',
    title: 'Test ürün',
    price: null,
    active: false
  });

  assert.ok(mapped);
  assert.equal(mapped.channelProductId, '999');
  assert.equal(mapped.ysActive, false);
});

test('catalogChannelOpsConfig exposes yemeksepeti', () => {
  const channel = getChannel('yemeksepeti');
  assert.equal(channel.status, 'active');
  const ops = catalogChannelOpsConfig('yemeksepeti');
  assert.ok(ops);
  assert.deepEqual(ops.steps, ['master', 'catalog', 'auto-match']);
});
