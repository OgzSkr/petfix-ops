import { readEnvFile, envValue } from '../../env.js';
import { paths } from '../../config.js';
import { createLogger } from '../../logger.js';
import { runDailySync } from '../../ops-hub/workers/daily-sync.js';
import { runOutboxRetry, getOutboxQueueSummary } from '../../ops-hub/workers/outbox-retry-worker.js';
import { getCatalogSyncHookState } from '../../runtime/catalog-sync-hooks.js';

const log = createLogger('WORKER-SCHEDULER');

const DEFAULT_OUTBOX_INTERVAL_MINUTES = 5;
const DEFAULT_DAILY_SYNC_HOUR = 3;

export function createWorkerScheduler({
  runtime,
  matchingSync,
  opsPollSync,
  stockAutoSync,
  getOpsPool
}) {
  async function readSchedulerEnv() {
    return readEnvFile(paths.platformEnv);
  }

  function outboxIntervalMs(platformEnv) {
    const minutes = Number(
      envValue(process.env, platformEnv, 'OUTBOX_RETRY_INTERVAL_MINUTES', String(DEFAULT_OUTBOX_INTERVAL_MINUTES))
    ) || DEFAULT_OUTBOX_INTERVAL_MINUTES;
    return Math.max(minutes, 1) * 60 * 1000;
  }

  function dailySyncEnabled(platformEnv) {
    const flag = String(
      envValue(process.env, platformEnv, 'DAILY_SYNC_SCHEDULED', 'false')
    ).toLowerCase();
    return flag === 'true' || flag === '1';
  }

  function scheduleDailySyncTimer(platformEnv) {
    if (runtime.dailySyncTimer) {
      clearInterval(runtime.dailySyncTimer);
      runtime.dailySyncTimer = null;
    }

    if (!dailySyncEnabled(platformEnv)) return;

    const targetHour = Number(
      envValue(process.env, platformEnv, 'DAILY_SYNC_HOUR', String(DEFAULT_DAILY_SYNC_HOUR))
    ) || DEFAULT_DAILY_SYNC_HOUR;

    const tick = () => {
      const now = new Date();
      if (now.getHours() !== targetHour) return;
      const dayKey = now.toISOString().slice(0, 10);
      if (runtime.dailySyncLastDay === dayKey) return;
      if (runtime.dailySyncRunning) return;

      runtime.dailySyncRunning = true;
      runtime.dailySyncLastDay = dayKey;
      runDailySync({ onStep: () => {} })
        .then((result) => {
          runtime.dailySyncLastRunAt = new Date().toISOString();
          runtime.dailySyncLastRunOk = result?.ok !== false;
          runtime.dailySyncLastError = null;
          log.info('Zamanlanmış daily sync tamamlandı');
        })
        .catch((error) => {
          runtime.dailySyncLastRunAt = new Date().toISOString();
          runtime.dailySyncLastRunOk = false;
          runtime.dailySyncLastError = error.message || String(error);
          log.error(`Daily sync hatası: ${error.message}`);
        })
        .finally(() => {
          runtime.dailySyncRunning = false;
        });
    };

    runtime.dailySyncTimer = setInterval(tick, 60 * 1000);
    log.info(`Daily sync zamanlayıcı aktif (saat ${targetHour}:00)`);
  }

  function scheduleOutboxRetry(platformEnv) {
    if (runtime.outboxRetryTimer) {
      clearInterval(runtime.outboxRetryTimer);
      runtime.outboxRetryTimer = null;
    }

    const pool = typeof getOpsPool === 'function' ? getOpsPool() : null;
    if (!pool) return;

    const intervalMs = outboxIntervalMs(platformEnv);
    runtime.outboxRetryTimer = setInterval(() => {
      runOutboxRetryWorker(false).catch((error) => {
        log.error(`Outbox retry periyodik hata: ${error.message}`);
      });
    }, intervalMs);

    log.info(`Outbox retry zamanlayıcı aktif (${Math.round(intervalMs / 60000)} dk)`);
  }

  async function runOutboxRetryWorker(force = false) {
    const pool = typeof getOpsPool === 'function' ? getOpsPool() : null;
    if (!pool) {
      return { ok: false, skipped: true, reason: 'no_pool' };
    }
    if (runtime.outboxRetryRunning && !force) {
      return { ok: true, skipped: true, reason: 'already_running' };
    }

    runtime.outboxRetryRunning = true;
    try {
      const platformEnv = await readSchedulerEnv();
      const report = await runOutboxRetry(pool, { platformEnv });
      runtime.outboxRetryLastRunAt = report.finishedAt || new Date().toISOString();
      runtime.outboxRetryLastRunOk = report.ok;
      runtime.outboxRetryLastReport = report;
      runtime.outboxRetryLastError = report.errors?.[0]?.error || null;
      return report;
    } catch (error) {
      runtime.outboxRetryLastRunAt = new Date().toISOString();
      runtime.outboxRetryLastRunOk = false;
      runtime.outboxRetryLastError = error.message || String(error);
      throw error;
    } finally {
      runtime.outboxRetryRunning = false;
    }
  }

  async function getStatus() {
    const platformEnv = await readSchedulerEnv();
    const matching = matchingSync ? await matchingSync.getSettings() : null;
    const opsPoll = opsPollSync ? await opsPollSync.getSettings() : null;
    const stock = stockAutoSync ? await stockAutoSync.getSettings() : null;

    let outbox = { pending: 0, failed: 0, processing: 0 };
    try {
      const pool = typeof getOpsPool === 'function' ? getOpsPool() : null;
      if (pool) outbox = await getOutboxQueueSummary(pool);
    } catch {
      outbox = { pending: 0, failed: 0, processing: 0 };
    }

    return {
      ok: true,
      catalogWebhook: getCatalogSyncHookState(),
      workers: {
        matchingSync: matching,
        opsPoll,
        stockAutoSync: stock,
        outboxRetry: {
          scheduled: Boolean(runtime.outboxRetryTimer),
          running: Boolean(runtime.outboxRetryRunning),
          lastRunAt: runtime.outboxRetryLastRunAt || null,
          lastRunOk: runtime.outboxRetryLastRunOk ?? null,
          lastError: runtime.outboxRetryLastError || null,
          queue: outbox
        },
        dailySync: {
          scheduled: Boolean(runtime.dailySyncTimer),
          enabled: dailySyncEnabled(platformEnv),
          running: Boolean(runtime.dailySyncRunning),
          lastRunAt: runtime.dailySyncLastRunAt || null,
          lastRunOk: runtime.dailySyncLastRunOk ?? null,
          lastError: runtime.dailySyncLastError || null
        }
      }
    };
  }

  async function startAll() {
    const platformEnv = await readSchedulerEnv();

    matchingSync?.scheduleSync?.(false);

    const pollEnabled = String(
      envValue(process.env, platformEnv, 'OPS_IN_PROCESS_POLL_ENABLED', 'false')
    ).toLowerCase();
    opsPollSync?.schedulePoll?.(pollEnabled === 'true' || pollEnabled === '1');

    const stockAutoEnabled = String(
      envValue(process.env, platformEnv, 'STOCK_AUTO_SYNC_ENABLED', 'false')
    ).toLowerCase();
    stockAutoSync?.schedule?.(stockAutoEnabled === 'true' || stockAutoEnabled === '1');

    scheduleOutboxRetry(platformEnv);
    scheduleDailySyncTimer(platformEnv);

    return getStatus();
  }

  return {
    getStatus,
    startAll,
    runOutboxRetryWorker,
    scheduleOutboxRetry,
    scheduleDailySyncTimer
  };
}
