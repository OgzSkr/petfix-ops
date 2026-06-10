import {
  analyzeOrderPackages,
  fetchTrendyolOrders,
  filterRowsByOrderDate,
  formatOrderDate,
  nowTrendyolWallMs
} from './order-profitability.js';
import { buildLossOrderEmail, sendEmail } from './email-notify.js';

const MAX_SENT_KEYS = 5000;
const DEFAULT_ALERT_EMAIL = 'petfixltd@gmail.com';

export function orderAlertKey(row) {
  return `${row.orderNumber}|${row.shipmentPackageId || ''}`;
}

export function defaultLossOrderEmailSettings() {
  return {
    enabled: false,
    to: DEFAULT_ALERT_EMAIL,
    checkIntervalMinutes: 5,
    lookbackHours: 6,
    minLossAmount: 0
  };
}

export function normalizeLossOrderEmailSettings(input = {}) {
  const base = defaultLossOrderEmailSettings();
  return {
    enabled: Boolean(input.enabled),
    to: String(input.to || base.to).trim() || DEFAULT_ALERT_EMAIL,
    checkIntervalMinutes: Math.min(Math.max(Number(input.checkIntervalMinutes) || 5, 1), 60),
    lookbackHours: Math.min(Math.max(Number(input.lookbackHours) || 6, 1), 48),
    minLossAmount: Number(input.minLossAmount) || 0
  };
}

export function ensureAlertState(db) {
  if (!db.lossOrderEmail) {
    if (db.whatsapp) {
      db.lossOrderEmail = normalizeLossOrderEmailSettings({
        enabled: db.whatsapp.enabled,
        checkIntervalMinutes: db.whatsapp.checkIntervalMinutes,
        lookbackHours: db.whatsapp.lookbackHours,
        minLossAmount: db.whatsapp.minLossAmount
      });
    } else {
      db.lossOrderEmail = defaultLossOrderEmailSettings();
    }
  }

  if (!db.lossOrderAlerts) {
    db.lossOrderAlerts = {
      sentKeys: [],
      lastCheckAt: null,
      lastError: null,
      lastSentAt: null,
      sentCount: 0
    };
  }

  return db;
}

function isLossOrder(row, settings) {
  const profit = Number(row.netProfit);
  if (!Number.isFinite(profit) || profit >= 0) return false;
  const minLoss = Number(settings.minLossAmount) || 0;
  return Math.abs(profit) >= minLoss;
}

function recentRange(settings) {
  const endDate = nowTrendyolWallMs();
  const now = new Date(endDate);
  const dayEnd = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999);
  const lookbackHours = Number(settings.lookbackHours) || 6;
  return {
    startDate: endDate - lookbackHours * 60 * 60 * 1000,
    endDate: dayEnd
  };
}

export async function checkLossOrdersAndNotify({
  db,
  trendyolEnv,
  profitSettings,
  smtpConfig,
  writeDb,
  force = false
}) {
  ensureAlertState(db);
  const settings = normalizeLossOrderEmailSettings(db.lossOrderEmail);

  if (!settings.enabled && !force) {
    return { ok: true, skipped: true, reason: 'disabled', notified: [] };
  }

  const range = recentRange(settings);
  const packages = await fetchTrendyolOrders(trendyolEnv, { days: 1 });
  const analyzed = analyzeOrderPackages(packages, db, profitSettings);
  const rows = filterRowsByOrderDate(analyzed, range);
  const sentSet = new Set(db.lossOrderAlerts.sentKeys || []);
  const pending = [];

  for (const row of rows) {
    if (!isLossOrder(row, settings)) continue;
    const key = orderAlertKey(row);
    if (sentSet.has(key)) continue;
    pending.push({ ...row, orderDate: formatOrderDate(row.orderDateMs) });
  }

  pending.sort((a, b) => b.orderDateMs - a.orderDateMs);

  const notified = [];
  let lastError = null;

  for (const row of pending) {
    try {
      const mail = buildLossOrderEmail(row);
      await sendEmail(smtpConfig, {
        to: settings.to,
        subject: mail.subject,
        text: mail.text,
        html: mail.html
      });
      const key = orderAlertKey(row);
      sentSet.add(key);
      db.lossOrderAlerts.sentKeys = [...sentSet].slice(-MAX_SENT_KEYS);
      db.lossOrderAlerts.sentCount = Number(db.lossOrderAlerts.sentCount || 0) + 1;
      db.lossOrderAlerts.lastSentAt = new Date().toISOString();
      notified.push({ orderNumber: row.orderNumber, netProfit: row.netProfit });
    } catch (error) {
      lastError = error.message;
      break;
    }
  }

  db.lossOrderAlerts.lastCheckAt = new Date().toISOString();
  db.lossOrderAlerts.lastError = lastError;
  db.meta = db.meta || {};
  db.meta.updatedAt = new Date().toISOString();
  await writeDb(db);

  return {
    ok: !lastError,
    checked: rows.length,
    pending: pending.length,
    notified,
    lastError
  };
}

export async function sendLossOrderEmailTest(db, smtpConfig) {
  ensureAlertState(db);
  const settings = normalizeLossOrderEmailSettings(db.lossOrderEmail);
  const subject = 'BuyBox Platform test — zarar sipariş e-posta bildirimi';
  const text = 'BuyBox Platform test mesajı. Zarar sipariş bildirimleri bu adrese gelecek.';
  const html = `<p>${text}</p>`;

  await sendEmail(smtpConfig, {
    to: settings.to,
    subject,
    text,
    html
  });

  return { ok: true, message: `Test e-postası ${settings.to} adresine gönderildi.` };
}
