import { envValue } from '../env.js';

const CRITICAL_KEYS = [
  { key: 'OPS_POSTGRES_URL', label: 'PostgreSQL bağlantı URL' },
  { key: 'PLATFORM_API_TOKEN', label: 'Platform API token' },
  { key: 'OPS_PUBLIC_API_BASE_URL', label: 'Public API base URL' }
];

const CHANNEL_KEYS = {
  yemeksepeti: [
    { key: 'YEMEKSEPETI_CLIENT_ID', label: 'Yemeksepeti client ID' },
    { key: 'YEMEKSEPETI_CLIENT_SECRET', label: 'Yemeksepeti client secret' },
    { key: 'YEMEKSEPETI_VENDOR_ID', label: 'Yemeksepeti vendor ID' }
  ]
};

function read(processEnv, fileEnv, key) {
  return String(envValue(processEnv, fileEnv, key, '') || '').trim();
}

function isPlaceholder(value) {
  if (!value) return true;
  const upper = value.toUpperCase();
  return (
    upper.includes('DEGISTIR')
    || upper.includes('CHANGE_ME')
    || upper === 'REPLACE_ME'
    || value === 'your-secret-here'
  );
}

/**
 * Production başlangıcında kritik yapılandırma eksikse process'i durdurur.
 * @throws {Error}
 */
export function validateProductionConfig(platformEnv = {}, processEnv = process.env) {
  const nodeEnv = read(processEnv, platformEnv, 'NODE_ENV').toLowerCase();
  if (nodeEnv !== 'production') {
    return { ok: true, skipped: true };
  }

  const missing = [];
  const invalid = [];

  for (const { key, label } of CRITICAL_KEYS) {
    const value = read(processEnv, platformEnv, key);
    if (!value) {
      missing.push(`${label} (${key})`);
    } else if (key === 'PLATFORM_API_TOKEN' && value.length < 24) {
      const allowSimple = read(processEnv, platformEnv, 'PANEL_ALLOW_SIMPLE_TOKEN').toLowerCase();
      if (allowSimple !== 'true' && allowSimple !== '1') {
        invalid.push(`${label} çok kısa (min 24 karakter)`);
      }
    } else if (key === 'OPS_PUBLIC_API_BASE_URL' && !/^https:\/\//i.test(value)) {
      invalid.push(`${label} https:// ile başlamalı`);
    }
  }

  // Production'da webhook doğrulaması kapatılamaz (bkz. isWebhookVerificationDisabled),
  // bu yüzden secret her zaman zorunludur — disable flag muafiyeti yoktur.
  const webhookSecret = read(processEnv, platformEnv, 'YEMEKSEPETI_WEBHOOK_SECRET');
  if (!webhookSecret) {
    missing.push('Yemeksepeti webhook secret (YEMEKSEPETI_WEBHOOK_SECRET)');
  }

  for (const [channel, keys] of Object.entries(CHANNEL_KEYS)) {
    const anySet = keys.some(({ key }) => read(processEnv, platformEnv, key));
    if (!anySet) continue;
    for (const { key, label } of keys) {
      const value = read(processEnv, platformEnv, key);
      if (!value || isPlaceholder(value)) {
        missing.push(`${channel}: ${label} (${key})`);
      }
    }
  }

  const encryptionKey = read(processEnv, platformEnv, 'ENCRYPTION_KEY');
  if (encryptionKey && encryptionKey.length < 32) {
    invalid.push('ENCRYPTION_KEY en az 32 karakter olmalı');
  }

  if (missing.length || invalid.length) {
    const parts = [];
    if (missing.length) parts.push(`Eksik: ${missing.join('; ')}`);
    if (invalid.length) parts.push(`Geçersiz: ${invalid.join('; ')}`);
    const error = new Error(`Production yapılandırması tamamlanmadı — ${parts.join(' | ')}`);
    error.code = 'PRODUCTION_CONFIG_INVALID';
    throw error;
  }

  return { ok: true };
}

export function listCriticalConfigPresence(platformEnv = {}, processEnv = process.env) {
  return CRITICAL_KEYS.map(({ key }) => ({
    key,
    present: Boolean(read(processEnv, platformEnv, key))
  }));
}
