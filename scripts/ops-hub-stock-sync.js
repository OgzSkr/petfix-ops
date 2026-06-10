#!/usr/bin/env node
import { readEnvFile } from '../lib/env.js';
import { paths } from '../lib/config.js';
import { resolveOpsHubConfig } from '../lib/ops-hub/config.js';
import { createOpsPool, closeOpsPool, applyOpsMigrations } from '../lib/ops-hub/db/migrate.js';
import { ensureDefaultBranch } from '../lib/ops-hub/db/repository.js';
import { previewStockDrift, runStockSync } from '../lib/ops-hub/stock/stock-sync-service.js';

function parseArgs(argv) {
  const args = {
    channel: 'yemeksepeti',
    driftOnly: false,
    forceLive: false,
    limit: null
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--drift') args.driftOnly = true;
    else if (arg === '--execute') args.forceLive = true;
    else if (arg === '--channel' && argv[i + 1]) args.channel = argv[++i];
    else if (arg === '--limit' && argv[i + 1]) args.limit = Number(argv[++i]);
    else if (arg === '--help' || arg === '-h') args.help = true;
  }

  return args;
}

function printHelp() {
  console.log(`Kullanım: node scripts/ops-hub-stock-sync.js [seçenekler]

  --channel <id>   trendyol_go | yemeksepeti | getir (varsayılan: yemeksepeti)
  --drift          Yalnızca drift raporu (DB yazma yok)
  --execute        FF_STOCK_PUSH açıkken canlı push dener
  --limit <n>      Maksimum push satırı
`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  const platformEnv = await readEnvFile(paths.platformEnv);

  if (args.driftOnly) {
    const plan = await previewStockDrift(args.channel, {
      platformEnv,
      maxItems: args.limit
    });
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  const config = resolveOpsHubConfig(platformEnv);
  if (!config.postgresEnabled) {
    console.error('OPS_POSTGRES_URL tanımlı değil.');
    process.exit(1);
  }

  const pool = await createOpsPool(config.postgresUrl);
  try {
    await applyOpsMigrations(pool);
    const branch = await ensureDefaultBranch(pool);
    const result = await runStockSync(pool, {
      channel: args.channel,
      platformEnv,
      branchId: branch.id,
      forceLive: args.forceLive,
      maxItems: args.limit
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await closeOpsPool();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
