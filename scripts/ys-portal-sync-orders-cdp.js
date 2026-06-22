#!/usr/bin/env node
/**
 * İnce CLI sarmalayıcı — çekirdek lib/ops-hub/workers/portal-sync-worker.js.
 * Portal /orders GraphQL yanıtını yakalar, kaydeder ve ops DB'ye yazar.
 *   node scripts/ys-portal-sync-orders-cdp.js
 */
import { runYemeksepetiPortalSync } from '../lib/ops-hub/workers/portal-sync-worker.js';

async function main() {
  const report = await runYemeksepetiPortalSync({ enrichLines: false });
  console.log(JSON.stringify(report.capture, null, 2));
  console.log(JSON.stringify({ step: 'ingest', ...report.ingest }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(error.code === 'PORTAL_CAPTURE_EMPTY' ? 2 : 1);
});
