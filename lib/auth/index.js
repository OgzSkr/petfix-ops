import { timingSafeEqual } from 'node:crypto';
import { readSessionCookie } from './session-cookie.js';

/** Zamanlama saldırılarına karşı sabit-zamanlı string karşılaştırma. */
export function safeTokenEqual(provided, expected) {
  const a = Buffer.from(String(provided ?? ''), 'utf8');
  const b = Buffer.from(String(expected ?? ''), 'utf8');
  if (a.length !== b.length || a.length === 0) {
    return false;
  }
  return timingSafeEqual(a, b);
}

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
    if (!safeTokenEqual(provided, token)) {
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
    if (!provided || !safeTokenEqual(provided, token)) {
      const error = new Error('Geçersiz token.');
      error.statusCode = 401;
      throw error;
    }

    return { ok: true, authRequired: true };
  }

  return {
    token,
    authRequired,
    isEnabled,
    mustAuthenticate,
    assertAuthorized,
    loginWithToken,
    readBearerToken
  };
}
