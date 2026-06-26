import { readDb, writeDb } from '../../db/store.js';
import { paths } from '../../config.js';
import { readEnvFile } from '../../env.js';
import { createLogger } from '../../logger.js';
import {
  ensureMatchingSyncState,
  normalizeMatchingSyncSettings,
  catalogStepsForChannel,
  YEMEKSEPETI_SCHEDULED_CATALOG_MAX_PAGES
} from '../../product-matching/matching-sync-schedule.js';
import { isProductMatchingEnabled } from '../../product-matching/matching-enabled.js';

const log = createLogger('MATCHING-SYNC');

export function createMatchingSyncService({
  runtime,
  productMatching,
  uberOps,
  channelMatchingOps,
  stockAutoSync
}) {
  async function getSettings() {
    const platformEnv = await readEnvFile(paths.platformEnv);
    const db = await readDb();
    const settings = ensureMatchingSyncState(db, platformEnv);
    return {
      settings,
      scheduled: Boolean(runtime.matchingSyncTimer),
      running: Boolean(runtime.matchingSyncRunning)
    };
  }

  async function saveSettings(payload = {}) {
    const platformEnv = await readEnvFile(paths.platformEnv);
    const db = await readDb();
    const existing = ensureMatchingSyncState(db, platformEnv);
    const next = normalizeMatchingSyncSettings({
      ...existing,
      enabled: payload.enabled != null ? payload.enabled === true || payload.enabled === 'true' : existing.enabled,
      intervalMinutes: payload.intervalMinutes ?? existing.intervalMinutes,
      channels: payload.channels ?? existing.channels,
      uberIncludeOrders: payload.uberIncludeOrders != null
        ? payload.uberIncludeOrders === true || payload.uberIncludeOrders === 'true'
        : existing.uberIncludeOrders
    }, platformEnv);

    db.matchingSyncSchedule = next;
    db.meta = db.meta || {};
    db.meta.updatedAt = new Date().toISOString();
    await writeDb(db);
    scheduleSync(next.enabled);

    return getSettings();
  }

  async function runScheduledSync(force = false) {
    if (runtime.matchingSyncRunning) {
      return { ok: true, skipped: true, reason: 'already_running' };
    }

    runtime.matchingSyncRunning = true;
    const startedAt = new Date().toISOString();

    try {
      const platformEnv = await readEnvFile(paths.platformEnv);
      const db = await readDb();
      const settings = ensureMatchingSyncState(db, platformEnv);

      if (!settings.enabled && !force) {
        return { ok: true, skipped: true, reason: 'disabled' };
      }

      const summary = {
        startedAt,
        channels: {},
        errors: []
      };

      let masterResult = null;

      try {
        masterResult = await productMatching.syncMasterFromBenimpos();
        summary.master = masterResult;
      } catch (error) {
        summary.errors.push({ step: 'master', error: error.message || String(error) });
      }

      if (stockAutoSync) {
        try {
          summary.stockAutoSync = await stockAutoSync.runAutoStockSync(false, { skipMasterSync: true });
        } catch (error) {
          summary.errors.push({ step: 'stock_auto_sync', error: error.message || String(error) });
        }
      }

      for (const channelId of settings.channels) {
        try {
          const matchingEnabled = isProductMatchingEnabled(platformEnv);
          if (channelId === 'uber-eats') {
            const steps = catalogStepsForChannel(channelId, {
              uberIncludeOrders: settings.uberIncludeOrders,
              matchingEnabled
            }).filter((step) => step !== 'master');

            summary.channels[channelId] = await uberOps.runOpsPipeline({
              steps,
              stopOnError: false
            });
          } else {
            const catalogOpts = channelId === 'yemeksepeti'
              ? { maxPages: YEMEKSEPETI_SCHEDULED_CATALOG_MAX_PAGES }
              : {};
            const steps = catalogStepsForChannel(channelId, { matchingEnabled })
              .filter((step) => step !== 'master');
            summary.channels[channelId] = await channelMatchingOps.runOpsPipeline(channelId, {
              steps,
              stopOnError: false,
              catalog: catalogOpts
            });
          }
        } catch (error) {
          summary.errors.push({ channelId, error: error.message || String(error) });
          summary.channels[channelId] = { ok: false, error: error.message || String(error) };
        }
      }

      summary.finishedAt = new Date().toISOString();
      summary.ok = summary.errors.length === 0
        && Object.values(summary.channels).every((row) => row?.ok !== false);

      db.matchingSyncSchedule.lastRunAt = summary.finishedAt;
      db.matchingSyncSchedule.lastRunOk = summary.ok;
      db.matchingSyncSchedule.lastRunSummary = {
        channels: Object.keys(summary.channels),
        errors: summary.errors,
        master: masterResult
          ? { imported: masterResult.imported, added: masterResult.added, updated: masterResult.updated }
          : null
      };
      db.matchingSyncSchedule.lastError = summary.errors[0]?.error || null;
      db.meta = db.meta || {};
      db.meta.updatedAt = new Date().toISOString();
      await writeDb(db);

      try {
        summary.workbenchIndex = await productMatching.rebuildWorkbenchIndex?.();
      } catch (error) {
        summary.errors.push({ step: 'workbench-index', error: error.message || String(error) });
      }

      try {
        summary.autoCleanup = await productMatching.runPostSyncCleanup?.();
      } catch (error) {
        summary.errors.push({ step: 'auto_cleanup', error: error.message || String(error) });
      }

      log.info(`Zamanlanmış eşleştirme sync ${summary.ok ? 'tamamlandı' : 'uyarılarla bitti'} (${settings.channels.join(', ')})`);

      return { ok: summary.ok, ...summary };
    } catch (error) {
      const db = await readDb();
      ensureMatchingSyncState(db);
      db.matchingSyncSchedule.lastRunAt = new Date().toISOString();
      db.matchingSyncSchedule.lastRunOk = false;
      db.matchingSyncSchedule.lastError = error.message || String(error);
      await writeDb(db);
      throw error;
    } finally {
      runtime.matchingSyncRunning = false;
    }
  }

  function scheduleSync(runImmediately = false) {
    if (runtime.matchingSyncTimer) {
      clearInterval(runtime.matchingSyncTimer);
      runtime.matchingSyncTimer = null;
    }

    void (async () => {
      const platformEnv = await readEnvFile(paths.platformEnv);
      const db = await readDb();
      const settings = ensureMatchingSyncState(db, platformEnv);
      const intervalMs = settings.intervalMinutes * 60 * 1000;

      if (runImmediately && settings.enabled) {
        runScheduledSync(true).catch((error) => {
          log.error(`Eşleştirme sync ilk çalıştırma hatası: ${error.message}`);
        });
      }

      if (!settings.enabled) return;

      runtime.matchingSyncTimer = setInterval(() => {
        runScheduledSync(false).catch((error) => {
          log.error(`Eşleştirme sync periyodik hata: ${error.message}`);
        });
      }, intervalMs);

      log.info(`Ürün eşleştirme otomatik sync aktif (${settings.intervalMinutes} dk · ${settings.channels.join(', ')})`);
    })();
  }

  return {
    getSettings,
    saveSettings,
    runScheduledSync,
    scheduleSync
  };
}
