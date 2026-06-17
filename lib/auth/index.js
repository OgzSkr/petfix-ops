import { isMissingConfigValue } from '../env.js';
import { readTrendyolEnv } from '../trendyol-env.js';
import { readSessionCookie } from './session-cookie.js';

export function readBearerToken(request) {
  const header = String(request.headers.authorization || '');
  if (header.startsWith('Bearer ')) {
    return header.slice(7).trim();
  }
  return String(request.headers['x-platform-token'] || '').trim();
}

export function readProvidedAuthToken(request) {
  const bearer = readBearerToken(request);
  if (bearer) return bearer;
  return readSessionCookie(request);
}

export function createAuth(config) {
  const token = String(config.platformApiToken || '').trim();
  const authRequired = Boolean(config.authRequired);

  function isEnabled() {
    return authRequired && Boolean(token);
  }

  function mustAuthenticate() {
    return authRequired;
  }

  function assertAuthorized(request) {
    if (!authRequired) return;

    if (!token) {
      const error = new Error('PLATFORM_API_TOKEN tanımlı değil. Sunucu güvenli modda başlatılamaz.');
      error.statusCode = 503;
      throw error;
    }

    const provided = readProvidedAuthToken(request);
    if (provided !== token) {
      const error = new Error('Yetkisiz istek. /login üzerinden giriş yapın.');
      error.statusCode = 401;
      throw error;
    }
  }

  function loginWithToken(payload) {
    if (!authRequired) {
      return { ok: true, authRequired: false };
    }

    if (!token) {
      const error = new Error('PLATFORM_API_TOKEN yapılandırılmamış.');
      error.statusCode = 503;
      throw error;
    }

    const provided = String(payload?.token || '').trim();
    if (!provided || provided !== token) {
      const error = new Error('Geçersiz token.');
      error.statusCode = 401;
      throw error;
    }

    return { ok: true, authRequired: true };
  }

  async function assertWebhookAuthorized(request) {
    const env = await readTrendyolEnv();
    const expected = String(env.LIVE_BUYBOX_WEBHOOK_SECRET || '').trim();
    if (!expected || isMissingConfigValue(expected)) return;

    const provided = String(
      request.headers['x-webhook-secret'] ||
      request.headers['x-live-buybox-secret'] ||
      ''
    ).trim();

    if (!provided || provided !== expected) {
      const error = new Error('Webhook secret geçersiz.');
      error.statusCode = 401;
      throw error;
    }
  }

  return {
    token,
    authRequired,
    isEnabled,
    mustAuthenticate,
    assertAuthorized,
    loginWithToken,
    assertWebhookAuthorized,
    readBearerToken
  };
}
