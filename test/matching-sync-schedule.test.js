import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeMatchingSyncSettings,
  DEFAULT_MATCHING_SYNC_CHANNELS
} from '../lib/product-matching/matching-sync-schedule.js';

test('default sync channels include yemeksepeti', () => {
  assert.ok(DEFAULT_MATCHING_SYNC_CHANNELS.includes('yemeksepeti'));
});

test('normalizeMatchingSyncSettings keeps yemeksepeti when requested', () => {
  const settings = normalizeMatchingSyncSettings({
    channels: ['yemeksepeti', 'woocommerce']
  });
  assert.deepEqual(settings.channels, ['yemeksepeti', 'woocommerce']);
});
