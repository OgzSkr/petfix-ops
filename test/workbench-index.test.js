import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildIndexFromLiteResult,
  filterIndexEntries,
  isWorkbenchIndexFresh,
  summarizeFilteredEntries,
  workbenchDataFingerprint
} from '../lib/product-matching/workbench-index.js';

test('workbench index filters channel and search hay', () => {
  const pm = {
    channelProducts: [{ id: 1 }],
    mappings: [{ id: 1 }],
    masterProducts: [{ id: 1 }],
    meta: { masterSyncedAt: '2026-01-01' }
  };
  const lite = {
    candidates: [
      { cp: { channelId: 'uber-eats', channelProductId: 'a', channelName: 'Foo', channelBarcode: '1', masterProductName: '', mappingStatus: 'pending' } },
      { cp: { channelId: 'getir', channelProductId: 'b', channelName: 'Bar', channelBarcode: '2', masterProductName: '', mappingStatus: 'pending' } }
    ],
    channelCounts: { 'uber-eats': 1, getir: 1 },
    safeConfirmable: 1,
    unmatchedChannelProducts: 2,
    multiCandidate: 0
  };
  const index = buildIndexFromLiteResult(lite, workbenchDataFingerprint(pm));
  assert.equal(isWorkbenchIndexFresh(pm, index), true);
  const filtered = filterIndexEntries(index, { channelFilter: 'uber-eats', q: 'foo' });
  assert.equal(filtered.length, 1);
  assert.equal(summarizeFilteredEntries(filtered).total, 1);
});
