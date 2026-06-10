#!/usr/bin/env node
/**
 * Post-import bakım: cache senkron, eksik BuyBox toplu güncelleme, tarife takip listesi.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile, readEnvFile } from '../lib/env.js';
import { configureDbStore, readDb, writeDb } from '../lib/db/store.js';
import { paths, resolveRuntimeConfig } from '../lib/config.js';
import { createBuyboxService } from '../lib/platform/services/buybox.js';
import { createDashboardService, migrateAutoTrackListFromFile } from '../lib/platform/services/dashboard.js';
import { createWorkerService } from '../lib/platform/services/worker.js';
import { createCommissionTariffService } from '../lib/platform/services/commission-tariff.js';
import { backfillTariffSourceRows } from '../lib/commission-tariff/bulk-select.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

async function main() {
  loadEnvFile(path.join(ROOT, '.env'));
  const platformEnv = await readEnvFile(paths.platformEnv);
  const config = resolveRuntimeConfig(platformEnv);
  await configureDbStore({
    sqliteDualWrite: config.sqliteDualWrite,
    dbReadBackend: config.dbReadBackend
  });

  const runtime = { lastCacheSyncAt: 0, workerProcess: null };
  const worker = createWorkerService({ runtime, config });
  const dashboard = createDashboardService({ buildLiveStatus: () => worker.buildLiveStatus() });
  const buybox = createBuyboxService({
    runtime,
    dashboardRowForBarcode: (barcode) => dashboard.dashboardRowForBarcode(barcode),
    migrateAutoTrackListFromFile
  });
  const commissionTariff = createCommissionTariffService();

  const results = {};

  results.cacheSync = await buybox.syncBuyboxCache({ force: true });

  const refreshRuns = [];
  for (let index = 0; index < 4; index += 1) {
    const batch = await buybox.refreshBatchBuybox({ missingFromTariff: true, maxCount: 30 });
    refreshRuns.push(batch);
    if (!batch.updated && !batch.requested) break;
  }
  results.buyboxRefresh = refreshRuns;

  results.autoTrack = await buybox.addAutoTrackBulk({ missingFromTariff: true });

  try {
    const { readJsonDb } = await import('../lib/db/store.js');
    const { isSqliteAvailable, readDbFromSqlite, syncJsonToSqlite } = await import('../lib/db/sqlite-store.js');
    const { buildParityReport } = await import('../lib/db/parity.js');

    if (await isSqliteAvailable()) {
      const jsonDb = await readJsonDb();
      await syncJsonToSqlite(jsonDb);
      const sqliteDb = await readDbFromSqlite();
      results.parity = await buildParityReport(jsonDb, sqliteDb);
    } else {
      results.parity = { ok: true, skipped: true, reason: 'node:sqlite unavailable' };
    }
  } catch (error) {
    results.parity = { ok: false, error: error.message || String(error) };
  }

  const tariffPath = path.resolve(ROOT, '../trendyol_cs.xlsx');
  try {
    const db = await readDb();
    const meta = db.commissionTariff || {};
    if (!meta.byBarcode || !Object.keys(meta.byBarcode).length) {
      results.tariffReimport = { skipped: true, reason: 'Aktif tarife yok' };
    } else if (meta.sourceRows?.length) {
      results.tariffReimport = { skipped: true, reason: 'sourceRows zaten mevcut' };
    } else {
      try {
        await fs.access(tariffPath);
        const contentBase64 = Buffer.from(await fs.readFile(tariffPath)).toString('base64');
        results.tariffReimport = await commissionTariff.importTariff({
          contentBase64,
          filename: path.basename(tariffPath),
          validFrom: meta.validFrom,
          validTo: meta.validTo
        });
      } catch (importError) {
        const backfill = backfillTariffSourceRows(db);
        if (backfill.ok) {
          await writeDb(db);
        }
        results.tariffReimport = {
          ...backfill,
          xlsxAttempt: importError.code === 'ENOENT'
            ? 'trendyol_cs.xlsx bulunamadı'
            : (importError.message || String(importError))
        };
      }
    }
  } catch (error) {
    results.tariffReimport = {
      skipped: true,
      reason: error.message || String(error)
    };
  }

  try {
    const { createProductMatchingService } = await import('../lib/platform/services/product-matching.js');
    const productMatching = createProductMatchingService();
    results.workbenchIndex = await productMatching.rebuildWorkbenchIndex();
  } catch (error) {
    results.workbenchIndex = {
      ok: false,
      error: error.message || String(error)
    };
  }

  console.log(JSON.stringify({ ok: true, results }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
