import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDuplicateChannelMappings } from '../lib/product-matching/duplicate-channel-mappings.js';

test('analyzeDuplicateChannelMappings flags non-barcode mapping when exact barcode exists', () => {
  const result = analyzeDuplicateChannelMappings([
    {
      channelId: 'uber-eats',
      channelProductId: '7613033564642',
      channelBarcode: '7613033564642',
      channelName: 'Kısır Kedi 400 Gr',
      status: 'manual_confirmed',
      channelSalePrice: 375
    },
    {
      channelId: 'uber-eats',
      channelProductId: 'atlas18',
      channelBarcode: 'atlas18',
      channelName: 'Açık Pro Plan Somon',
      status: 'manual_confirmed',
      channelSalePrice: 599.99
    }
  ], '7613033564642');

  assert.equal(result.hasDuplicates, true);
  assert.equal(result.extraMappingCount, 1);
  assert.equal(result.byChannel.length, 1);
  assert.equal(result.byChannel[0].channelId, 'uber-eats');
  assert.equal(result.byChannel[0].likelyWrong.length, 1);
  assert.equal(result.byChannel[0].likelyWrong[0].channelProductId, 'atlas18');
});

test('analyzeDuplicateChannelMappings ignores single mapping per channel', () => {
  const result = analyzeDuplicateChannelMappings([
    {
      channelId: 'getir',
      channelProductId: 'abc',
      channelBarcode: '7613033564642',
      status: 'manual_confirmed'
    }
  ], '7613033564642');

  assert.equal(result.hasDuplicates, false);
  assert.equal(result.extraMappingCount, 0);
});
