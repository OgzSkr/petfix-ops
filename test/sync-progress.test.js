import test from 'node:test';
import assert from 'node:assert/strict';
import { computeSyncPercent, enrichSyncJobStatus } from '../lib/product-matching/sync-progress.js';

test('computeSyncPercent uses page ratio within slice', () => {
  assert.equal(computeSyncPercent({
    phase: 'fetch',
    page: 5,
    totalPages: 10,
    basePercent: 0,
    slicePercent: 90
  }), 45);
});

test('computeSyncPercent returns explicit percent', () => {
  assert.equal(computeSyncPercent({ percent: 72 }), 72);
});

test('enrichSyncJobStatus exposes percent for running job', () => {
  const status = enrichSyncJobStatus({
    running: true,
    progress: { page: 2, totalPages: 4, basePercent: 0, slicePercent: 90 }
  });
  assert.equal(status.running, true);
  assert.equal(status.percent, 45);
});
