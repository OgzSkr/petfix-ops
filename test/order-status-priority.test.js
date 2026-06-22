import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeOpsOrderStatus,
  mergeTgoChannelStatus,
  floorOpsStatusAfterPickingComplete
} from '../lib/ops-hub/domain/order-status-priority.js';

test('mergeOpsOrderStatus never regresses ready to picking', () => {
  assert.equal(mergeOpsOrderStatus('ready', 'picking'), 'ready');
  assert.equal(mergeOpsOrderStatus('picking', 'ready'), 'ready');
  assert.equal(mergeOpsOrderStatus('picked', 'picking'), 'picked');
});

test('mergeTgoChannelStatus keeps Picked over poll Picking lag', () => {
  assert.equal(mergeTgoChannelStatus('Picked', 'Picking'), 'Picked');
  assert.equal(mergeTgoChannelStatus('Picking', 'Invoiced'), 'Invoiced');
});

test('floorOpsStatusAfterPickingComplete blocks poll regression', () => {
  const doneAt = new Date().toISOString();
  assert.equal(floorOpsStatusAfterPickingComplete('picking', doneAt), 'picked');
  assert.equal(floorOpsStatusAfterPickingComplete('ready', doneAt), 'ready');
});
