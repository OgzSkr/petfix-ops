#!/usr/bin/env node
/**
 * Getir sipariş — bilinen Mongo order ID (24 hex) ile çekip ops_orders'a yazar.
 * Onaylanmış / yolda siparişler poll ile gelmez; webhook kaçırıldıysa bu script kullanılır.
 *
 *   node scripts/getir-backfill-order-by-id.js 6a3975592216743d37196d6f
 *   node scripts/getir-backfill-order-by-id.js --ids id1,id2
 *   node scripts/getir-backfill-order-by-id.js --confirm z070 --ids id1
 */
import fs from 'node:fs';
import path from 'node:path';
import { readEnvFile } from '../lib/env.js';
import { paths } from '../lib/config.js';
import { resolveOpsHubConfig } from '../lib/ops-hub/config.js';
import { createOpsPool, closeOpsPool, applyOpsMigrations } from '../lib/ops-hub/db/migrate.js';
import { ensureDefaultBranch } from '../lib/ops-hub/db/repository.js';
import { readDb } from '../lib/db/store.js';
import { loginGetirApi, fetchGetirOrderById } from '../lib/channels/getir-api.js';
import { resolveGetirOpsConfig } from '../lib/ops-hub/integrations/branch-config-resolver.js';
import { normalizeGetirPollOrder } from '../lib/ops-hub/channels/getir-normalize.js';
import { refreshDuplicateGetirOrder } from '../lib/ops-hub/sync/getir-sync.js';
import { ingestOpsOrder } from '../lib/ops-hub/ingest/ingest-service.js';

function isGetirOrderObjectId(value) {
  return /^[a-f0-9]{24}$/i.test(String(value || '').trim());
}

function parseArgs(argv) {
  const args = { ids: [], confirm: '', file: '', dryRun: false };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--ids' && argv[i + 1]) {
      args.ids.push(...String(argv[++i]).split(/[,;\s\n]+/).filter(Boolean));
    } else if (arg === '--file' && argv[i + 1]) {
      args.file = argv[++i];
    } else if (arg === '--confirm' && argv[i + 1]) {
      args.confirm = String(argv[++i]).trim().toLowerCase();
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (isGetirOrderObjectId(arg)) {
      args.ids.push(arg);
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
    .filter(isGetirOrderObjectId);
}

async function main() {
  const args = parseArgs(process.argv);
  const orderIds = [...new Set([
    ...args.ids,
    ...loadIdsFromFile(args.file)
  ].filter(isGetirOrderObjectId))];

  if (!orderIds.length) {
    console.error('Kullanım: node scripts/getir-backfill-order-by-id.js <24-char-id> [--ids id1,id2] [--confirm z070]');
    process.exit(1);
  }

  const platformEnv = await readEnvFile(paths.platformEnv);
  const config = resolveOpsHubConfig(platformEnv);
  const cfg = await resolveGetirOpsConfig(null, { platformEnv });
  const session = await loginGetirApi(cfg);
  const db = await readDb();

  const preview = [];
  for (const orderId of orderIds) {
    const remote = await fetchGetirOrderById(cfg, session, orderId);
    preview.push({
      orderId,
      confirmationId: remote?.confirmationId || null,
      status: remote?.status ?? null,
      totalPrice: remote?.totalPrice ?? null,
      clientName: remote?.client?.name || remote?.clientName || null
    });
  }

  console.log(JSON.stringify({ step: 'preview', orders: preview }, null, 2));

  if (args.confirm) {
    const match = preview.find((row) => String(row.confirmationId || '').toLowerCase() === args.confirm);
    if (!match) {
      console.error(`Onay kodu eşleşmedi: beklenen ${args.confirm}`);
      process.exit(1);
    }
  }

  if (args.dryRun) {
    console.log('dry-run — ingest atlandı.');
    return;
  }

  if (!config.postgresEnabled) {
    console.log('OPS_POSTGRES_URL yok — yalnızca preview tamamlandı.');
    return;
  }

  const pool = await createOpsPool(config.postgresUrl);
  try {
    await applyOpsMigrations(pool);
    await ensureDefaultBranch(pool);

    const results = { ingested: 0, duplicates: 0, failed: 0, orders: [], errors: [] };
    for (const orderId of orderIds) {
      try {
        const remote = await fetchGetirOrderById(cfg, session, orderId);
        const normalized = await normalizeGetirPollOrder(remote, {
          db,
          platformEnv,
          shopId: cfg.shopId,
          endpointKind: 'partner_api',
          shadowMode: true,
          ingestSource: 'partner_api'
        });

        if (!normalized.ok) {
          results.failed += 1;
          results.errors.push({ orderId, errors: normalized.errors });
          continue;
        }

        const ingest = await ingestOpsOrder(pool, normalized.order, {
          shadowModeDefault: true,
          branchSlug: 'main',
          platformEnv
        });
        if (ingest.duplicate) {
          await refreshDuplicateGetirOrder(pool, normalized, ingest);
        }

        if (ingest.duplicate) results.duplicates += 1;
        else results.ingested += 1;

        results.orders.push({
          orderId,
          displayId: normalized.order.displayId,
          externalId: normalized.order.externalId,
          duplicate: ingest.duplicate,
          opsOrderId: ingest.orderId
        });
      } catch (error) {
        results.failed += 1;
        results.errors.push({ orderId, errors: [error.message] });
      }
    }

    console.log(JSON.stringify({ step: 'ingest', ...results }, null, 2));
    if (results.failed) process.exitCode = 1;
  } finally {
    await closeOpsPool();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
