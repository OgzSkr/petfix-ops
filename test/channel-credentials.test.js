import test from 'node:test';
import assert from 'node:assert/strict';
import { getChannelCredentials } from '../lib/channels/credentials.js';
import {
  CHANNEL_CAPABILITY_KEYS,
  CHANNEL_CAPABILITIES,
  getChannelCapabilities,
  channelSupports,
  listChannelCapabilityGaps
} from '../lib/channels/capabilities.js';
import { listActiveChannels, getChannelCapabilities as registryGetCaps } from '../lib/channels/registry.js';

test('getChannelCredentials getir env fallback shape', async () => {
  const cfg = await getChannelCredentials({
    channel: 'getir',
    platformEnv: {
      GETIR_SHOP_ID: 'shop1',
      GETIR_API_USERNAME: 'user1',
      GETIR_API_PASSWORD: 'pass1',
      GETIR_API_BASE_URL: 'https://example.test'
    }
  });
  assert.equal(cfg.shopId, 'shop1');
  assert.equal(cfg.apiUsername, 'user1');
  assert.equal(cfg.apiPassword, 'pass1');
  assert.equal(cfg.apiBaseUrl, 'https://example.test');
  // Ops Hub açıksa DB merge apiEnv döndürebilir; boş env'de tüketici varsayılanı uygular.
  assert.ok(typeof cfg.apiEnv === 'string');
});

test('getChannelCredentials yemeksepeti maps env keys', async () => {
  const cfg = await getChannelCredentials({
    channel: 'yemeksepeti',
    platformEnv: {
      YEMEKSEPETI_CHAIN_ID: 'chain',
      YEMEKSEPETI_VENDOR_ID: 'vendor',
      YEMEKSEPETI_STORE_ID: 'store',
      YEMEKSEPETI_CLIENT_ID: 'cid',
      YEMEKSEPETI_CLIENT_SECRET: 'secret'
    }
  });
  assert.equal(cfg.chainId, 'chain');
  assert.equal(cfg.vendorId, 'vendor');
  assert.equal(cfg.storeId, 'store');
  assert.equal(cfg.clientId, 'cid');
  assert.equal(cfg.clientSecret, 'secret');
});

test('getChannelCredentials uber-eats builds auth token when complete', async () => {
  const cfg = await getChannelCredentials({
    channel: 'uber-eats',
    platformEnv: {
      UBER_EATS_SUPPLIER_ID: 'sup',
      UBER_EATS_API_KEY: 'key',
      UBER_EATS_API_SECRET: 'sec'
    }
  });
  assert.equal(cfg.supplierId, 'sup');
  assert.equal(cfg.channel, 'market');
  assert.equal(cfg.environment, 'PROD');
  assert.equal(cfg.authToken, Buffer.from('key:sec').toString('base64'));
});

test('getChannelCredentials uber-eats empty auth token when placeholder', async () => {
  const cfg = await getChannelCredentials({
    channel: 'uber-eats',
    platformEnv: {
      UBER_EATS_SUPPLIER_ID: 'sup',
      UBER_EATS_API_KEY: 'BURAYA_API_KEY',
      UBER_EATS_API_SECRET: 'BURAYA_SECRET'
    }
  });
  assert.equal(cfg.authToken, '');
});

test('getChannelCredentials unknown channel returns empty object', async () => {
  const cfg = await getChannelCredentials({ channel: 'does-not-exist', platformEnv: {} });
  assert.deepEqual(cfg, {});
});

test('capability matrix defines all keys for every active channel', () => {
  for (const channel of listActiveChannels()) {
    const caps = getChannelCapabilities(channel.id);
    assert.ok(caps, `capabilities tanımlı olmalı: ${channel.id}`);
    for (const key of CHANNEL_CAPABILITY_KEYS) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(caps, key),
        `${channel.id} için ${key} yeteneği açıkça tanımlı olmalı`
      );
    }
  }
});

test('registry re-exports capability accessors consistently', () => {
  assert.deepEqual(registryGetCaps('getir'), CHANNEL_CAPABILITIES.getir);
});

test('capability gaps and support checks', () => {
  assert.equal(channelSupports('getir', 'updateOrderStatus'), false);
  assert.equal(channelSupports('getir', 'syncProducts'), true);
  assert.equal(channelSupports('yemeksepeti', 'updateOrderStatus'), true);
  assert.ok(listChannelCapabilityGaps('getir').includes('updateOrderStatus'));
  assert.deepEqual(listChannelCapabilityGaps('does-not-exist'), []);
  assert.equal(getChannelCapabilities('does-not-exist'), null);
});
