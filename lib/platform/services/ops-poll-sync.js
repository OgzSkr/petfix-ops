/**
 * Ops Hub kanal poll in-process zamanlayıcısı.
 *
 * matching-sync.js deseniyle hizalı: env ile açılır, setInterval ile periyodik
 * runOpsPoll çağırır. Production'da systemd/cron yanında veya yerine kullanılabilir.
 */
import { readPlatformConfigEnv, envValue, persistPlatformConfigUpdates } from '../../env.js';
import { paths } from '../../config.js';
import { createLogger } from '../../logger.js';
import { runOpsPoll } from '../../ops-hub/workers/poll-worker.js';
import { activityEventsFromPollReport } from './ops-activity-feed.js';

const log = createLogger('OPS-POLL-SYNC');

function resolvePollSettings(platformEnv = {}) {
  const enabledRaw = envValue(process.env, platformEnv, 'OPS_IN_PROCESS_POLL_ENABLED', 'false');
  const intervalRaw = envValue(process.env, platformEnv, 'OPS_IN_PROCESS_POLL_INTERVAL_MINUTES', '2');
  const ysDaysRaw = envValue(process.env, platformEnv, 'OPS_IN_PROCESS_POLL_YS_DAYS', '14');
  const tgoLimitRaw = envValue(process.env, platformEnv, 'OPS_IN_PROCESS_POLL_TGO_LIMIT', '50');
  const getirDaysRaw = envValue(process.env, platformEnv, 'OPS_IN_PROCESS_POLL_GETIR_DAYS', '1');

  return {
    enabled: enabledRaw === true || enabledRaw === 'true' || enabledRaw === '1',
    intervalMinutes: Math.max(1, Number(intervalRaw) || 2),
    ysDays: Math.max(1, Number(ysDaysRaw) || 14),
    tgoLimit: Math.max(1, Number(tgoLimitRaw) || 50),
    getirDays: Math.max(0, Number(getirDaysRaw) || 0)
  };
}

export function createOpsPollSyncService({ runtime, opsActivityFeed }) {
  async function getSettings() {
    const platformEnv = await readPlatformConfigEnv(paths.platformEnv);
    const settings = resolvePollSettings(platformEnv);
    return {
      settings,
      scheduled: Boolean(runtime.opsPollTimer),
      running: Boolean(runtime.opsPollRunning),
      lastRunAt: runtime.opsPollLastRunAt || null,
      lastRunOk: runtime.opsPollLastRunOk ?? null,
      lastError: runtime.opsPollLastError || null
    };
  }

  async function saveSettings(payload = {}) {
    const updates = {};
    if (payload.enabled != null) {
      updates.OPS_IN_PROCESS_POLL_ENABLED = payload.enabled === true || payload.enabled === 'true' ? 'true' : 'false';
    }
    if (payload.intervalMinutes != null) {
      updates.OPS_IN_PROCESS_POLL_INTERVAL_MINUTES = String(Math.max(1, Number(payload.intervalMinutes) || 2));
    }
    if (payload.ysDays != null) {
      updates.OPS_IN_PROCESS_POLL_YS_DAYS = String(Math.max(1, Number(payload.ysDays) || 14));
    }
    if (payload.tgoLimit != null) {
      updates.OPS_IN_PROCESS_POLL_TGO_LIMIT = String(Math.max(1, Number(payload.tgoLimit) || 50));
    }
    if (payload.getirDays != null) {
      updates.OPS_IN_PROCESS_POLL_GETIR_DAYS = String(Math.max(0, Number(payload.getirDays) || 0));
    }
    if (Object.keys(updates).length) {
      await persistPlatformConfigUpdates(paths.platformEnv, updates);
    }
    schedulePoll(Boolean(payload.enabled));
    return getSettings();
  }

  async function runPoll(force = false) {
    if (runtime.opsPollRunning) {
      return { ok: true, skipped: true, reason: 'already_running' };
    }

    const platformEnv = await readPlatformConfigEnv(paths.platformEnv);
    const settings = resolvePollSettings(platformEnv);
    if (!settings.enabled && !force) {
      return { ok: true, skipped: true, reason: 'disabled' };
    }

    runtime.opsPollRunning = true;
    const startedAt = new Date().toISOString();

    try {
      const report = await runOpsPoll({
        platformEnv,
        ysDays: settings.ysDays,
        tgoLimit: settings.tgoLimit,
        getirDays: settings.getirDays,
        activeOnly: true
      });

      runtime.opsPollLastRunAt = report.finishedAt || new Date().toISOString();
      runtime.opsPollLastRunOk = report.ok;
      runtime.opsPollLastError = report.errors?.[0] || null;
      runtime.opsPollLastReport = {
        startedAt: report.startedAt,
        finishedAt: report.finishedAt,
        channels: Object.keys(report.channels || {})
      };

      if (opsActivityFeed) {
        opsActivityFeed.appendMany(activityEventsFromPollReport(report));
      }

      if (!report.ok) {
        log.warn(`Ops poll tamamlandı (hatalı): ${(report.errors || []).join(' · ')}`);
      }

      return { ok: report.ok, startedAt, report };
    } catch (error) {
      runtime.opsPollLastRunAt = new Date().toISOString();
      runtime.opsPollLastRunOk = false;
      runtime.opsPollLastError = error.message || String(error);
      throw error;
    } finally {
      runtime.opsPollRunning = false;
    }
  }

  function schedulePoll(runImmediately = false) {
    if (runtime.opsPollTimer) {
      clearInterval(runtime.opsPollTimer);
      runtime.opsPollTimer = null;
    }

    void (async () => {
      const platformEnv = await readPlatformConfigEnv(paths.platformEnv);
      const settings = resolvePollSettings(platformEnv);
      const intervalMs = settings.intervalMinutes * 60 * 1000;

      if (runImmediately && settings.enabled) {
        runPoll(true).catch((error) => {
          log.error(`Ops poll ilk çalıştırma hatası: ${error.message}`);
        });
      }

      if (!settings.enabled) return;

      runtime.opsPollTimer = setInterval(() => {
        runPoll(false).catch((error) => {
          log.error(`Ops poll periyodik hata: ${error.message}`);
        });
      }, intervalMs);

      log.info(`Ops kanal poll in-process aktif (${settings.intervalMinutes} dk · TGO+YS+Getir)`);
    })();
  }

  return {
    getSettings,
    saveSettings,
    runPoll,
    schedulePoll
  };
}
