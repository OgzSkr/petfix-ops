import { fetchWithTimeout } from '../http/fetch-timeout.js';

const TOKEN_URL = 'https://yemeksepeti.partner.deliveryhero.io/v2/oauth/token';

/** In-memory OAuth token cache (valid ~2h). */
const tokenCache = new Map();

function cacheKey(cfg) {
  return String(cfg.clientId || '').trim();
}

export async function getYemeksepetiAccessToken(cfg) {
  const clientId = String(cfg.clientId || '').trim();
  const clientSecret = String(cfg.clientSecret || '').trim();

  if (!clientId || !clientSecret) {
    throw new Error('Yemeksepeti OAuth bilgileri eksik (CLIENT_ID / CLIENT_SECRET).');
  }

  const key = cacheKey(cfg);
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now() + 30_000) {
    return cached.accessToken;
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret
  });

  const response = await fetchWithTimeout(TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Yemeksepeti OAuth hatası: HTTP ${response.status} - ${text.slice(0, 300)}`);
  }

  const data = text ? JSON.parse(text) : {};
  const accessToken = String(data.access_token || '').trim();
  if (!accessToken) {
    throw new Error('Yemeksepeti OAuth yanıtında access_token yok.');
  }

  const ttlSeconds = Number(data.expires_in) || 7200;
  tokenCache.set(key, {
    accessToken,
    expiresAt: Date.now() + ttlSeconds * 1000
  });

  return accessToken;
}
