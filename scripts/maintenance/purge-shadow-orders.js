#!/usr/bin/env node
/**
 * Eğitim (shadow) modunda oluşan test siparişlerini PostgreSQL'den siler.
 *
 *   node scripts/maintenance/purge-shadow-orders.js --dry-run
 *   node scripts/maintenance/purge-shadow-orders.js
 *   node scripts/maintenance/purge-shadow-orders.js --branch=main
 */
import { readEnvFile } from '../../lib/env.js';
import { paths } from '../../lib/config.js';
import { resolveOpsHubConfig } from '../../lib/ops-hub/config.js';
import { createOpsPool, closeOpsPool, applyOpsMigrations } from '../../lib/ops-hub/db/migrate.js';
import { ensureDefaultBranch } from '../../lib/ops-hub/db/repository.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const branchArg = args.find((arg) => arg.startsWith('--branch='));
const branchSlug = branchArg ? branchArg.split('=')[1] : null;

async function countRows(pool, sql, params = []) {
  const result = await pool.query(sql, params);
  return Number(result.rows[0]?.n || 0);
}

async function main() {
  const platformEnv = await readEnvFile(paths.platformEnv);
  const config = resolveOpsHubConfig(platformEnv);
  if (!config.postgresEnabled) {
    console.error('OPS_POSTGRES_URL tanımlı değil.');
    process.exit(1);
  }

  const pool = await createOpsPool(config.postgresUrl);
  try {
    await applyOpsMigrations(pool);
    const branch = branchSlug
      ? (await pool.query('SELECT id, slug, name FROM ops_branches WHERE slug = $1 LIMIT 1', [branchSlug])).rows[0]
      : await ensureDefaultBranch(pool);

    if (!branch?.id) {
      console.error(branchSlug ? `Şube bulunamadı: ${branchSlug}` : 'Varsayılan şube bulunamadı.');
      process.exit(1);
    }

    const branchId = branch.id;
    const summary = {
      branch: { id: branchId, slug: branch.slug, name: branch.name },
      dryRun,
      orders: {
        shadow: await countRows(
          pool,
          'SELECT count(*)::int AS n FROM ops_orders WHERE branch_id = $1 AND shadow_mode = TRUE',
          [branchId]
        ),
        live: await countRows(
          pool,
          'SELECT count(*)::int AS n FROM ops_orders WHERE branch_id = $1 AND shadow_mode = FALSE',
          [branchId]
        )
      },
      related: {
        orderLines: await countRows(
          pool,
          `SELECT count(*)::int AS n FROM ops_order_lines ol
           JOIN ops_orders o ON o.id = ol.order_id
           WHERE o.branch_id = $1 AND o.shadow_mode = TRUE`,
          [branchId]
        ),
        shadowEvents: await countRows(
          pool,
          `SELECT count(*)::int AS n FROM ops_shadow_events
           WHERE branch_id = $1 AND (
             order_id IN (SELECT id FROM ops_orders WHERE branch_id = $1 AND shadow_mode = TRUE)
             OR order_id IS NULL
           )`,
          [branchId]
        ),
        outbox: await countRows(
          pool,
          `SELECT count(*)::int AS n FROM ops_outbox
           WHERE branch_id = $1 AND order_id IN (
             SELECT id FROM ops_orders WHERE branch_id = $1 AND shadow_mode = TRUE
           )`,
          [branchId]
        )
      }
    };

    const byChannel = await pool.query(
      `SELECT channel, count(*)::int AS n
       FROM ops_orders
       WHERE branch_id = $1 AND shadow_mode = TRUE
       GROUP BY channel
       ORDER BY channel`,
      [branchId]
    );
    summary.byChannel = byChannel.rows;

    console.log(JSON.stringify(summary, null, 2));

    if (!summary.orders.shadow) {
      console.log('\nSilinecek shadow sipariş yok.');
      return;
    }

    if (dryRun) {
      console.log('\nDry-run — veritabanı değiştirilmedi. Silmek için --dry-run olmadan çalıştırın.');
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const outbox = await client.query(
        `DELETE FROM ops_outbox
         WHERE branch_id = $1 AND order_id IN (
           SELECT id FROM ops_orders WHERE branch_id = $1 AND shadow_mode = TRUE
         )`,
        [branchId]
      );
      const events = await client.query(
        `DELETE FROM ops_shadow_events
         WHERE branch_id = $1 AND (
           order_id IN (SELECT id FROM ops_orders WHERE branch_id = $1 AND shadow_mode = TRUE)
           OR order_id IS NULL
         )`,
        [branchId]
      );
      const orders = await client.query(
        'DELETE FROM ops_orders WHERE branch_id = $1 AND shadow_mode = TRUE',
        [branchId]
      );
      await client.query('COMMIT');
      console.log('\nSilindi:', {
        orders: orders.rowCount,
        shadowEvents: events.rowCount,
        outbox: outbox.rowCount
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await closeOpsPool();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
