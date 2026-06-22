import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeBranchChannelConfig } from '../lib/ops-hub/domain/branch-channel-config.js';
import {
  buildOpsOrderIdempotencyKey,
  normalizeOpsOrderInput
} from '../lib/ops-hub/domain/ops-order.js';
import { maskCustomerPayload } from '../lib/ops-hub/domain/pii.js';
import { listMigrationFiles } from '../lib/ops-hub/db/migrate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('normalizeBranchChannelConfig accepts trendyol_go credentials', () => {
  const row = normalizeBranchChannelConfig({
    channel: 'trendyol_go',
    integrationMode: 'direct',
    config: {
      sellerId: '862084',
      apiKey: 'key',
      apiSecret: 'secret',
      storeId: '223508',
      autoAcceptOrders: true
    }
  });

  assert.equal(row.channel, 'trendyol_go');
  assert.equal(row.config.storeId, '223508');
  assert.equal(row.config.autoAcceptOrders, true);
});

test('normalizeBranchChannelConfig rejects missing yemeksepeti vendorId', () => {
  assert.throws(
    () =>
      normalizeBranchChannelConfig({
        channel: 'yemeksepeti',
        integrationMode: 'direct',
        config: {
          clientId: 'x',
          clientSecret: 'y',
          chainId: 'z',
          autoAcceptOrders: false
        }
      }),
    /vendorId/
  );
});

test('normalizeOpsOrderInput masks customer PII and validates lines', () => {
  const result = normalizeOpsOrderInput(
    {
      channel: 'trendyol_go',
      externalId: 'pkg-123',
      branchId: 'branch-1',
      customer: {
        name: 'Ahmet Yilmaz',
        phone: '5321234567'
      },
      lines: [
        {
          channelProductId: 'sku-1',
          quantity: 2,
          barcode: '8690001112223',
          matchingStatus: 'matched'
        }
      ]
    },
    { shadowModeDefault: true }
  );

  assert.equal(result.ok, true);
  assert.equal(result.order.customerMasked.name, 'Ahmet Yilmaz');
  assert.match(result.order.customerMasked.phone, /\*/);
  assert.notEqual(result.order.customerMasked.phone, '5321234567');
  assert.equal(result.order.shadowMode, true);
  assert.equal(result.order.lines[0].quantity, 2);
});

test('normalizeOpsOrderInput preserves channel-pre-masked customer names', () => {
  const result = normalizeOpsOrderInput(
    {
      channel: 'trendyol_go',
      externalId: 'pkg-456',
      branchId: 'branch-1',
      customer: {
        name: 'Arzu v.',
        phone: '5321234567'
      },
      lines: [
        {
          channelProductId: 'sku-1',
          quantity: 1,
          barcode: '8690001112223',
          matchingStatus: 'matched'
        }
      ]
    },
    { shadowModeDefault: true }
  );

  assert.equal(result.ok, true);
  assert.equal(result.order.customerMasked.name, 'Arzu v.');
});

test('buildOpsOrderIdempotencyKey is channel scoped', () => {
  const key = buildOpsOrderIdempotencyKey({
    channel: 'yemeksepeti',
    externalId: 'ord-9',
    eventType: 'webhook'
  });
  assert.equal(key, 'yemeksepeti:ord-9:webhook');
});

test('maskCustomerPayload leaves non-PII fields intact', () => {
  const masked = maskCustomerPayload({
    name: 'Test User',
    orderCount: 3,
    meta: { city: 'Istanbul' }
  });
  assert.equal(masked.orderCount, 3);
  assert.equal(masked.meta.city, 'Istanbul');
});

test('maskCustomerPayload preserves channel customer names and masks phone', () => {
  for (const name of ['Arzu v.', 'Berna b.', 'Ahmet Yilmaz', 'Kübra']) {
    const masked = maskCustomerPayload({ name, phone: '5321234567' });
    assert.equal(masked.name, name);
    assert.match(masked.phone, /\*/);
  }
});

test('initial migration defines core ops tables', async () => {
  const files = await listMigrationFiles();
  assert.ok(files.includes('001_initial_schema.sql'));

  const sql = await fs.readFile(
    path.join(__dirname, '../lib/ops-hub/migrations/001_initial_schema.sql'),
    'utf8'
  );

  for (const table of [
    'ops_branches',
    'ops_branch_channel_config',
    'ops_orders',
    'ops_order_lines',
    'ops_shadow_events',
    'ops_outbox',
    'ops_idempotency_keys'
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
});
