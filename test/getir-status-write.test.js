import test from 'node:test';
import assert from 'node:assert/strict';

test('writeGetirChannelStatus rejects unknown action', async () => {
  const { writeGetirChannelStatus } = await import('../lib/ops-hub/channels/getir-status-write.js');
  await assert.rejects(
    () => writeGetirChannelStatus('cancel', { external_id: 'ord-1' }, [], {}),
    /desteklenmeyen action/i
  );
});

test('writeGetirOrderDelivered requires external_id', async () => {
  const { writeGetirOrderDelivered } = await import('../lib/ops-hub/channels/getir-status-write.js');
  await assert.rejects(
    () => writeGetirOrderDelivered({ external_id: '' }, {}),
    /external_id eksik/i
  );
});
