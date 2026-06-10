import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReadinessReport } from '../lib/production/readiness.js';

test('readiness fails when database unreachable', async () => {
  const pool = {
    query: async () => {
      throw new Error('connection refused');
    }
  };
  const report = await buildReadinessReport(pool, { NODE_ENV: 'development', OPS_POSTGRES_URL: 'x' });
  assert.equal(report.database, 'fail');
  assert.equal(report.status, 'not_ready');
});

test('readiness ok shape without secrets', async () => {
  const pool = {
    query: async (sql) => {
      if (/SELECT 1/.test(sql)) {
        return { rows: [{ ok: 1 }] };
      }
      if (/SELECT version FROM ops_schema_migrations/.test(sql)) {
        return {
          rows: [
            { version: 1 },
            { version: 2 },
            { version: 3 },
            { version: 4 }
          ]
        };
      }
      if (/CREATE TABLE IF NOT EXISTS ops_schema_migrations/.test(sql)) {
        return { rows: [] };
      }
      return { rows: [] };
    }
  };

  const report = await buildReadinessReport(pool, {
    NODE_ENV: 'development',
    OPS_POSTGRES_URL: 'postgresql://localhost/db',
    OPS_HUB_ENABLED: 'true'
  });

  assert.equal(report.database, 'ok');
  assert.equal(report.environment, 'development');
  assert.ok(!JSON.stringify(report).includes('postgresql://'));
});
