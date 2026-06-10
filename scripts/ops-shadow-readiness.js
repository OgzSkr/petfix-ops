#!/usr/bin/env node
/**
 * Shadow → canlı geçiş kriterlerini terminale yazdırır.
 */
import { readEnvFile } from '../lib/env.js';
import { paths } from '../lib/config.js';
import { resolveOpsHubConfig } from '../lib/ops-hub/config.js';
import { createOpsPool, closeOpsPool, applyOpsMigrations } from '../lib/ops-hub/db/migrate.js';
import { buildShadowReport } from '../lib/ops-hub/ingest/ingest-service.js';
import { listOpsOrders } from '../lib/ops-hub/db/repository.js';
import { ensureDefaultBranch } from '../lib/ops-hub/db/repository.js';

const MIN_ORDERS = 20;
const MIN_DAYS = 7;

function computeDays(orders) {
  if (!orders.length) return 0;
  const earliest = Math.min(...orders.map((o) => new Date(o.ordered_at).getTime()));
  return Math.max(0, Math.floor((Date.now() - earliest) / 86400000));
}

async function main() {
  const platformEnv = await readEnvFile(paths.platformEnv);
  const config = resolveOpsHubConfig(platformEnv);
  if (!config.postgresEnabled) {
    console.error('OPS_POSTGRES_URL gerekli');
    process.exit(1);
  }

  const pool = await createOpsPool(config.postgresUrl);
  try {
    await applyOpsMigrations(pool);
    const branch = await ensureDefaultBranch(pool);
    const report = await buildShadowReport(pool, { branchSlug: branch.slug, limit: 500 });
    const orders = await listOpsOrders(pool, { branchId: branch.id, limit: 500 });
    const days = computeDays(orders);
    const total = report.orders?.total ?? orders.length;
    const issues = report.events?.issues ?? 0;

    const checks = [
      { label: `Shadow sipariş ≥ ${MIN_ORDERS}`, ok: total >= MIN_ORDERS, value: total },
      { label: `İzleme süresi ≥ ${MIN_DAYS} gün`, ok: days >= MIN_DAYS, value: days },
      { label: 'Shadow uyarısı yok', ok: issues === 0, value: issues }
    ];

    console.log('\n=== Shadow → Canlı Hazırlık ===\n');
    for (const row of checks) {
      console.log(`${row.ok ? '✓' : '✗'} ${row.label} (${row.value})`);
    }
    const ready = checks.every((c) => c.ok);
    console.log(`\nSonuç: ${ready ? 'CANLI FLAG AÇILABİLİR' : 'Henüz erken'}\n`);
    if (!ready) {
      console.log('Flag\'ler (.env): FF_CHANNEL_STATUS_WRITE, FF_BENIMPOS_SALE_WRITE, FF_STOCK_PUSH');
      console.log('OPS_SHADOW_MODE_DEFAULT=false yapmadan önce yukarıdaki kriterleri tamamlayın.\n');
    }
  } finally {
    await closeOpsPool();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
