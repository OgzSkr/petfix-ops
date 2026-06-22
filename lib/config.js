import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { envValue } from './env.js';
import { PRODUCT_MATCHING_MODES } from './product-matching/mapping-types.js';
import {
  effectiveProductMatchingMode,
  isProductMatchingEnabled
} from './product-matching/matching-enabled.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

export const paths = {
  root: ROOT_DIR,
  public: path.join(ROOT_DIR, 'public'),
  db: path.join(ROOT_DIR, 'data', 'db.json'),
  sqlite: path.join(ROOT_DIR, 'data', 'platform.sqlite'),
  platformEnv: path.join(ROOT_DIR, process.env.PETFIX_ENV_FILE || '.env'),
  runtimeSecrets: path.join(ROOT_DIR, 'data', 'runtime-secrets.env')
};

export const limits = {
  manualRefreshCooldownMs: 45_000,
  cacheSyncCooldownMs: 30_000,
  ordersFetchCooldownMs: 90_000,
  getirLiveSyncCooldownMs: 120_000,
  orderChannelProductSyncCooldownMs: 300_000,
  dbReadMemoryCacheMs: 8_000
};

function envBool(processEnv, fileEnv, key, fallback = false) {
  const raw = envValue(processEnv, fileEnv, key, fallback ? 'true' : 'false');
  return String(raw).toLowerCase() === 'true' || raw === '1';
}

function buildChannelMatchingModeMap(processEnv, platformEnv) {
  const channels = [
    'uber-eats',
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
    panelAllowSimpleToken: envBool(process.env, platformEnv, 'PANEL_ALLOW_SIMPLE_TOKEN', false),
    sqliteDualWrite: envBool(process.env, platformEnv, 'SQLITE_DUAL_WRITE', true),
    dbReadBackend: envValue(process.env, platformEnv, 'DB_READ_BACKEND', 'json').toLowerCase(),
    productMatchingMode: effectiveProductMatchingMode(platformEnv, {
      globalMode: envValue(process.env, platformEnv, 'PRODUCT_MATCHING_MODE', 'legacy').toLowerCase()
    }),
    productMatchingEnabled: isProductMatchingEnabled(platformEnv, {
      globalMode: envValue(process.env, platformEnv, 'PRODUCT_MATCHING_MODE', 'legacy').toLowerCase()
    }),
    productMatchingModeByChannel: buildChannelMatchingModeMap(process.env, platformEnv),
    benimposSaleConfirmLevel: envValue(process.env, platformEnv, 'BENIMPOS_SALE_CONFIRM_LEVEL', '').toLowerCase()
  };
}
