import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeState } from '../lib/runtime/state.js';
import {
  createOpsActivityFeedService,
  activityEventsFromPollReport,
  activityEventFromGetirSync,
  activityEventFromGetirWebhook
} from '../lib/platform/services/ops-activity-feed.js';
import { createOpsSystemModeService } from '../lib/platform/services/ops-system-mode.js';

test('activity feed keeps newest events in ring buffer', () => {
  const runtime = createRuntimeState();
  const feed = createOpsActivityFeedService({ runtime });

  feed.append({ title: 'İlk', kind: 'info' });
  feed.append({ title: 'İkinci', kind: 'poll' });

  assert.equal(runtime.opsActivityEvents.length, 2);
  assert.equal(runtime.opsActivityEvents[0].title, 'İkinci');
});

test('poll report maps to activity events', () => {
  const events = activityEventsFromPollReport({
    ok: true,
    finishedAt: '2026-06-18T10:00:00.000Z',
    channels: {
      getir: { ingested: 2, active: { refreshed: 1 } },
      yemeksepeti: { fetched: 5, ingested: 0 }
    }
  });

  assert.ok(events.length >= 2);
  assert.equal(events[0].kind, 'poll');
  assert.match(events[0].detail, /Getir/);
});

test('getir sync and webhook helpers produce channel events', () => {
  const syncEvent = activityEventFromGetirSync(
    { apiReady: true, ingested: 1, fetched: 3, messages: [] },
    { delivered: false }
  );
  const webhookEvent = activityEventFromGetirWebhook({
    ok: true,
    duplicate: false,
    message: 'Getir sipariş ingest edildi'
  });

  assert.equal(syncEvent.channel, 'getir');
  assert.equal(syncEvent.kind, 'sync');
  assert.equal(webhookEvent.kind, 'webhook');
});

test('system mode summarizes shadow default and poll settings', async () => {
  const runtime = createRuntimeState();
  const opsPollSync = {
    getSettings: async () => ({
      settings: { enabled: true, intervalMinutes: 2 },
      scheduled: true,
      running: false,
      lastRunAt: '2026-06-18T09:00:00.000Z',
      lastRunOk: true,
      lastError: null
    })
  };
  const matchingSync = null;
  const service = createOpsSystemModeService({ runtime, opsPollSync, matchingSync });
  const mode = await service.buildSystemMode();

  assert.equal(mode.ok, true);
  assert.ok(['shadow', 'live'].includes(mode.mode));
  assert.ok(Array.isArray(mode.flags));
  assert.equal(mode.poll.enabled, true);
  assert.equal(mode.systemPagePath, '/hzlmrktops/sistem');
});
