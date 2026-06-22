#!/usr/bin/env node
/**
 * İnce CLI sarmalayıcı — çekirdek mantık lib/ops-hub/workers/daily-sync.js içinde.
 * VPS cron veya: docker exec petfix-prod-api node scripts/ops-prod-daily-sync.js
 */
import { runDailySync } from '../lib/ops-hub/workers/daily-sync.js';

try {
  const report = await runDailySync({
    onStep: (entry) => {
      if (entry.ok) {
        console.log(JSON.stringify(entry));
      } else {
        console.error(JSON.stringify(entry));
      }
    }
  });
  console.log(JSON.stringify({ ok: report.ok, finishedAt: report.finishedAt }));
} catch (error) {
  process.exit(1);
}
