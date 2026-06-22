import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function resolveRuntimeSecretsPath() {
  return process.env.RUNTIME_SECRETS_PATH
    || path.join(ROOT_DIR, 'data', 'runtime-secrets.env');
}

export async function readEnvFile(filePath) {
  const text = await fsPromises.readFile(filePath, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') {
      return '';
    }
    throw error;
  });

  return parseEnvText(text);
}

/** CLI scriptleri için .env değerlerini process.env'e yükler (mevcut değerleri ezmez). */
export function loadEnvFile(filePath) {
  let text = '';
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return {};
  }

  const values = parseEnvText(text);
  for (const [key, value] of Object.entries(values)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
  return values;
}

export function parseEnvText(text) {
  const values = {};

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) continue;

    values[trimmed.slice(0, separatorIndex).trim()] = trimmed.slice(separatorIndex + 1).trim();
  }

  return values;
}

export function serializeEnv(values) {
  const orderedKeys = [
    'TRENDYOL_SELLER_ID',
    'TRENDYOL_API_KEY',
    'TRENDYOL_API_SECRET',
    'TRENDYOL_INTEGRATOR_NAME',
    'TRENDYOL_ENVIRONMENT',
    'GOOGLE_SCRIPT_WEBAPP_URL',
    'PLATFORM_WEBHOOK_URL',
    'LIVE_BUYBOX_WEBHOOK_SECRET',
    'POLL_INTERVAL_MS',
    'BATCH_SIZE',
    'BARCODES_FILE',
    'CACHE_FILE',
    'HOST',
    'PORT',
    'PLATFORM_API_TOKEN',
    'UBER_EATS_SUPPLIER_ID',
    'UBER_EATS_INTEGRATION_REF',
    'UBER_EATS_API_KEY',
    'UBER_EATS_API_SECRET',
    'UBER_EATS_CHANNEL',
    'UBER_EATS_ENV',
    'YEMEKSEPETI_CHAIN_ID',
    'YEMEKSEPETI_VENDOR_ID',
    'YEMEKSEPETI_CLIENT_ID',
    'YEMEKSEPETI_CLIENT_SECRET',
    'DHL_API_CLIENT_ID',
    'DHL_API_CLIENT_SECRET',
    'DHL_CUSTOMER_NUMBER',
    'DHL_API_PASSWORD',
    'DHL_API_ENV',
    'SMTP_HOST',
    'SMTP_PORT',
    'SMTP_USER',
    'SMTP_PASS',
    'SMTP_FROM'
  ];

  const seen = new Set();
  const lines = [];

  for (const key of orderedKeys) {
    if (values[key] !== undefined) {
      lines.push(`${key}=${values[key]}`);
      seen.add(key);
    }
  }

  for (const [key, value] of Object.entries(values)) {
    if (!seen.has(key)) {
      lines.push(`${key}=${value}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

export function envValue(processEnv, fileEnv, key, fallback = '') {
  const fromProcess = processEnv?.[key];
  if (fromProcess !== undefined && fromProcess !== null && String(fromProcess).trim() !== '') {
    return fromProcess;
  }
  const fromFile = fileEnv?.[key];
  if (fromFile !== undefined && fromFile !== null && String(fromFile).trim() !== '') {
    return fromFile;
  }
  return fallback;
}

export function isMissingConfigValue(value) {
  if (!value) return true;
  return /^BURAYA_/i.test(String(value)) || /^YOUR_/i.test(String(value));
}

export function maskSecret(value) {
  const text = String(value || '');
  if (!text) return '';
  if (text.length <= 4) return '****';
  return `${text.slice(0, 2)}${'*'.repeat(Math.min(text.length - 4, 8))}${text.slice(-2)}`;
}

export function isMaskedValue(value) {
  return /\*/.test(String(value || ''));
}

/** .env.production + panelden yazılan data/runtime-secrets.env birleşimi (runtime öncelikli). */
export async function readPlatformConfigEnv(platformEnvPath) {
  const base = await readEnvFile(platformEnvPath);
  const runtime = await readEnvFile(resolveRuntimeSecretsPath());
  return { ...base, ...runtime };
}

/** Panel / runtime-secrets değerlerini process.env ile hizala (Docker env_file önceliğini düzeltir). */
export function applyPlatformEnvToProcess(values = {}) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;
    process.env[key] = String(value);
  }
}

/**
 * Panel ayar kaydı — önce ana env dosyası, read-only ise yalnızca runtime-secrets.
 */
export async function persistPlatformConfigUpdates(filePath, updates) {
  let wrotePrimary = false;

  try {
    await updateEnvFile(filePath, updates);
    wrotePrimary = true;
  } catch (error) {
    if (error.code !== 'EROFS' && error.code !== 'EPERM' && error.code !== 'EACCES') {
      throw error;
    }
  }

  await updateEnvFile(resolveRuntimeSecretsPath(), updates);
  applyPlatformEnvToProcess(updates);

  return { wrotePrimary, wroteRuntime: true };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Update keys in-place; keeps comments and unrelated lines intact. */
export async function updateEnvFile(filePath, updates) {
  let text = await fsPromises.readFile(filePath, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });

  for (const [key, value] of Object.entries(updates)) {
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${escapeRegExp(key)}=.*$`, 'm');

    if (pattern.test(text)) {
      text = text.replace(pattern, line);
    } else {
      text = text.trimEnd() + (text.endsWith('\n') || !text ? '' : '\n') + `\n# ${key}\n${line}\n`;
    }
  }

  await fsPromises.mkdir(path.dirname(filePath), { recursive: true }).catch(() => {});
  await fsPromises.writeFile(filePath, text.endsWith('\n') ? text : `${text}\n`, { encoding: 'utf8', mode: 0o600 });
}
