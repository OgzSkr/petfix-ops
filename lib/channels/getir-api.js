/**
 * Getir Çarşı supplier API — Basic Auth token + Bearer sipariş sorguları.
 * Doküman: locals-integration-api-gateway (.artisandev = test, .artisan = canlı)
 */
import { isMissingConfigValue } from '../env.js';

const USER_AGENT = 'PetFix';
const DEFAULT_BASE_URL_DEV = 'https://locals-integration-api-gateway.artisandev.getirapi.com';
const DEFAULT_BASE_URL_PROD = 'https://locals-integration-api-gateway.artisan.getirapi.com';
const DEFAULT_TIMEOUT_MS = 25000;

export function resolveGetirApiConfig(input = {}) {
  const envMode = String(input.env || input.apiEnv || '').trim().toLowerCase();
  const defaultBase = envMode === 'prod' || envMode === 'production'
    ? DEFAULT_BASE_URL_PROD
    : DEFAULT_BASE_URL_DEV;
  const baseUrl = String(input.baseUrl || input.apiBaseUrl || defaultBase).trim().replace(/\/$/, '');
  const username = String(input.username || input.apiUsername || '').trim();
  const password = String(input.password || input.apiPassword || '').trim();
  const shopId = String(input.shopId || '').trim();
  const initialPassword = String(input.initialPassword || input.apiInitialPassword || '').trim();
  return { baseUrl, username, password, shopId, initialPassword };
}

export function isGetirApiConfigComplete(cfg) {
  const resolved = resolveGetirApiConfig(cfg);
  return Boolean(
    resolved.baseUrl &&
    resolved.username &&
    resolved.password &&
    resolved.shopId &&
    !isMissingConfigValue(resolved.password)
  );
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
        ...(options.headers || {})
      }
    });
    const text = await response.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    return { ok: response.ok, status: response.status, body, text };
  } finally {
    clearTimeout(timeout);
  }
}

function apiOk(body) {
  const code = String(body?.meta?.['return-code'] ?? body?.meta?.returnCode ?? '');
  return code === '0' || code === 'success';
}

function apiMessage(body) {
  return String(body?.meta?.['return-message'] ?? body?.meta?.returnMessage ?? '').trim();
}

function extractToken(body) {
  if (!body || typeof body !== 'object') return '';
  return String(body.data?.token || body.token || '').trim();
}

export async function resetGetirSupplierPassword(cfg, { oldPassword, newPassword } = {}) {
  const resolved = resolveGetirApiConfig(cfg);
  const result = await fetchJson(`${resolved.baseUrl}/v1/suppliers/password/reset`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: resolved.username,
      oldPassword: String(oldPassword || '').trim(),
      newPassword: String(newPassword || '').trim()
    })
  });
  if (!apiOk(result.body)) {
    throw new Error(apiMessage(result.body) || `Şifre sıfırlama HTTP ${result.status}`);
  }
  return { ok: true };
}

export async function loginGetirApi(cfg, options = {}) {
  const resolved = resolveGetirApiConfig(cfg);
  if (!resolved.username || !resolved.password) {
    throw new Error('Getir API kullanıcı adı ve şifre gerekli');
  }

  const attemptLogin = async (password) => {
    const basic = Buffer.from(`${resolved.username}:${password}`, 'utf8').toString('base64');
    return fetchJson(`${resolved.baseUrl}/v1/auth/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}` }
    });
  };

  let result = await attemptLogin(resolved.password);
  const message = apiMessage(result.body);

  if (!apiOk(result.body) && message.includes('password must be changed') && resolved.initialPassword) {
    await resetGetirSupplierPassword(resolved, {
      oldPassword: resolved.initialPassword,
      newPassword: resolved.password
    });
    result = await attemptLogin(resolved.password);
  }

  const token = extractToken(result.body);
  if (!apiOk(result.body) || !token) {
    throw new Error(apiMessage(result.body) || `Getir token HTTP ${result.status}`);
  }

  return {
    token,
    shopId: resolved.shopId,
    baseUrl: resolved.baseUrl,
  };
}

export async function fetchGetirDeliveredOrders(cfg, session, options = {}) {
  const resolved = resolveGetirApiConfig(cfg);
  const baseUrl = session?.baseUrl || resolved.baseUrl;
  const token = session?.token;
  const shopId = session?.shopId || resolved.shopId;
  if (!baseUrl || !token || !shopId) {
    throw new Error('Getir API oturumu veya shopId eksik');
  }

  const days = Math.max(1, Math.min(Number(options.days) || 14, 365));
  const endDate = options.endDate ? new Date(options.endDate) : new Date();
  const startDate = options.startDate
    ? new Date(options.startDate)
    : new Date(endDate.getTime() - days * 86400000);
  const pageSize = Math.max(1, Math.min(Number(options.pageSize) || 50, 50));
  const maxPages = Math.max(1, Math.min(Number(options.maxPages) || 100, 200));
  const orders = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const qs = new URLSearchParams({
      shopId,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      page: String(page),
      pageSize: String(pageSize)
    });
    const url = `${baseUrl}/v1/orders/delivered?${qs.toString()}`;
    const result = await fetchJson(url, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!apiOk(result.body)) {
      throw new Error(apiMessage(result.body) || `Getir delivered: HTTP ${result.status}`);
    }

    const batch = result.body?.data?.orders;
    if (!Array.isArray(batch) || !batch.length) break;
    orders.push(...batch);
    if (batch.length < pageSize) break;
  }

  return orders;
}

