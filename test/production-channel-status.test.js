import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProductionChannelStatus } from '../lib/platform/services/production-channel-status.js';

test('buildProductionChannelStatus uses aliased created_at in sync query', async () => {
  const queries = [];
  const pool = {
    query: async (sql) => {
      queries.push(sql);
      if (sql.includes('ops_outbox')) {
        return { rows: [{ pending: 0 }] };
      }
      return { rows: [{}] };
    }
  };

  const env = {
    NODE_ENV: 'test',
    YEMEKSEPETI_CLIENT_ID: 'client',
    YEMEKSEPETI_CLIENT_SECRET: 'secret'
  };

  await buildProductionChannelStatus(pool, env);

  const syncQuery = queries.find((sql) => sql.includes('ops_shadow_events'));
  assert.ok(syncQuery, 'sync query should run for configured channel');
  assert.match(syncQuery, /se\.created_at/);
  assert.doesNotMatch(syncQuery, /MAX\(created_at\)/);
});

test('buildProductionChannelStatus returns not_configured without credentials', async () => {
  const result = await buildProductionChannelStatus(null, { NODE_ENV: 'test' });
  assert.ok(Array.isArray(result.channels));
  assert.equal(result.channels.every((row) => row.state === 'not_configured'), true);
});
