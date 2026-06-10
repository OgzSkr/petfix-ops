import { getSmtpConfig } from '../../config.js';
import { readDb, writeDb } from '../../db/store.js';
import {
  checkLossOrdersAndNotify,
  ensureAlertState,
  normalizeLossOrderEmailSettings,
  sendLossOrderEmailTest
} from '../../loss-order-monitor.js';
import { smtpIsConfigured } from '../../email-notify.js';
import { readTrendyolEnv } from '../../trendyol-env.js';
import { profitAnalysisSettings } from '../../profit-constants.js';
import { createLogger } from '../../logger.js';

const log = createLogger('EMAIL');

export function createEmailService({ runtime, platformEnv }) {
  async function runLossOrderMonitor(force = false) {
    if (runtime.lossOrderMonitorRunning) {
      return { ok: true, skipped: true, reason: 'already_running' };
    }

    runtime.lossOrderMonitorRunning = true;

    try {
      const db = await readDb();
      ensureAlertState(db);
      if (!db.lossOrderEmail?.enabled && !force) {
        return { ok: true, skipped: true, reason: 'disabled' };
      }

      const trendyolEnv = await readTrendyolEnv();
      return await checkLossOrdersAndNotify({
        db,
        trendyolEnv,
        profitSettings: profitAnalysisSettings(),
        smtpConfig: getSmtpConfig(platformEnv),
        writeDb,
        force
      });
    } catch (error) {
      const db = await readDb();
      ensureAlertState(db);
      db.lossOrderAlerts.lastCheckAt = new Date().toISOString();
      db.lossOrderAlerts.lastError = error.message;
      await writeDb(db);
      throw error;
    } finally {
      runtime.lossOrderMonitorRunning = false;
    }
  }

  function scheduleMonitor(runImmediately = false) {
    if (runtime.lossOrderMonitorTimer) {
      clearInterval(runtime.lossOrderMonitorTimer);
      runtime.lossOrderMonitorTimer = null;
    }

    void (async () => {
      const db = await readDb();
      ensureAlertState(db);
      const settings = normalizeLossOrderEmailSettings(db.lossOrderEmail);
      const intervalMs = settings.checkIntervalMinutes * 60 * 1000;

      if (runImmediately && settings.enabled) {
        runLossOrderMonitor().catch((error) => {
          log.error(`E-posta ilk kontrol hatası: ${error.message}`);
        });
      }

      runtime.lossOrderMonitorTimer = setInterval(() => {
        runLossOrderMonitor().catch((error) => {
          log.error(`E-posta periyodik kontrol hatası: ${error.message}`);
        });
      }, intervalMs);

      if (settings.enabled) {
        log.info(`Zarar sipariş e-postası aktif (${settings.checkIntervalMinutes} dk → ${settings.to})`);
      }
    })();
  }

  async function getEmailSettings() {
    const db = await readDb();
    ensureAlertState(db);
    const settings = normalizeLossOrderEmailSettings(db.lossOrderEmail);
    const smtp = getSmtpConfig(platformEnv);
    return {
      settings,
      smtpConfigured: smtpIsConfigured(smtp),
      smtpFrom: smtp.from || smtp.user || '',
      alerts: db.lossOrderAlerts
    };
  }

  async function saveEmailSettings(payload) {
    const db = await readDb();
    ensureAlertState(db);
    const existing = normalizeLossOrderEmailSettings(db.lossOrderEmail);
    const next = normalizeLossOrderEmailSettings({
      ...existing,
      enabled: payload.enabled === true || payload.enabled === 'true',
      to: payload.to,
      checkIntervalMinutes: payload.checkIntervalMinutes,
      lookbackHours: payload.lookbackHours,
      minLossAmount: payload.minLossAmount
    });

    db.lossOrderEmail = next;
    db.meta = db.meta || {};
    db.meta.updatedAt = new Date().toISOString();
    await writeDb(db);
    scheduleMonitor(next.enabled);

    return getEmailSettings();
  }

  async function testEmailNotification() {
    const db = await readDb();
    ensureAlertState(db);
    return sendLossOrderEmailTest(db, getSmtpConfig(platformEnv));
  }

  return {
    runLossOrderMonitor,
    scheduleMonitor,
    getEmailSettings,
    saveEmailSettings,
    testEmailNotification
  };
}
