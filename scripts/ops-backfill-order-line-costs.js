/**
 * Geçmiş sipariş satırlarına ana havuz alış fiyatı yazar (unit_cost boş olanlar).
 *
 * Kullanım:
 *   node scripts/ops-backfill-order-line-costs.js --dry-run
 *   node scripts/ops-backfill-order-line-costs.js --limit=2000
 *   node scripts/ops-backfill-order-line-costs.js --channel=trendyol_go
 */
import { readEnvFile } from '../lib/env.js';
import { paths } from '../lib/config.js';
import { createOpsPool, closeOpsPool, applyOpsMigrations } from '../lib/ops-hub/db/migrate.js';
import { resolveOpsHubConfig } from '../lib/ops-hub/config.js';
import { backfillOrderLineCosts } from '../lib/ops-hub/sync/order-line-cost-backfill.js';

const dryRun = process.argv.includes('--dry-run');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const channelArg = process.argv.find((a) => a.startsWith('--channel='));
const sinceArg = process.argv.find((a) => a.startsWith('--since='));
const untilArg = process.argv.find((a) => a.startsWith('--until='));

const limit = limitArg ? Number(limitArg.split('=')[1]) : 2000;
const channel = channelArg ? channelArg.split('=')[1] : null;
const since = sinceArg ? sinceArg.split('=')[1] : null;
const until = untilArg ? untilArg.split('=')[1] : null;

async function main() {
  const platformEnv = await readEnvFile(paths.platformEnv);
  const config = resolveOpsHubConfig(platformEnv);
  if (!config.postgresEnabled) {
    console.error('OPS_POSTGRES_URL tanımlı değil');
    process.exit(1);
  }

  const pool = await createOpsPool(config.postgresUrl);
  try {
    await applyOpsMigrations(pool);

    const remaining = await pool.query(
      `SELECT COUNT(*)::int AS n
       FROM ops_order_lines l
       INNER JOIN ops_orders o ON o.id = l.order_id
       WHERE l.unit_cost IS NULL
         AND o.status NOT IN ('cancelled', 'failed')`
    );
    const pending = Number(remaining.rows[0]?.n || 0);
    console.log(`Maliyet bekleyen satır: ${pending}`);

    const result = await backfillOrderLineCosts(pool, {
      limit,
      dryRun,
      platformEnv,
      channel,
      since,
      until
    });

    console.log(JSON.stringify(result, null, 2));

    if (!result.ok && result.errors?.length) {
      process.exitCode = 1;
    }
  } finally {
    await closeOpsPool();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
