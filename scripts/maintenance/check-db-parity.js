#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { readJsonDb } from '../lib/db/store.js';
import {
  isSqliteAvailable,
  readDbFromSqlite,
  syncJsonToSqlite
} from '../lib/db/sqlite-store.js';
import { buildParityReport } from '../lib/db/parity.js';
import { readEnvFile } from '../lib/env.js';
import { paths, resolveRuntimeConfig } from '../lib/config.js';

async function main() {
  const platformEnv = await readEnvFile(paths.platformEnv);
  const config = resolveRuntimeConfig(platformEnv);
  const jsonDb = await readJsonDb();
  const sqliteOk = await isSqliteAvailable();

  if (!sqliteOk) {
    const skipped = { ok: true, skipped: true, reason: 'node:sqlite unavailable' };
    console.log(JSON.stringify(skipped, null, 2));
    return;
  }

  await syncJsonToSqlite(jsonDb);
  const sqliteDb = await readDbFromSqlite();
  const report = await buildParityReport(jsonDb, sqliteDb);

  const output = {
    ok: report.ok,
    generatedAt: report.generatedAt,
    config: {
      dbReadBackend: config.dbReadBackend,
      sqliteDualWrite: config.sqliteDualWrite
    },
    report
  };

  const reportPath = path.join(paths.root, 'data', 'parity-report.json');
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

  console.log(JSON.stringify({
    ok: output.ok,
    reportPath,
    readParity: report.readParity.ok,
    profitParity: report.profitParity.ok,
    profitSampled: report.profitParity.sampled,
    counts: report.readParity.counts
  }, null, 2));

  if (!output.ok) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exit(1);
});
