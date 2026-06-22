/**
 * BenimPOS master stok → kanal menüleri otomatik senkronu.
 */
import { readPlatformConfigEnv, envValue, persistPlatformConfigUpdates } from '../../env.js';
import { paths } from '../../config.js';
import { createLogger } from '../../logger.js';
import { OPS_CHANNELS } from '../../ops-hub/constants.js';
import { bootstrapOpsHub, getOpsHubPool, isOpsHubReady } from '../../ops-hub/bootstrap.js';
import { runStockSync } from '../../ops-hub/stock/stock-sync-service.js';

const log = createLogger('STOCK-AUTO-SYNC');

function envBool(processEnv, fileEnv, key, fallback = false) {
  const raw = envValue(processEnv, fileEnv, key, fallback ? 'true' : 'false');
  return String(raw).toLowerCase() === 'true' || raw === '1';
}

export function resolveStockAutoSyncSettings(platformEnv = {}) {
  const intervalRaw = envValue(process.env, platformEnv, 'STOCK_AUTO_SYNC_INTERVAL_MINUTES', '15');
  const maxItemsRaw = envValue(process.env, platformEnv, 'STOCK_AUTO_SYNC_MAX_ITEMS', '500');

  return {
    enabled: envBool(process.env, platformEnv, 'STOCK_AUTO_SYNC_ENABLED', false),
    intervalMinutes: Math.max(5, Number(intervalRaw) || 15),
    maxItemsPerChannel: Math.max(1, Number(maxItemsRaw) || 500)
  };
}

export function createStockAutoSyncService({ runtime, productMatching } = {}) {
  async function getSettings() {
    const platformEnv = await readPlatformConfigEnv(paths.platformEnv);
    const settings = resolveStockAutoSyncSettings(platformEnv);
    return {
      settings,
      scheduled: Boolean(runtime.stockAutoSyncTimer),
      running: Boolean(runtime.stockAutoSyncRunning),
      lastRunAt: runtime.stockAutoSyncLastRunAt || null,
      lastRunOk: runtime.stockAutoSyncLastRunOk ?? null,
      lastError: runtime.stockAutoSyncLastError || null,
      lastReport: runtime.stockAutoSyncLastReport || null
    };
  }

  async function saveSettings(payload = {}) {
    const updates = {};
    if (payload.enabled != null) {
      updates.STOCK_AUTO_SYNC_ENABLED = payload.enabled === true || payload.enabled === 'true'
        ? 'true'
        : 'false';
    }
    if (payload.intervalMinutes != null) {
      updates.STOCK_AUTO_SYNC_INTERVAL_MINUTES = String(
        Math.max(5, Number(payload.intervalMinutes) || 15)
      );
    }
    if (Object.keys(updates).length) {
      await persistPlatformConfigUpdates(paths.platformEnv, updates);
    }

    if (payload.enabled != null) {
      schedule(payload.enabled === true || payload.enabled === 'true');
    }

    return getSettings();
  }

  async function runAutoStockSync(force = false, options = {}) {
    if (runtime.stockAutoSyncRunning) {
      return { ok: true, skipped: true, reason: 'already_running' };
    }

    const platformEnv = await readPlatformConfigEnv(paths.platformEnv);
    const settings = resolveStockAutoSyncSettings(platformEnv);
    if (!settings.enabled && !force) {
      return { ok: true, skipped: true, reason: 'disabled' };
    }

    runtime.stockAutoSyncRunning = true;
    const startedAt = new Date().toISOString();
    const report = { startedAt, channels: {}, masterSync: null, errors: [] };

    try {
      if (!isOpsHubReady()) {
        await bootstrapOpsHub(platformEnv);
      }
      if (!isOpsHubReady()) {
        throw new Error('Ops Hub hazır değil — stok gönderimi için PostgreSQL gerekli');
      }

      if (options.skipMasterSync !== true && productMatching?.syncMasterFromBenimpos) {
        try {
          report.masterSync = await productMatching.syncMasterFromBenimpos();
        } catch (error) {
          report.errors.push({ step: 'master_sync', error: error.message || String(error) });
        }
      }

      const pool = getOpsHubPool();
      for (const opsChannel of OPS_CHANNELS) {
        try {
          const result = await runStockSync(pool, {
            channel: opsChannel,
            platformEnv,
            mode: 'stock',
            autoStockEligibleOnly: true,
            minCoveragePercent: 0,
            maxItems: settings.maxItemsPerChannel
          });
          report.channels[opsChannel] = {
            ok: true,
            dryRun: result.dryRun,
            pushCount: result.plan?.summary?.pushCount ?? 0,
            message: result.message
          };
        } catch (error) {
          report.channels[opsChannel] = { ok: false, error: error.message || String(error) };
          report.errors.push({ step: opsChannel, error: error.message || String(error) });
        }
      }

      runtime.stockAutoSyncLastRunAt = new Date().toISOString();
      runtime.stockAutoSyncLastRunOk = report.errors.length === 0;
      runtime.stockAutoSyncLastError = report.errors[0]?.error || null;
      runtime.stockAutoSyncLastReport = {
        startedAt: report.startedAt,
        finishedAt: runtime.stockAutoSyncLastRunAt,
        channels: Object.keys(report.channels)
      };

      if (report.errors.length) {
        log.warn(`Otomatik stok senkronu tamamlandı (hatalı): ${report.errors.map((e) => e.error).join(' · ')}`);
      }

      return { ok: report.errors.length === 0, report };
    } catch (error) {
      runtime.stockAutoSyncLastRunAt = new Date().toISOString();
      runtime.stockAutoSyncLastRunOk = false;
      runtime.stockAutoSyncLastError = error.message || String(error);
      throw error;
    } finally {
      runtime.stockAutoSyncRunning = false;
    }
  }

  function schedule(runImmediately = false) {
    if (runtime.stockAutoSyncTimer) {
      clearInterval(runtime.stockAutoSyncTimer);
      runtime.stockAutoSyncTimer = null;
    }

    void (async () => {
      const platformEnv = await readPlatformConfigEnv(paths.platformEnv);
      const settings = resolveStockAutoSyncSettings(platformEnv);
      const intervalMs = settings.intervalMinutes * 60 * 1000;

      if (runImmediately && settings.enabled) {
        runAutoStockSync(true, { skipMasterSync: false }).catch((error) => {
          log.error(`Otomatik stok ilk çalıştırma hatası: ${error.message}`);
        });
      }

      if (!settings.enabled) return;

      runtime.stockAutoSyncTimer = setInterval(() => {
        runAutoStockSync(false).catch((error) => {
          log.error(`Otomatik stok periyodik hata: ${error.message}`);
        });
      }, intervalMs);

      log.info(`BenimPOS → kanal otomatik stok aktif (${settings.intervalMinutes} dk)`);
    })();
  }

  return {
    getSettings,
    saveSettings,
    runAutoStockSync,
    schedule,
    resolveStockAutoSyncSettings
  };
}
