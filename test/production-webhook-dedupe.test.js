import test from 'node:test';
import assert from 'node:assert/strict';
import { readEnvFile } from '../lib/env.js';
import { paths } from '../lib/config.js';
import { resolveOpsHubConfig } from '../lib/ops-hub/config.js';
import { createOpsPool, closeOpsPool, applyOpsMigrations } from '../lib/ops-hub/db/migrate.js';
import { handleYemeksepetiOrderWebhook } from '../lib/ops-hub/webhooks/yemeksepeti-webhook-service.js';
import { ORDER_SOURCES } from '../lib/production/constants.js';

function ysWebhookBody(externalId, eventId) {
  return {
    event_id: eventId,
    order: {
      order_id: externalId,
      order_code: `YS-${externalId}`,
      status: 'RECEIVED',
      sys: { created_at: new Date().toISOString() },
      items: [{
        sku: 'sku-1',
        name: 'Test Ürün',
        pricing: { quantity: 1, unit_price: 25 }
      }]
    }
  };
}

test('YS webhook duplicate does not create second order', async (t) => {
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
      t.skip('pg paketi yüklü değil');
      return;
    }
    throw error;
  }

  const stamp = Date.now();
  const externalId = `wh-dedupe-${stamp}`;
  const eventId = `evt-${stamp}`;
  const body = ysWebhookBody(externalId, eventId);

  try {
    await applyOpsMigrations(pool);

    const first = await handleYemeksepetiOrderWebhook(pool, body, { platformEnv });
    assert.equal(first.duplicate, false);
    assert.ok(first.orderId);

    const second = await handleYemeksepetiOrderWebhook(pool, body, { platformEnv });
    assert.equal(second.duplicate, true);

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS c FROM ops_orders WHERE channel = 'yemeksepeti' AND external_id = $1`,
      [externalId]
    );
    assert.equal(countResult.rows[0].c, 1);

    const sourceResult = await pool.query(
      `SELECT ingest_source FROM ops_orders WHERE external_id = $1`,
      [externalId]
    );
    assert.equal(sourceResult.rows[0].ingest_source, ORDER_SOURCES.WEBHOOK);

    await pool.query('DELETE FROM ops_webhook_events WHERE external_order_id = $1', [externalId]);
    await pool.query('DELETE FROM ops_orders WHERE external_id = $1', [externalId]);
  } catch (error) {
    if (error.code === 'ECONNREFUSED' || /connect/i.test(error.message)) {
      t.skip(`PostgreSQL erişilemiyor: ${error.message}`);
      return;
    }
    throw error;
  } finally {
    await closeOpsPool();
  }
});
