import test from 'node:test';
import assert from 'node:assert/strict';
import { createChannelControlService } from '../lib/platform/services/channel-control.js';

test('channelControl runAction rejects unknown action', async () => {
  const svc = createChannelControlService({ matchingSync: null, opsPollSync: null });
  await assert.rejects(
    () => svc.runAction('invalid-action'),
    (err) => err.statusCode === 400
  );
});

test('channelControl runAction matching-sync requires service', async () => {
  const svc = createChannelControlService({ matchingSync: null, opsPollSync: null });
  await assert.rejects(
    () => svc.runAction('matching-sync'),
    (err) => err.statusCode === 503
  );
});

test('channelControl buildControlBoard includes ops channels and workers', async () => {
  const matchingSync = {
    getSettings: async () => ({ settings: { enabled: true, intervalMinutes: 60 } })
  };
  const opsPollSync = {
    getSettings: async () => ({
      settings: { enabled: false, intervalMinutes: 2 },
      scheduled: false,
      running: false
    })
  };
  const svc = createChannelControlService({ matchingSync, opsPollSync });
  const board = await svc.buildControlBoard();
  assert.equal(board.ok, true);
  assert.ok(Array.isArray(board.opsChannels));
  assert.ok(board.opsChannels.some((c) => c.registryId === 'getir'));
  assert.ok(board.workers.matchingSync);
  assert.ok(board.workers.opsPoll);
  assert.equal(board.actions.poll.endpoint, '/api/channels/control/actions');
});
