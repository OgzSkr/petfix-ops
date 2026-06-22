#!/usr/bin/env node
/**
 * YS geçmiş sipariş — list API + bilinen order_id (UUID) ile GET /v2/chains/{chain}/orders/{id}
 *
 *   node scripts/ys-backfill-orders-by-id.js 60
 *   node scripts/ys-backfill-orders-by-id.js --ids id1,id2,id3
 *   node scripts/ys-backfill-orders-by-id.js --file data/ys-order-ids.txt
 */
import fs from 'node:fs';
import path from 'node:path';
import { readEnvFile } from '../lib/env.js';
import { paths } from '../lib/config.js';
import { resolveOpsHubConfig } from '../lib/ops-hub/config.js';
import { createOpsPool, closeOpsPool, applyOpsMigrations } from '../lib/ops-hub/db/migrate.js';
import { ensureDefaultBranch } from '../lib/ops-hub/db/repository.js';
import { syncYemeksepetiReadOnly } from '../lib/ops-hub/sync/ys-sync.js';
import {
  fetchYemeksepetiOrders,
  isYemeksepetiOrderUuid
} from '../lib/channels/yemeksepeti-orders.js';
import { resolveYemeksepetiOpsConfig } from '../lib/ops-hub/integrations/branch-config-resolver.js';

function parseArgs(argv) {
  const args = { days: 60, ids: [], file: '' };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--ids' && argv[i + 1]) {
      args.ids.push(...String(argv[++i]).split(/[,;\s\n]+/).filter(Boolean));
    } else if (arg === '--file' && argv[i + 1]) {
      args.file = argv[++i];
    } else if (/^\d+$/.test(arg)) {
      args.days = Number(arg);
    }
  }
  return args;
}

function loadIdsFromFile(filePath) {
  const abs = path.resolve(String(filePath || '').trim());
  if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) return [];
  return fs.readFileSync(abs, 'utf8')
    .split(/[\s,;]+/)
    .map((row) => row.trim())
    .filter(isYemeksepetiOrderUuid);
}

async function main() {
  const args = parseArgs(process.argv);
  const platformEnv = await readEnvFile(paths.platformEnv);
  const config = resolveOpsHubConfig(platformEnv);
  const cfg = await resolveYemeksepetiOpsConfig(null, { platformEnv });

  const orderIds = [...new Set([
    ...args.ids,
    ...loadIdsFromFile(args.file),
    ...String(platformEnv.YEMEKSEPETI_BACKFILL_ORDER_IDS || '').split(/[,;\s\n]+/).filter(Boolean)
  ].filter(isYemeksepetiOrderUuid))];

  console.log(JSON.stringify({ days: args.days, orderIds: orderIds.length }, null, 2));

  const preview = await fetchYemeksepetiOrders(cfg, {
    days: args.days,
    platformEnv,
    orderIds
  });

  console.log(JSON.stringify({
    step: 'preview',
    listAndById: preview.length,
    sample: preview.slice(0, 3).map((row) => ({
      orderNumber: row.orderNumber,
      shipmentPackageId: row.shipmentPackageId,
      status: row.status
    }))
  }, null, 2));

  if (!config.postgresEnabled) {
    console.log('OPS_POSTGRES_URL yok — yalnızca preview tamamlandı.');
    return;
  }

  const pool = await createOpsPool(config.postgresUrl);
  try {
    await applyOpsMigrations(pool);
    const branch = await ensureDefaultBranch(pool);
    const result = await syncYemeksepetiReadOnly(pool, {
      platformEnv,
      branchId: branch.id,
      days: args.days,
      shadowMode: true,
      orderIds
    });
    console.log(JSON.stringify({ step: 'ingest', ...result }, null, 2));
  } finally {
    await closeOpsPool();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
