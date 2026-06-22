#!/usr/bin/env node
/**
 * İnce CLI sarmalayıcı — çekirdek lib/ops-hub/workers/order-lines-enrich-worker.js.
 * Portal özet siparişlerine Partner API satır detayı ekler (UUID map gerekir).
 *
 *   node scripts/ys-enrich-order-lines.js
 *   node scripts/ys-enrich-order-lines.js --limit=50
 */
import { runYemeksepetiLinesEnrich } from '../lib/ops-hub/workers/order-lines-enrich-worker.js';

function parseArgs(argv) {
  const args = { limit: 100 };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--limit=')) {
      args.limit = Number(arg.split('=')[1]) || 100;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const result = await runYemeksepetiLinesEnrich({ limit: args.limit });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
