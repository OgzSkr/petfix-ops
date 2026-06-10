import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { envValue } from './env.js';
import { PRODUCT_MATCHING_MODES } from './product-matching/mapping-types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

export const paths = {
  root: ROOT_DIR,
  public: path.join(ROOT_DIR, 'public'),
  db: path.join(ROOT_DIR, 'data', 'db.json'),
  sqlite: path.join(ROOT_DIR, 'data', 'platform.sqlite'),
  buyboxHistory: path.join(ROOT_DIR, 'data', 'buybox-history.jsonl'),
  buyboxHistoryArchive: path.join(ROOT_DIR, 'data', 'archive'),
  platformEnv: path.join(ROOT_DIR, process.env.PETFIX_ENV_FILE || '.env'),
  workerDir: path.resolve(ROOT_DIR, '..', 'live-buybox-worker'),
  workerEnv: path.resolve(ROOT_DIR, '..', 'live-buybox-worker', '.env'),
  buyboxCache: path.resolve(ROOT_DIR, '..', 'live-buybox-worker', 'buybox-cache.json'),
  autoTrackBarcodes: path.resolve(ROOT_DIR, '..', 'live-buybox-worker', 'critical-barcodes.txt')
};

export const limits = {
  manualRefreshCooldownMs: 45_000,
  cacheSyncCooldownMs: 30_000,
  ordersFetchCooldownMs: 60_000,
  minWorkerPollMs: 2000,
  buyboxHistoryMaxLines: 50_000,
  buyboxHistoryArchiveDays: 30,
  buyboxAnalyticsDefaultDays: 14
};

function envBool(processEnv, fileEnv, key, fallback = false) {
  const raw = envValue(processEnv, fileEnv, key, fallback ? 'true' : 'false');
  return String(raw).toLowerCase() === 'true' || raw === '1';
}

function buildChannelMatchingModeMap(processEnv, platformEnv) {
  const channels = [
    'uber-eats',
    'trendyol-marketplace',
    'woocommerce',
    'getir',
    'yemeksepeti'
  ];
  const map = {};
  for (const channelId of channels) {
    const envKey = `PRODUCT_MATCHING_MODE_${channelId.toUpperCase().replace(/-/g, '_')}`;
    const value = String(envValue(processEnv, platformEnv, envKey, '') || '').trim().toLowerCase();
    if (PRODUCT_MATCHING_MODES.includes(value)) {
      map[channelId] = value;
    }
  }
  return map;
}

export function resolveRuntimeConfig(platformEnv = {}) {
  const nodeEnv = envValue(process.env, platformEnv, 'NODE_ENV', 'development');
  const allowInsecure = envBool(process.env, platformEnv, 'AUTH_ALLOW_INSECURE', false);

  return {
    host: envValue(process.env, platformEnv, 'HOST', '127.0.0.1'),
    port: Number(envValue(process.env, platformEnv, 'PORT', '8787')),
    nodeEnv,
    allowInsecure,
    authRequired: !allowInsecure,
    platformApiToken: envValue(process.env, platformEnv, 'PLATFORM_API_TOKEN', '').trim(),
    sqliteDualWrite: envBool(process.env, platformEnv, 'SQLITE_DUAL_WRITE', true),
    dbReadBackend: envValue(process.env, platformEnv, 'DB_READ_BACKEND', 'json').toLowerCase(),
    productMatchingMode: envValue(process.env, platformEnv, 'PRODUCT_MATCHING_MODE', 'legacy').toLowerCase(),
    productMatchingModeByChannel: buildChannelMatchingModeMap(process.env, platformEnv),
    benimposSaleConfirmLevel: envValue(process.env, platformEnv, 'BENIMPOS_SALE_CONFIRM_LEVEL', '').toLowerCase()
  };
}

export function getSmtpConfig(platformEnv = {}) {
  return {
    host: envValue(process.env, platformEnv, 'SMTP_HOST', 'smtp.gmail.com'),
    port: Number(envValue(process.env, platformEnv, 'SMTP_PORT', '587')),
    user: envValue(process.env, platformEnv, 'SMTP_USER', 'petfixltd@gmail.com'),
    pass: envValue(process.env, platformEnv, 'SMTP_PASS', ''),
    from: envValue(process.env, platformEnv, 'SMTP_FROM', envValue(process.env, platformEnv, 'SMTP_USER', 'petfixltd@gmail.com'))
  };
}
