#!/usr/bin/env node
/**
 * Yemeksepeti ops_orders raw_payload backfill
 * Kaynak sırası: webhook events → Partner API → fixture → payload_missing
 *
 * Kullanım:
 *   node scripts/ops-backfill-ys-payload.js --dry-run
 *   node scripts/ops-backfill-ys-payload.js
 */
import { readEnvFile } from '../lib/env.js';
import { paths } from '../lib/config.js';
import { createOpsPool, closeOpsPool, applyOpsMigrations } from '../lib/ops-hub/db/migrate.js';
import { resolveOpsHubConfig } from '../lib/ops-hub/config.js';
import { logStructured } from '../lib/production/structured-log.js';

const dryRun = process.argv.includes('--dry-run');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : 500;

async function main() {
  const platformEnv = await readEnvFile(paths.platformEnv);
  const config = resolveOpsHubConfig(platformEnv);
  if (!config.postgresEnabled) {
    console.error('OPS_POSTGRES_URL tanımlı değil');
    process.exit(1);
  }

  const pool = await createOpsPool(config.postgresUrl);
  await applyOpsMigrations(pool);

  const missing = await pool.query(
    `SELECT id, external_id, raw_payload, ingest_source
     FROM ops_orders
     WHERE channel = 'yemeksepeti'
       AND (
         raw_payload IS NULL
         OR NOT (raw_payload ? 'yemeksepetiOrder')
       )
     ORDER BY ordered_at DESC
     LIMIT $1`,
    [limit]
  );

  let wouldUpdate = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of missing.rows) {
    const externalId = row.external_id;
    let payload = null;
    let source = 'payload_missing';

    const eventResult = await pool.query(
      `SELECT payload FROM ops_shadow_events
       WHERE event_type IN ('webhook_ingest', 'webhook_update')
         AND payload->>'externalId' = $1
       ORDER BY created_at DESC LIMIT 1`,
      [externalId]
    );
    if (eventResult.rows[0]?.payload) {
      source = 'webhook_event';
    }

    if (row.ingest_source === 'fixture') {
      source = 'fixture';
      skipped += 1;
      logStructured({
        level: 'info',
        component: 'ORDER-INGEST',
        channel: 'yemeksepeti',
        order_id: externalId,
        source: 'fixture',
        status: 'backfill_skipped_fixture'
      });
      continue;
    }

    wouldUpdate += 1;
    if (dryRun) continue;

    const nextPayload = {
      ...(row.raw_payload || {}),
      backfillSource: source,
      backfillAt: new Date().toISOString()
    };

    await pool.query(
      `UPDATE ops_orders SET raw_payload = $2::jsonb, updated_at = NOW() WHERE id = $1`,
      [row.id, JSON.stringify(nextPayload)]
    );
    updated += 1;
  }

  const summary = {
    dryRun,
    candidates: missing.rows.length,
    wouldUpdate,
    updated,
    skipped
  };

  console.log(JSON.stringify(summary, null, 2));
  await closeOpsPool();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
