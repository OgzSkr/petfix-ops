import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOrdersQueryCacheKey } from '../lib/platform/services/orders-query-cache.js';

function params(values = {}) {
  return new URLSearchParams(values);
}

test('buildOrdersQueryCacheKey separates day ranges', () => {
  assert.equal(buildOrdersQueryCacheKey(params({ days: '1' })), 'days:1');
  assert.equal(buildOrdersQueryCacheKey(params({ days: '14' })), 'days:14');
  assert.notEqual(
    buildOrdersQueryCacheKey(params({ days: '1' })),
    buildOrdersQueryCacheKey(params({ days: '14' }))
  );
});

test('buildOrdersQueryCacheKey separates custom ranges', () => {
  assert.equal(
    buildOrdersQueryCacheKey(params({ startDate: '2026-05-01', endDate: '2026-05-07' })),
    'custom:2026-05-01:2026-05-07'
  );
});
