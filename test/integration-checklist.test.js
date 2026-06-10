import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureProductMatching } from '../lib/product-matching/schema.js';
import { buildYemeksepetiSetupChecklist, buildTrendyolGoSetupChecklist, buildGetirSetupChecklist } from '../lib/ops-hub/integrations/integration-checklist.js';

test('buildYemeksepetiSetupChecklist reports credential and catalog steps', async () => {
  const db = { products: [] };
  ensureProductMatching(db);
  db.productMatching.channelProducts.push({
    channelId: 'yemeksepeti',
    channelProductId: 'ys-1',
    channelBarcode: '111',
    channelName: 'Test'
  });
  db.productMatching.meta.channelIngest = {
    yemeksepeti: { ingestedAt: '2026-06-10T12:00:00.000Z' }
  };

  const checklist = await buildYemeksepetiSetupChecklist({
    config: {
      clientId: 'petfix',
      clientSecret: 'secret',
      vendorId: 'jk2w',
      chainId: 'chain-1',
      webhookSecret: 'abc123'
    },
    configMeta: { lastTestOk: true, lastTestMessage: 'OAuth OK' },
    platformEnv: {
      YEMEKSEPETI_WEBHOOK_SECRET: 'abc123',
      PUBLIC_API_BASE_URL: 'https://api.petfix.com.tr'
    },
    db
  });

  assert.equal(checklist.channelId, 'yemeksepeti');
  assert.ok(checklist.items.find((i) => i.id === 'credentials')?.status === 'done');
  assert.ok(checklist.items.find((i) => i.id === 'catalog')?.status === 'done');
  const webhook = checklist.items.find((i) => i.id === 'webhook_portal');
  assert.ok(webhook?.copyValue?.startsWith('Basic '));
  assert.match(webhook?.copyValue2 || '', /yemeksepeti\/orders/);
});

test('buildTrendyolGoSetupChecklist reports TGO credentials and matching', async () => {
  const db = { products: [] };
  ensureProductMatching(db);
  db.productMatching.channelProducts.push({
    channelId: 'uber-eats',
    channelProductId: 'ue-1',
    channelBarcode: '111',
    channelName: 'Test'
  });

  const checklist = await buildTrendyolGoSetupChecklist({
    config: {
      sellerId: '862084',
      apiKey: 'key',
      apiSecret: 'secret',
      storeId: '223508'
    },
    configMeta: { lastTestOk: true },
    platformEnv: {},
    db
  });

  assert.equal(checklist.channelId, 'trendyol_go');
  assert.equal(checklist.items.find((i) => i.id === 'credentials')?.status, 'done');
  assert.equal(checklist.items.find((i) => i.id === 'stock_push')?.status, 'warn');
});

test('buildGetirSetupChecklist reports whitelist and webhook URL', async () => {
  const checklist = await buildGetirSetupChecklist({
    config: { shopId: 'shop-99' },
    configMeta: { lastTestOk: false, lastTestMessage: 'Shadow mode' },
    platformEnv: { PUBLIC_API_BASE_URL: 'https://api.petfix.com.tr' }
  });

  assert.equal(checklist.channelId, 'getir');
  assert.equal(checklist.items.find((i) => i.id === 'shop_id')?.status, 'done');
  assert.equal(checklist.items.find((i) => i.id === 'whitelist')?.status, 'pending');
  const webhook = checklist.items.find((i) => i.id === 'webhook_portal');
  assert.match(webhook?.copyValue || '', /getir\/orders/);
});
