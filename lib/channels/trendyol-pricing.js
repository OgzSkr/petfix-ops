import { readEnvFile, isMissingConfigValue } from '../env.js';
import { readTrendyolEnv } from '../trendyol-env.js';

function requiredValue(value, label) {
  const text = String(value || '').trim();
  if (!text || isMissingConfigValue(text)) {
    throw new Error(`${label} zorunludur. Ayarlar → Trendyol API bilgilerini kontrol edin.`);
  }
  return text;
}

export async function readTrendyolPricingConfig(envFile = null) {
  const env = envFile ? await readEnvFile(envFile) : await readTrendyolEnv();
  const sellerId = requiredValue(env.TRENDYOL_SELLER_ID, 'Trendyol Satıcı ID');
  const apiKey = requiredValue(env.TRENDYOL_API_KEY, 'Trendyol API Key');
  const apiSecret = requiredValue(env.TRENDYOL_API_SECRET, 'Trendyol API Secret');
  const integratorName = env.TRENDYOL_INTEGRATOR_NAME || 'SelfIntegration';
  const isStage = env.TRENDYOL_ENVIRONMENT === 'STAGE';
  const apiRoot = isStage
    ? 'https://stageapigw.trendyol.com/integration'
    : 'https://apigw.trendyol.com/integration';

  return {
    sellerId,
    apiKey,
    apiSecret,
    integratorName,
    apiRoot
  };
}

function authHeaders(config) {
  return {
    Authorization: `Basic ${Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString('base64')}`,
    'User-Agent': `${config.sellerId} - ${config.integratorName}`,
    Accept: 'application/json',
    'Content-Type': 'application/json'
  };
}

export async function updateTrendyolPriceAndInventory(config, items) {
  if (!Array.isArray(items) || !items.length) {
    throw Object.assign(new Error('Gönderilecek ürün yok.'), { statusCode: 400 });
  }
  if (items.length > 1000) {
    throw Object.assign(new Error('Tek seferde en fazla 1000 ürün gönderilebilir.'), { statusCode: 400 });
  }

  const response = await fetch(
    `${config.apiRoot}/inventory/sellers/${encodeURIComponent(config.sellerId)}/products/price-and-inventory`,
    {
      method: 'POST',
      headers: authHeaders(config),
      body: JSON.stringify({ items })
    }
  );

  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const message = data?.errors?.[0]?.message || data?.message || data?.error || text.slice(0, 300);
    throw Object.assign(new Error(`Trendyol fiyat güncelleme hatası: HTTP ${response.status} — ${message}`), {
      statusCode: response.status,
      details: data
    });
  }

  return {
    batchRequestId: data.batchRequestId || '',
    raw: data
  };
}

export async function fetchTrendyolBatchResult(config, batchRequestId) {
  if (!batchRequestId) {
    throw Object.assign(new Error('batchRequestId gerekli.'), { statusCode: 400 });
  }

  const response = await fetch(
    `${config.apiRoot}/product/sellers/${encodeURIComponent(config.sellerId)}/products/batch-requests/${encodeURIComponent(batchRequestId)}`,
    { headers: authHeaders(config) }
  );

  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const message = data?.errors?.[0]?.message || data?.message || text.slice(0, 300);
    throw Object.assign(new Error(`Trendyol batch sonucu alınamadı: HTTP ${response.status} — ${message}`), {
      statusCode: response.status,
      details: data
    });
  }

  return data;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
