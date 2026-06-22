import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applySecretPreservation,
  branchConfigToTgoCfg,
  branchConfigToYsCfg,
  envFallbackForChannel,
  isTgoConfigComplete,
  isYsConfigComplete,
  maskChannelConfigSecrets,
  MASKED_SECRET,
  mergeChannelConfig
} from '../lib/ops-hub/integrations/config-bridge.js';
import {
  buildWebhookPanel,
  ensureWebhookSecret,
  listIntegrations
} from '../lib/ops-hub/integrations/integration-service.js';
import { getIntegrationChannelMeta, listIntegrationChannelMeta } from '../lib/ops-hub/integrations/channel-guides.js';

test('envFallbackForChannel maps TGO env keys', () => {
  const cfg = envFallbackForChannel('trendyol_go', {
    UBER_EATS_SUPPLIER_ID: '862084',
    UBER_EATS_API_KEY: 'key',
    UBER_EATS_API_SECRET: 'secret',
    UBER_EATS_STORE_ID: '223508'
  });
  assert.equal(cfg.sellerId, '862084');
  assert.equal(cfg.storeId, '223508');
});

test('branchConfigToTgoCfg maps sellerId to supplierId', () => {
  const cfg = branchConfigToTgoCfg({ sellerId: '1', apiKey: 'k', apiSecret: 's', storeId: '9' });
  assert.equal(cfg.supplierId, '1');
  assert.ok(cfg.authToken);
  assert.equal(isTgoConfigComplete(cfg), true);
});

test('maskChannelConfigSecrets hides secrets', () => {
  const masked = maskChannelConfigSecrets({ apiKey: 'abc', sellerId: '1' });
  assert.equal(masked.apiKey, MASKED_SECRET);
  assert.equal(masked.sellerId, '1');
});

test('applySecretPreservation keeps existing secret when masked', () => {
  const merged = applySecretPreservation(
    { apiSecret: MASKED_SECRET, sellerId: '99' },
    { apiSecret: 'real-secret', sellerId: '1' }
  );
  assert.equal(merged.apiSecret, 'real-secret');
  assert.equal(merged.sellerId, '99');
});

test('buildWebhookPanel uses public API base with branch slug', () => {
  const panel = buildWebhookPanel({ OPS_PUBLIC_API_BASE_URL: 'https://api.petfix.com.tr' }, { branchSlug: 'main' });
  assert.equal(
    panel.endpoints.yemeksepetiOrders,
    'https://api.petfix.com.tr/webhooks/v1/branches/main/yemeksepeti/orders'
  );
  assert.ok(panel.legacyEndpoints?.yemeksepetiOrders);
});

test('ensureWebhookSecret generates secret when missing', () => {
  const next = ensureWebhookSecret({ chainId: 'x' });
  assert.ok(next.webhookSecret);
  assert.ok(next.webhookSecret.length >= 16);
});

test('listIntegrationChannelMeta includes all ops channels', () => {
  const channels = listIntegrationChannelMeta().map((row) => row.id);
  assert.deepEqual(channels.sort(), ['getir', 'trendyol_go', 'yemeksepeti']);
});

test('getIntegrationChannelMeta exposes YS guide steps', () => {
  const meta = getIntegrationChannelMeta('yemeksepeti');
  assert.ok(meta.steps.length >= 4);
  assert.equal(isYsConfigComplete(branchConfigToYsCfg({ clientId: 'a', clientSecret: 'b', vendorId: 'c', chainId: 'd' })), true);
});

test('listIntegrations returns env fallback cards without DB', async () => {
  const data = await listIntegrations(null, {
    platformEnv: {
      YEMEKSEPETI_CLIENT_ID: 'client',
      YEMEKSEPETI_CLIENT_SECRET: 'secret',
      YEMEKSEPETI_VENDOR_ID: 'v',
      YEMEKSEPETI_CHAIN_ID: 'c'
    }
  });
  assert.equal(data.integrations.length, 3);
  const ys = data.integrations.find((row) => row.channel === 'yemeksepeti');
  assert.equal(ys.status, 'ready');
  assert.equal(ys.config.clientId, 'client');
  assert.equal(ys.config.clientSecret, MASKED_SECRET);
});

test('mergeChannelConfig prefers stored values over env', () => {
  const merged = mergeChannelConfig(
    'trendyol_go',
    { sellerId: 'stored' },
    { sellerId: 'env', storeId: '1' }
  );
  assert.equal(merged.sellerId, 'stored');
  assert.equal(merged.storeId, '1');
});
