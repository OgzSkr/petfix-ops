#!/usr/bin/env node
import { readEnvFile } from '../lib/env.js';
import { paths } from '../lib/config.js';
import { resolveOpsHubConfig } from '../lib/ops-hub/config.js';
import { createOpsPool, closeOpsPool, applyOpsMigrations } from '../lib/ops-hub/db/migrate.js';
import { ensureDefaultBranch } from '../lib/ops-hub/db/repository.js';
import { syncTgoReadOnly } from '../lib/ops-hub/sync/tgo-sync.js';
import { syncYemeksepetiReadOnly } from '../lib/ops-hub/sync/ys-sync.js';

function parseArgs(argv) {
  const args = {
    channels: ['trendyol_go', 'yemeksepeti'],
    tgoLimit: 50,
    ysDays: 1,
    activeOnly: true
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--all-channels') {
      args.channels = ['trendyol_go', 'yemeksepeti'];
    } else if (arg === '--tgo-only') {
      args.channels = ['trendyol_go'];
    } else if (arg === '--ys-only') {
      args.channels = ['yemeksepeti'];
    } else if (arg === '--tgo-limit' && argv[i + 1]) {
      args.tgoLimit = Number(argv[++i]);
    } else if (arg === '--ys-days' && argv[i + 1]) {
      args.ysDays = Number(argv[++i]);
    } else if (arg === '--no-active-only') {
      args.activeOnly = false;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    }
  }

  return args;
}

function printHelp() {
  console.log(`Kullanım: node scripts/ops-hub-poll.js [seçenekler]

  --tgo-only           Yalnızca Trendyol Go sync
  --ys-only            Yalnızca Yemeksepeti poll sync
  --tgo-limit <n>      TGO paket limiti (varsayılan 50)
  --ys-days <n>        YS gün geriye (varsayılan 1)
  --no-active-only     TGO tüm durumları çek
`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  const platformEnv = await readEnvFile(paths.platformEnv);
  const config = resolveOpsHubConfig(platformEnv);
  if (!config.postgresEnabled) {
    console.error('OPS_POSTGRES_URL tanımlı değil.');
    process.exit(1);
  }

  const pool = await createOpsPool(config.postgresUrl);
  const report = { startedAt: new Date().toISOString(), channels: {} };

  try {
    await applyOpsMigrations(pool);
    const branch = await ensureDefaultBranch(pool);

    if (args.channels.includes('trendyol_go')) {
      try {
        report.channels.trendyol_go = await syncTgoReadOnly(pool, {
          platformEnv,
          branchId: branch.id,
          limit: args.tgoLimit,
          maxPages: 3,
          activeOnly: args.activeOnly,
          shadowMode: true
        });
      } catch (error) {
        report.channels.trendyol_go = { error: error.message };
      }
    }

    if (args.channels.includes('yemeksepeti')) {
      try {
        report.channels.yemeksepeti = await syncYemeksepetiReadOnly(pool, {
          platformEnv,
          branchId: branch.id,
          days: args.ysDays,
          shadowMode: true
        });
      } catch (error) {
        report.channels.yemeksepeti = { error: error.message };
      }
    }
  } finally {
    await closeOpsPool();
  }

  report.finishedAt = new Date().toISOString();
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
