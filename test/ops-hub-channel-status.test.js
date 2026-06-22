import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildChannelStatusSimulation,
  isChannelStatusWriteEnabled,
  resolveNextChannelStatus
} from '../lib/ops-hub/channel/channel-status-service.js';
import { resolveYsReadyStatus } from '../lib/ops-hub/channels/yemeksepeti-status-write.js';

test('resolveYsReadyStatus maps delivery modes', () => {
  assert.equal(resolveYsReadyStatus('platform_courier'), 'READY_FOR_PICKUP');
  assert.equal(resolveYsReadyStatus('own_courier'), 'DISPATCHED');
});

test('buildChannelStatusSimulation marks dry run', () => {
  const sim = buildChannelStatusSimulation(
    {
      channel: 'trendyol_go',
      external_id: 'pkg-1',
      delivery_mode: 'platform_courier',
      shadow_mode: true
    },
    'ready'
  );
  assert.equal(sim.dryRun, true);
  assert.equal(sim.action, 'ready');
});

test('resolveNextChannelStatus maps Getir lifecycle', () => {
  assert.equal(resolveNextChannelStatus({ channel: 'getir' }, 'accept'), '550');
  assert.equal(
    resolveNextChannelStatus({ channel: 'getir', delivery_mode: 'own_courier' }, 'ready'),
    '600'
  );
  assert.equal(
    resolveNextChannelStatus({ channel: 'getir', delivery_mode: 'platform_courier' }, 'ready'),
    '700'
  );
});

test('isChannelStatusWriteEnabled reads env flag', () => {
  assert.equal(
    isChannelStatusWriteEnabled({ FF_CHANNEL_STATUS_WRITE: 'false' }),
    false
  );
  assert.equal(
    isChannelStatusWriteEnabled({ FF_CHANNEL_STATUS_WRITE: 'true' }),
    true
  );
});
