#!/usr/bin/env node
/**
 * İnce CLI sarmalayıcı — çekirdek lib/ops-hub/workers/portal-sync-worker.js.
 * YS Partner Portal GraphQL sipariş özeti → ops DB ingest.
 *   node scripts/ys-portal-ingest-json.js data/ys-portal-orders.json
 */
import path from 'node:path';
import { paths } from '../lib/config.js';
import { ingestYemeksepetiPortalFromFile } from '../lib/ops-hub/workers/portal-sync-worker.js';

async function main() {
  const filePath = process.argv[2] || path.join(paths.root, 'data', 'ys-portal-orders.json');
  const result = await ingestYemeksepetiPortalFromFile(filePath);
  if (result.postgresSkipped) {
    console.error('OPS_POSTGRES_URL tanımlı değil.');
    process.exit(1);
  }
  console.log(JSON.stringify({ filePath: result.filePath, orders: result.orders }, null, 2));
  console.log(JSON.stringify({ step: 'ingest', ...result.ingest }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(error.code === 'ENOENT' ? 1 : 1);
});
