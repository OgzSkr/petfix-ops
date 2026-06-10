import { spawn } from 'node:child_process';
import { paths, limits } from '../../config.js';
import { readJsonFile } from '../../db/store.js';
import {
  isMaskedValue,
  isMissingConfigValue,
  readEnvFile
} from '../../env.js';
import {
  maybeMigrateTrendyolEnvToPlatform,
  readTrendyolEnv,
  saveTrendyolEnv
} from '../../trendyol-env.js';
import { createLogger } from '../../logger.js';
import { toNumber, toPositiveInteger } from '../../utils.js';
import {
  liveStatusDetail,
  liveStatusLabel,
  readableCredentialName
} from '../views/format.js';

const log = createLogger('WORKER');

function requiredPayloadValue(value, label) {
  const text = String(value || '').trim();

  if (!text || isMissingConfigValue(text)) {
    throw new Error(`${label} zorunludur.`);
  }

  return text;
}

function safeVisibleValue(value) {
  return isMissingConfigValue(value) ? '' : String(value || '');
}

function trimLogLine(chunk) {
  return String(chunk || '').trim().split(/\r?\n/).slice(-1)[0] || '';
}

export function createWorkerService({ runtime, config }) {
  async function buildLiveStatus() {
    await maybeMigrateTrendyolEnvToPlatform();
    const env = await readTrendyolEnv();
    const cache = await readJsonFile(paths.buyboxCache, null);
    const missingCredentials = [
      ['TRENDYOL_SELLER_ID', env.TRENDYOL_SELLER_ID],
      ['TRENDYOL_API_KEY', env.TRENDYOL_API_KEY],
      ['TRENDYOL_API_SECRET', env.TRENDYOL_API_SECRET]
    ].filter(([, value]) => isMissingConfigValue(value)).map(([key]) => key);
    const updatedAt = cache?.updatedAt || '';
    const ageSeconds = updatedAt ? Math.round((Date.now() - new Date(updatedAt).getTime()) / 1000) : null;
    const cacheItemCount = Array.isArray(cache?.items) ? cache.items.length : 0;
    const configured = missingCredentials.length === 0;
    const live = configured && ageSeconds !== null && ageSeconds <= 90;

    return {
      configured,
      live,
      workerRunning: Boolean(runtime.workerProcess),
      workerStartedAt: runtime.workerStartedAt,
      workerLastLog: runtime.workerLastLog,
      missingCredentials,
      cacheItemCount,
      totalTrackedBarcodeCount: cache?.totalTrackedBarcodeCount || 0,
      lastBatch: cache?.lastBatch || [],
      updatedAt,
      ageSeconds,
      pollIntervalMs: toNumber(env.POLL_INTERVAL_MS) || 1000,
      batchSize: toNumber(env.BATCH_SIZE) || 10,
      platformWebhookUrl: env.PLATFORM_WEBHOOK_URL || ''
    };
  }

  async function getTrendyolSettings() {
    await maybeMigrateTrendyolEnvToPlatform();
    const env = await readTrendyolEnv();
    const apiKey = safeVisibleValue(env.TRENDYOL_API_KEY);
    const apiSecret = safeVisibleValue(env.TRENDYOL_API_SECRET);

    return {
      sellerId: safeVisibleValue(env.TRENDYOL_SELLER_ID),
      apiKey: '',
      apiKeyConfigured: !isMissingConfigValue(apiKey),
      apiSecret: '',
      apiSecretConfigured: !isMissingConfigValue(apiSecret),
      integratorName: env.TRENDYOL_INTEGRATOR_NAME || 'SelfIntegration',
      environment: env.TRENDYOL_ENVIRONMENT || 'PROD',
      pollIntervalMs: env.POLL_INTERVAL_MS || '1000',
      batchSize: env.BATCH_SIZE || '10'
    };
  }

  async function saveTrendyolSettings(payload) {
    const existing = await readTrendyolEnv();
    const apiKeyInput = String(payload.apiKey || '').trim();
    const apiSecretInput = String(payload.apiSecret || '').trim();
    const nextApiKey = isMaskedValue(apiKeyInput) || !apiKeyInput
      ? existing.TRENDYOL_API_KEY
      : apiKeyInput;
    const nextApiSecret = !apiSecretInput || isMaskedValue(apiSecretInput)
      ? existing.TRENDYOL_API_SECRET
      : apiSecretInput;

    await saveTrendyolEnv({
      TRENDYOL_SELLER_ID: requiredPayloadValue(payload.sellerId, 'Satıcı ID'),
      TRENDYOL_API_KEY: requiredPayloadValue(nextApiKey, 'API Key'),
      TRENDYOL_API_SECRET: requiredPayloadValue(nextApiSecret, 'API Secret'),
      TRENDYOL_INTEGRATOR_NAME: payload.integratorName || existing.TRENDYOL_INTEGRATOR_NAME || 'SelfIntegration',
      TRENDYOL_ENVIRONMENT: payload.environment === 'STAGE' ? 'STAGE' : 'PROD',
      POLL_INTERVAL_MS: String(Math.max(toPositiveInteger(payload.pollIntervalMs, 1000), limits.minWorkerPollMs)),
      BATCH_SIZE: String(Math.min(toPositiveInteger(payload.batchSize, 10), 10))
    });

    return {
      ok: true,
      status: await buildLiveStatus()
    };
  }

  async function startWorker() {
    if (runtime.workerProcess) {
      return { ok: true, running: true, message: 'Worker zaten çalışıyor.' };
    }

    const status = await buildLiveStatus();

    if (!status.configured) {
      return {
        ok: false,
        running: false,
        message: `Eksik bilgi: ${status.missingCredentials.map(readableCredentialName).join(', ')}`
      };
    }

    runtime.workerLastLog = '';
    runtime.workerStartedAt = new Date().toISOString();
    runtime.workerProcess = spawn(process.execPath, ['src/index.js'], {
      cwd: paths.workerDir,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    runtime.workerProcess.stdout.on('data', (chunk) => {
      runtime.workerLastLog = trimLogLine(chunk);
      log.info(`[WORKER] ${runtime.workerLastLog}`);
    });
    runtime.workerProcess.stderr.on('data', (chunk) => {
      runtime.workerLastLog = trimLogLine(chunk);
      log.error(`[WORKER] ${runtime.workerLastLog}`);
    });
    runtime.workerProcess.on('exit', (code) => {
      runtime.workerLastLog = `Worker durdu. Kod: ${code}`;
      runtime.workerProcess = null;
      runtime.workerStartedAt = '';
    });

    return { ok: true, running: true, message: 'Worker başlatıldı.' };
  }

  function stopWorker() {
    if (!runtime.workerProcess) {
      return { ok: true, running: false, message: 'Worker zaten kapalı.' };
    }

    runtime.workerProcess.kill('SIGTERM');
    runtime.workerProcess = null;
    runtime.workerStartedAt = '';
    runtime.workerLastLog = 'Worker durduruldu.';
    return { ok: true, running: false, message: 'Worker durduruldu.' };
  }

  return {
    buildLiveStatus,
    getTrendyolSettings,
    saveTrendyolSettings,
    startWorker,
    stopWorker,
    liveStatusDetail,
    liveStatusLabel
  };
}

export async function fetchTrendyolBuybox(barcodes) {
  const env = await readTrendyolEnv();
  const sellerId = requiredPayloadValue(env.TRENDYOL_SELLER_ID, 'Satıcı ID');
  const apiKey = requiredPayloadValue(env.TRENDYOL_API_KEY, 'API Key');
  const apiSecret = requiredPayloadValue(env.TRENDYOL_API_SECRET, 'API Secret');
  const integratorName = env.TRENDYOL_INTEGRATOR_NAME || 'SelfIntegration';
  const baseUrl = env.TRENDYOL_ENVIRONMENT === 'STAGE'
    ? 'https://stageapigw.trendyol.com/integration/product/sellers'
    : 'https://apigw.trendyol.com/integration/product/sellers';
  const response = await fetch(`${baseUrl}/${encodeURIComponent(sellerId)}/products/buybox-information`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`,
      'User-Agent': `${sellerId} - ${integratorName}`,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ barcodes })
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Trendyol BuyBox hatası: HTTP ${response.status} - ${text.slice(0, 300)}`);
  }

  const data = text ? JSON.parse(text) : {};
  return data.buyboxInfo || [];
}
