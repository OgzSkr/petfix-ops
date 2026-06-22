import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeMatchingSyncSettings,
  catalogStepsForChannel
} from '../lib/product-matching/matching-sync-schedule.js';

test('normalizeMatchingSyncSettings reads env defaults', () => {
  const settings = normalizeMatchingSyncSettings({}, {
    MATCHING_SYNC_ENABLED: 'true',
    MATCHING_SYNC_INTERVAL_MINUTES: '720'
  });
  assert.equal(settings.enabled, true);
  assert.equal(settings.intervalMinutes, 720);
  assert.ok(settings.channels.includes('uber-eats'));
});

test('catalogStepsForChannel skips uber orders by default', () => {
  assert.deepEqual(
    catalogStepsForChannel('uber-eats'),
    ['master', 'catalog', 'auto-match']
  );
  assert.deepEqual(
    catalogStepsForChannel('uber-eats', { uberIncludeOrders: true }),
    ['master', 'catalog', 'orders', 'auto-match']
  );
});

test('catalogStepsForChannel skips auto-match when matching disabled', () => {
  assert.deepEqual(
    catalogStepsForChannel('yemeksepeti', { matchingEnabled: false }),
    ['master', 'catalog', 'barcode-link']
  );
});
