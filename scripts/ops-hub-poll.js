#!/usr/bin/env node
/**
 * İnce CLI sarmalayıcı — çekirdek mantık lib/ops-hub/workers/poll-worker.js içinde.
 */
import { runOpsPoll, DEFAULT_POLL_CHANNELS } from '../lib/ops-hub/workers/poll-worker.js';

function parseArgs(argv) {
  const args = {
    channels: [...DEFAULT_POLL_CHANNELS],
    tgoLimit: 50,
    ysDays: 14,
    getirDays: 0,
    activeOnly: true
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--all-channels') {
      args.channels = [...DEFAULT_POLL_CHANNELS];
    } else if (arg === '--tgo-only') {
      args.channels = ['trendyol_go'];
    } else if (arg === '--ys-only') {
      args.channels = ['yemeksepeti'];
    } else if (arg === '--getir-only') {
      args.channels = ['getir'];
    } else if (arg === '--tgo-limit' && argv[i + 1]) {
      args.tgoLimit = Number(argv[++i]);
    } else if (arg === '--ys-days' && argv[i + 1]) {
      args.ysDays = Number(argv[++i]);
    } else if (arg === '--getir-days' && argv[i + 1]) {
      args.getirDays = Number(argv[++i]);
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
  --tgo-only             Uber Eats (Trendyol Go) poll sync — UBER_EATS_* credential
  --getir-only         Yalnızca Getir poll sync
  --tgo-limit <n>      TGO paket limiti (varsayılan 50)
  --ys-days <n>        YS gün geriye (varsayılan 14)
  --getir-days <n>     Getir tamamlanan sipariş geçmişi (delivered API)
  --no-active-only     TGO tüm durumları çek
`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  const report = await runOpsPoll(args);
  console.log(JSON.stringify(report));
  if (Array.isArray(report.errors) && report.errors.length) {
    console.error(`ops-hub-poll: ${report.errors.join(' · ')}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
