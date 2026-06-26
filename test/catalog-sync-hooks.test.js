import test from 'node:test';
import assert from 'node:assert/strict';
import {
  registerYemeksepetiCatalogSyncHandler,
  triggerYemeksepetiCatalogSync
} from '../lib/runtime/catalog-sync-hooks.js';

test('triggerYemeksepetiCatalogSync debounces repeated webhook calls', async () => {
  let calls = 0;
  registerYemeksepetiCatalogSyncHandler(async () => {
    calls += 1;
    return { ok: true };
  });

  const first = await triggerYemeksepetiCatalogSync('webhook');
  const second = await triggerYemeksepetiCatalogSync('webhook');

  assert.equal(first.skipped, false);
  assert.equal(second.skipped, true);
  assert.equal(second.reason, 'debounced');
  assert.equal(calls, 1);
});
