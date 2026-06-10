import fs from 'node:fs/promises';
import path from 'node:path';
import { paths } from './config.js';
import {
  envValue,
  isMissingConfigValue,
  readEnvFile,
  serializeEnv,
  updateEnvFile
} from './env.js';

const TRENDYOL_CREDENTIAL_KEYS = [
  'TRENDYOL_SELLER_ID',
  'TRENDYOL_API_KEY',
  'TRENDYOL_API_SECRET',
  'TRENDYOL_INTEGRATOR_NAME',
  'TRENDYOL_ENVIRONMENT'
];

const TRENDYOL_RUNTIME_KEYS = [
  'POLL_INTERVAL_MS',
  'BATCH_SIZE',
  'GOOGLE_SCRIPT_WEBAPP_URL',
  'PLATFORM_WEBHOOK_URL',
  'LIVE_BUYBOX_WEBHOOK_SECRET',
  'BARCODES_FILE',
  'CACHE_FILE'
];

const TRENDYOL_ENV_KEYS = [...TRENDYOL_CREDENTIAL_KEYS, ...TRENDYOL_RUNTIME_KEYS];

function pickTrendyolValues(source = {}) {
  const values = {};
  for (const key of TRENDYOL_ENV_KEYS) {
    if (source[key] !== undefined) {
      values[key] = source[key];
    }
  }
  return values;
}

function resolveMergedValue(key, platformEnv, workerEnv) {
  const platformValue = platformEnv[key];
  if (!isMissingConfigValue(platformValue)) {
    return platformValue;
  }

  const workerValue = workerEnv[key];
  if (!isMissingConfigValue(workerValue)) {
    return workerValue;
  }

  return envValue(process.env, platformEnv, key, envValue(process.env, workerEnv, key, ''));
}

export async function readTrendyolEnv() {
  const platformEnv = await readEnvFile(paths.platformEnv);
  const workerEnv = await readEnvFile(paths.workerEnv);
  const merged = { ...workerEnv, ...platformEnv };

  for (const key of TRENDYOL_ENV_KEYS) {
    merged[key] = resolveMergedValue(key, platformEnv, workerEnv);
  }

  return merged;
}

export function trendyolCredentialsConfigured(env = {}) {
  return !isMissingConfigValue(env.TRENDYOL_SELLER_ID)
    && !isMissingConfigValue(env.TRENDYOL_API_KEY)
    && !isMissingConfigValue(env.TRENDYOL_API_SECRET);
}

export async function maybeMigrateTrendyolEnvToPlatform() {
  const platformEnv = await readEnvFile(paths.platformEnv);
  if (trendyolCredentialsConfigured(platformEnv)) {
    return false;
  }

  const workerEnv = await readEnvFile(paths.workerEnv);
  if (!trendyolCredentialsConfigured(workerEnv)) {
    return false;
  }

  await updateEnvFile(paths.platformEnv, pickTrendyolValues(workerEnv));
  return true;
}

async function workerDirExists() {
  try {
    await fs.access(paths.workerDir);
    return true;
  } catch {
    return false;
  }
}

async function syncTrendyolToWorkerEnv(updates) {
  if (!(await workerDirExists())) {
    return;
  }

  const existing = await readEnvFile(paths.workerEnv);
  const next = {
    ...existing,
    ...pickTrendyolValues(updates)
  };

  await fs.mkdir(path.dirname(paths.workerEnv), { recursive: true });
  await fs.writeFile(paths.workerEnv, serializeEnv(next), { encoding: 'utf8', mode: 0o600 });
}

export async function saveTrendyolEnv(updates) {
  const platformUpdates = pickTrendyolValues(updates);
  await updateEnvFile(paths.platformEnv, platformUpdates);
  await syncTrendyolToWorkerEnv(platformUpdates);
}
