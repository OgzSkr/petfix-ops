import { timingSafeEqual } from 'node:crypto';

export function extractBearerToken(authorizationHeader) {
  const value = String(authorizationHeader || '').trim();
  if (!value.toLowerCase().startsWith('bearer ')) {
    return '';
  }
  return value.slice(7).trim();
}

export function extractBasicToken(authorizationHeader) {
  const value = String(authorizationHeader || '').trim();
  if (!value.toLowerCase().startsWith('basic ')) {
    return '';
  }
  const encoded = value.slice(6).trim();
  if (!encoded) {
    return '';
  }
  try {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const colon = decoded.indexOf(':');
    if (colon >= 0) {
      return decoded.slice(colon + 1).trim();
    }
    return decoded.trim();
  } catch {
    return '';
  }
}

/** YS portal secret alanına "Basic …" olarak yapıştırılan değer (partner:secret). */
export function buildYemeksepetiPortalWebhookSecret(rawSecret, username = 'petfix') {
  const secret = String(rawSecret || '').trim();
  if (!secret) {
    return '';
  }
  const encoded = Buffer.from(`${username}:${secret}`, 'utf8').toString('base64');
  return `Basic ${encoded}`;
}

function readHeader(request, name) {
  if (!request?.headers) {
    return '';
  }
  if (typeof request.headers.get === 'function') {
    return String(request.headers.get(name) || '').trim();
  }
  const headers = request.headers;
  return String(headers[name] || headers[name.toLowerCase()] || '').trim();
}

export function verifyWebhookSecret(provided, expected) {
  const left = String(provided || '').trim();
  const right = String(expected || '').trim();
  if (!left || !right) {
    return false;
  }
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

export function resolveWebhookSecretFromRequest(request) {
  const authHeader =
    readHeader(request, 'authorization') || readHeader(request, 'Authorization');
  const bearer = extractBearerToken(authHeader);
  if (bearer) {
    return bearer;
  }
  const basic = extractBasicToken(authHeader);
  if (basic) {
    return basic;
  }
  return (
    readHeader(request, 'x-webhook-secret') ||
    readHeader(request, 'X-Webhook-Secret') ||
    readHeader(request, 'x-petfix-webhook-secret') ||
    readHeader(request, 'X-Petfix-Webhook-Secret')
  );
}

export function isWebhookVerificationDisabled(platformEnv = {}) {
  const raw =
    platformEnv.OPS_WEBHOOK_VERIFY_DISABLED ||
    process.env.OPS_WEBHOOK_VERIFY_DISABLED ||
    'false';
  return String(raw).toLowerCase() === 'true' || raw === '1';
}
