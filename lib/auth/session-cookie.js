const COOKIE_NAME = 'pf_platform_token';

export function parseCookieHeader(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    out[key] = decodeURIComponent(value);
  }
  return out;
}

export function readSessionCookie(request) {
  return String(parseCookieHeader(request.headers.cookie)[COOKIE_NAME] || '').trim();
}

export function buildSessionCookie(token, { secure = true } = {}) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=86400'
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookie({ secure = true } = {}) {
  const parts = [
    `${COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=0'
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function isSecureRequest(request) {
  const forwarded = String(request.headers['x-forwarded-proto'] || '').toLowerCase();
  if (forwarded === 'https') return true;
  return String(process.env.NODE_ENV || '').toLowerCase() === 'production';
}
