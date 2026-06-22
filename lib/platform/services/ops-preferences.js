import { readPlatformConfigEnv, readEnvFile, envValue, persistPlatformConfigUpdates } from '../../env.js';
import { paths } from '../../config.js';
import { isOpsProductionLive, resolveOpsHubConfig } from '../../ops-hub/config.js';
import { OPS_FEATURE_FLAGS } from '../../ops-hub/constants.js';
import { isBenimposAutoSaleEnabled } from '../../ops-hub/benimpos/sale-outbox.js';
import { resolveStockAutoSyncSettings } from './stock-auto-sync.js';

function envBool(processEnv, fileEnv, key, fallback = false) {
  const raw = envValue(processEnv, fileEnv, key, fallback ? 'true' : 'false');
  return String(raw).toLowerCase() === 'true' || raw === '1';
}

function resolvePreferences(platformEnv = {}) {
  const opsConfig = resolveOpsHubConfig(platformEnv);
  const pollEnabled = envBool(process.env, platformEnv, 'OPS_IN_PROCESS_POLL_ENABLED', false);
  const stockAutoSync = resolveStockAutoSyncSettings(platformEnv);

  return {
    benimposAutoSale: isBenimposAutoSaleEnabled(platformEnv),
    shadowModeDefault: opsConfig.shadowModeDefault,
    benimposSaleWrite: opsConfig.flags.FF_BENIMPOS_SALE_WRITE === true,
    channelStatusWrite: opsConfig.flags.FF_CHANNEL_STATUS_WRITE === true,
    stockPush: opsConfig.flags.FF_STOCK_PUSH === true,
    stockAutoSyncEnabled: stockAutoSync.enabled,
    stockAutoSyncIntervalMinutes: stockAutoSync.intervalMinutes,
    pollEnabled
  };
}

export function createOpsPreferencesService({ opsPollSync, stockAutoSync } = {}) {
  async function getPreferences() {
    const platformEnv = await readPlatformConfigEnv(paths.platformEnv);
    const preferences = resolvePreferences(platformEnv);
    const poll = opsPollSync ? await opsPollSync.getSettings() : null;
    const stockAuto = stockAutoSync ? await stockAutoSync.getSettings() : null;

    return {
      preferences,
      poll: poll
        ? {
            intervalMinutes: poll.settings?.intervalMinutes ?? 2,
            scheduled: Boolean(poll.scheduled),
            lastRunAt: poll.lastRunAt || null,
            lastRunOk: poll.lastRunOk ?? null
          }
        : null,
      stockAutoSync: stockAuto
        ? {
            intervalMinutes: stockAuto.settings?.intervalMinutes ?? 15,
            scheduled: Boolean(stockAuto.scheduled),
            running: Boolean(stockAuto.running),
            lastRunAt: stockAuto.lastRunAt || null,
            lastRunOk: stockAuto.lastRunOk ?? null,
            lastError: stockAuto.lastError || null
          }
        : null,
      effective: {
        liveWrites: !preferences.shadowModeDefault,
        benimposSaleLive:
          !preferences.shadowModeDefault
          && preferences.benimposSaleWrite
          && preferences.benimposAutoSale,
        stockAutoSyncLive:
          !preferences.shadowModeDefault
          && preferences.stockPush
          && preferences.stockAutoSyncEnabled
      }
    };
  }

  async function savePreferences(payload = {}) {
    const platformEnv = await readPlatformConfigEnv(paths.platformEnv);
    const current = resolvePreferences(platformEnv);
    let shadowMode = payload.shadowModeDefault != null
      ? (payload.shadowModeDefault === true || payload.shadowModeDefault === 'true')
      : current.shadowModeDefault;
    if (isOpsProductionLive()) {
      shadowMode = false;
    }

    const updates = {};

    if (payload.benimposAutoSale != null) {
      updates.BENIMPOS_AUTO_SALE = payload.benimposAutoSale === true || payload.benimposAutoSale === 'true'
        ? 'true'
        : 'false';
    }
    if (payload.shadowModeDefault != null) {
      if (isOpsProductionLive()) {
        updates.OPS_SHADOW_MODE_DEFAULT = 'false';
      } else {
        updates.OPS_SHADOW_MODE_DEFAULT = shadowMode ? 'true' : 'false';
      }
    }

    if (payload.shadowModeDefault != null || payload.benimposAutoSale != null) {
      const liveSaleWrite = isOpsProductionLive() || !shadowMode;
      updates.FF_BENIMPOS_SALE_WRITE = liveSaleWrite ? 'true' : 'false';
    }
    if (payload.channelStatusWrite != null) {
      updates.FF_CHANNEL_STATUS_WRITE = payload.channelStatusWrite === true || payload.channelStatusWrite === 'true'
        ? 'true'
        : 'false';
    }
    if (payload.stockPush != null) {
      updates.FF_STOCK_PUSH = payload.stockPush === true || payload.stockPush === 'true'
        ? 'true'
        : 'false';
    }
    if (payload.stockAutoSyncEnabled != null) {
      updates.STOCK_AUTO_SYNC_ENABLED = payload.stockAutoSyncEnabled === true || payload.stockAutoSyncEnabled === 'true'
        ? 'true'
        : 'false';
    }
    if (payload.stockAutoSyncIntervalMinutes != null) {
      updates.STOCK_AUTO_SYNC_INTERVAL_MINUTES = String(
        Math.max(5, Number(payload.stockAutoSyncIntervalMinutes) || 15)
      );
    }

    if (Object.keys(updates).length) {
      await persistPlatformConfigUpdates(paths.platformEnv, updates);
    }

    if (payload.pollEnabled != null && opsPollSync) {
      await opsPollSync.saveSettings({ enabled: payload.pollEnabled === true || payload.pollEnabled === 'true' });
    }

    if ((payload.stockAutoSyncEnabled != null || payload.stockAutoSyncIntervalMinutes != null) && stockAutoSync) {
      await stockAutoSync.saveSettings({
        enabled: payload.stockAutoSyncEnabled,
        intervalMinutes: payload.stockAutoSyncIntervalMinutes
      });
    }

    return getPreferences();
  }

  return {
    getPreferences,
    savePreferences,
    resolvePreferences,
    OPS_FEATURE_FLAGS
  };
}