export async function fetchGetirShopProducts(cfg, session, options = {}) {
  const resolved = resolveGetirApiConfig(cfg);
  const baseUrl = session?.baseUrl || resolved.baseUrl;
  const token = session?.token;
  const shopId = session?.shopId || resolved.shopId;
  if (!baseUrl || !token || !shopId) {
    throw new Error('Getir API oturumu veya shopId eksik');
  }

  const pageSize = Math.max(1, Math.min(Number(options.pageSize) || 50, 50));
  const maxPages = Math.max(1, Math.min(Number(options.maxPages) || 200, 500));
  const products = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const qs = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize)
    });
    const url = `${baseUrl}/v1/shops/${encodeURIComponent(shopId)}/products?${qs.toString()}`;
    const result = await fetchJson(url, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!apiOk(result.body)) {
      throw new Error(apiMessage(result.body) || `Getir products: HTTP ${result.status}`);
    }

    const batch = result.body?.data?.data;
    if (!Array.isArray(batch) || !batch.length) break;
    products.push(...batch);
    const total = Number(result.body?.data?.totalCount) || 0;
    if (products.length >= total || batch.length < pageSize) break;
  }

  return products;
}

export async function updateGetirPriceAndQuantity(cfg, session, body) {
  const resolved = resolveGetirApiConfig(cfg);
  const baseUrl = session?.baseUrl || resolved.baseUrl;
  const token = session?.token;
  if (!baseUrl || !token) {
    throw new Error('Getir API oturumu eksik');
  }

  const result = await fetchJson(`${baseUrl}/v1/products/price-and-quantity`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!apiOk(result.body)) {
    throw new Error(apiMessage(result.body) || `Getir stok/fiyat: HTTP ${result.status}`);
  }

  return result.body?.data || result.body;
}

export async function fetchGetirPriceQuantityBatchResult(cfg, session, batchRequestId) {
  const resolved = resolveGetirApiConfig(cfg);
  const baseUrl = session?.baseUrl || resolved.baseUrl;
  const token = session?.token;
  if (!baseUrl || !token || !batchRequestId) {
    throw new Error('Getir batch sonucu için oturum ve batchRequestId gerekli');
  }

  const url = `${baseUrl}/v1/products/price-and-quantity/batch-requests/${encodeURIComponent(batchRequestId)}`;
  const result = await fetchJson(url, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!apiOk(result.body)) {
    throw new Error(apiMessage(result.body) || `Getir batch sonucu: HTTP ${result.status}`);
  }

  return result.body?.data || result.body;
}

export async function fetchGetirOrders(cfg, endpoint, session) {
  const resolved = resolveGetirApiConfig(cfg);
  const baseUrl = session?.baseUrl || resolved.baseUrl;
  const token = session?.token;
  const shopId = session?.shopId || resolved.shopId;
  if (!baseUrl || !token || !shopId) {
    throw new Error('Getir API oturumu veya shopId eksik');
  }

  const path = String(endpoint || 'unapproved').replace(/^\//, '');
  const url = `${baseUrl}/v1/orders/${path}?shopId=${encodeURIComponent(shopId)}`;
  const result = await fetchJson(url, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!apiOk(result.body)) {
    throw new Error(apiMessage(result.body) || `Getir ${path}: HTTP ${result.status}`);
  }

  const data = result.body?.data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.orders)) return data.orders;
  if (Array.isArray(result.body?.orders)) return result.body.orders;
  return [];
}

export async function probeGetirApi(cfg) {
  if (!isGetirApiConfigComplete(cfg)) {
    return {
      ok: false,
      message: 'Eksik alan: shopId, API base URL, kullanıcı adı ve şifre'
    };
  }

  try {
    const session = await loginGetirApi(cfg);
    const unapproved = await fetchGetirOrders(cfg, 'unapproved', session);
    const cancelled = await fetchGetirOrders(cfg, 'cancelled', session);
    return {
      ok: true,
      message: `API bağlantısı OK · ${unapproved.length} onay bekleyen, ${cancelled.length} iptal`,
      details: {
        shopId: session.shopId,
        unapprovedCount: unapproved.length,
        cancelledCount: cancelled.length,
        baseUrl: session.baseUrl
      }
    };
  } catch (error) {
    return { ok: false, message: error.message || 'Getir API bağlantı testi başarısız' };
  }
}
