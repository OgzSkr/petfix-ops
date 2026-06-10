import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldRunAutoAccept } from '../lib/ops-hub/automation/post-ingest.js';

test('shouldRunAutoAccept runs for received orders when enabled', () => {
  const decision = shouldRunAutoAccept({
    order: { status: 'received' },
    branchConfig: { enabled: true, autoAcceptOrders: true }
  });
  assert.equal(decision.run, true);
});

test('shouldRunAutoAccept skips when auto accept disabled', () => {
  const decision = shouldRunAutoAccept({
    order: { status: 'received' },
    branchConfig: { enabled: true, autoAcceptOrders: false }
  });
  assert.equal(decision.run, false);
  assert.equal(decision.reason, 'auto_accept_off');
});

test('shouldRunAutoAccept skips non-received status', () => {
  const decision = shouldRunAutoAccept({
    order: { status: 'picking' },
    branchConfig: { enabled: true, autoAcceptOrders: true }
  });
  assert.equal(decision.run, false);
});

test('shouldRunAutoAccept skips disabled channel', () => {
  const decision = shouldRunAutoAccept({
    order: { status: 'received' },
    branchConfig: { enabled: false, autoAcceptOrders: true }
  });
  assert.equal(decision.run, false);
  assert.equal(decision.reason, 'channel_disabled');
});
