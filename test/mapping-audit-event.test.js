import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureProductMatching } from '../lib/product-matching/schema.js';
import {
  appendMappingLog,
  MAPPING_AUDIT_EVENT_FIELDS,
  normalizeMappingAuditEvent
} from '../lib/product-matching/store.js';

test('normalizeMappingAuditEvent maps legacy aliases to standard fields', () => {
  const event = normalizeMappingAuditEvent({
    type: 'manual_confirm',
    user: 'operator',
    previous: { status: 'auto_matched' },
    next: { status: 'manual_confirmed' },
    channelId: 'uber-eats',
    channelProductId: 'cp-1',
    masterProductId: 'mp-1',
    requestId: 'req-1'
  });

  assert.deepEqual(
    MAPPING_AUDIT_EVENT_FIELDS.map((field) => event[field]),
    [
      'manual_confirm',
      'operator',
      { status: 'auto_matched' },
      { status: 'manual_confirmed' },
      'uber-eats',
      'cp-1',
      'mp-1',
      'req-1'
    ]
  );
});

test('appendMappingLog stores normalized audit fields', () => {
  const db = {};
  ensureProductMatching(db);
  appendMappingLog(db, {
    action: 'confirm',
    actor: 'panel',
    channelId: 'yemeksepeti',
    channelProductId: 'ys-99',
    masterProductId: 'mp-99'
  });

  const entry = db.productMatching.mappingLogs[0];
  assert.equal(entry.action, 'confirm');
  assert.equal(entry.actor, 'panel');
  assert.equal(entry.channelId, 'yemeksepeti');
  assert.equal(entry.channelProductId, 'ys-99');
  assert.equal(entry.masterProductId, 'mp-99');
});
