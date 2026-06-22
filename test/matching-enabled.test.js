import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isProductMatchingEnabled,
  effectiveProductMatchingMode
} from '../lib/product-matching/matching-enabled.js';

test('legacy mode disables product matching', () => {
  assert.equal(isProductMatchingEnabled({ PRODUCT_MATCHING_MODE: 'legacy' }), false);
  assert.equal(
    effectiveProductMatchingMode({ PRODUCT_MATCHING_MODE: 'hybrid', PRODUCT_MATCHING_ENABLED: 'true' }),
    'hybrid'
  );
  assert.equal(effectiveProductMatchingMode({ PRODUCT_MATCHING_MODE: 'legacy' }), 'legacy');
});

test('PRODUCT_MATCHING_ENABLED=false overrides hybrid mode', () => {
  assert.equal(
    isProductMatchingEnabled({
      PRODUCT_MATCHING_MODE: 'hybrid',
      PRODUCT_MATCHING_ENABLED: 'false'
    }),
    false
  );
  assert.equal(
    effectiveProductMatchingMode({
      PRODUCT_MATCHING_MODE: 'strict',
      PRODUCT_MATCHING_ENABLED: 'false'
    }),
    'legacy'
  );
});
