import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractYemeksepetiOrderItems,
  extractYemeksepetiOrderPayload,
  mapYemeksepetiDeliveryMode,
  mapYemeksepetiOrderStatus,
  normalizeYemeksepetiWebhookOrder
} from '../lib/ops-hub/channels/yemeksepeti-normalize.js';
import {
  extractBearerToken,
  verifyWebhookSecret
} from '../lib/ops-hub/webhooks/webhook-auth.js';
import { YS_WEBHOOK_ORDER_FIXTURE } from '../lib/ops-hub/fixtures/yemeksepeti-webhook.fixture.js';

test('extractYemeksepetiOrderPayload unwraps order envelope', () => {
  const payload = extractYemeksepetiOrderPayload(YS_WEBHOOK_ORDER_FIXTURE);
  assert.equal(payload.order_id, 'ys-wh-9001');
});

test('extractYemeksepetiOrderItems reads products alias', () => {
  const items = extractYemeksepetiOrderItems({
    products: [{ sku: 'A1', name: 'Urun', pricing: { quantity: 1, unit_price: 10 } }]
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].sku, 'A1');
});

test('mapYemeksepetiOrderStatus maps RECEIVED to received', () => {
  assert.equal(mapYemeksepetiOrderStatus('RECEIVED'), 'received');
  assert.equal(mapYemeksepetiOrderStatus('CANCELLED'), 'cancelled');
});

test('mapYemeksepetiDeliveryMode detects platform courier', () => {
  assert.equal(
    mapYemeksepetiDeliveryMode({ delivery: { provider: 'platform_courier' } }),
    'platform_courier'
  );
});

test('normalizeYemeksepetiWebhookOrder builds ops order lines', async () => {
  const raw = extractYemeksepetiOrderPayload(YS_WEBHOOK_ORDER_FIXTURE);
  const result = await normalizeYemeksepetiWebhookOrder(raw, {
    db: {
      productMatching: {
        masterProducts: [],
        channelProducts: [],
        mappings: []
      }
    },
    platformEnv: { PRODUCT_MATCHING_MODE: 'strict' },
    shadowMode: true
  });

  assert.equal(result.ok, true);
  assert.equal(result.order.channel, 'yemeksepeti');
  assert.equal(result.order.externalId, 'ys-wh-9001');
  assert.equal(result.order.lines.length, 1);
  assert.equal(result.order.lines[0].channelProductId, '2662ZF');
  assert.equal(result.order.lines[0].matchingStatus, 'blocked');
});

test('extractBearerToken parses Authorization header', () => {
  assert.equal(extractBearerToken('Bearer abc123'), 'abc123');
  assert.equal(extractBearerToken('Basic xyz'), '');
});

test('verifyWebhookSecret uses timing-safe compare', () => {
  assert.equal(verifyWebhookSecret('secret-a', 'secret-a'), true);
  assert.equal(verifyWebhookSecret('secret-a', 'secret-b'), false);
  assert.equal(verifyWebhookSecret('', 'secret-b'), false);
});
