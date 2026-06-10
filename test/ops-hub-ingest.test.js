import test from 'node:test';
import assert from 'node:assert/strict';
import { readEnvFile } from '../lib/env.js';
import { paths } from '../lib/config.js';
import { resolveOpsHubConfig } from '../lib/ops-hub/config.js';
import { createOpsPool, closeOpsPool, applyOpsMigrations } from '../lib/ops-hub/db/migrate.js';
import { ingestOpsOrder } from '../lib/ops-hub/ingest/ingest-service.js';
import { MOCK_TGO_ORDER } from '../lib/ops-hub/fixtures/mock-orders.js';

test('ingestOpsOrder idempotency (integration)', async (t) => {
  const platformEnv = await readEnvFile(paths.platformEnv);
  const config = resolveOpsHubConfig(platformEnv);
  if (!config.postgresEnabled) {
    t.skip('OPS_POSTGRES_URL yok');
    return;
  }

  let pool;
  try {
    pool = await createOpsPool(config.postgresUrl);
  } catch (error) {
    if (/pg paketi|Cannot find package 'pg'/i.test(error.message)) {
      t.skip('pg paketi yüklü değil (npm install)');
      return;
    }
    throw error;
  }

  try {
    await applyOpsMigrations(pool);

    const stamp = Date.now();
    const order = structuredClone(MOCK_TGO_ORDER);
    order.externalId = `itest-${stamp}`;
    order.displayId = `itest-${stamp}`;

    const first = await ingestOpsOrder(pool, order);
    assert.equal(first.duplicate, false);
    assert.ok(first.orderId);

    const second = await ingestOpsOrder(pool, order);
    assert.equal(second.duplicate, true);
    assert.equal(second.orderId, first.orderId);

    await pool.query('DELETE FROM ops_orders WHERE id = $1', [first.orderId]);
  } catch (error) {
    if (error.code === 'ECONNREFUSED' || /connect/i.test(error.message)) {
      t.skip(`PostgreSQL erişilemiyor: ${error.message}`);
      return;
    }
    throw error;
  } finally {
    if (pool) {
      await closeOpsPool();
    }
  }
});
