import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function signServiceAccountJwt(serviceAccount) {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(JSON.stringify({
    iss: serviceAccount.client_email,
    sub: serviceAccount.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/firebase.messaging'
  }));
  const unsigned = `${header}.${payload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(serviceAccount.private_key, 'base64url');
  return `${unsigned}.${signature}`;
}

export async function getFcmV1AccessToken(serviceAccount) {
  const assertion = signServiceAccountJwt(serviceAccount);
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`FCM OAuth token alınamadı: ${response.status} ${text}`);
  }
  const data = await response.json();
  return data.access_token;
}

export function loadServiceAccount(platformEnv = {}) {
  const inline = String(
    platformEnv.FCM_SERVICE_ACCOUNT_JSON ||
      process.env.FCM_SERVICE_ACCOUNT_JSON ||
      ''
  ).trim();
  if (inline) {
    return JSON.parse(inline);
  }

  const path = String(
    platformEnv.FCM_SERVICE_ACCOUNT_PATH ||
      process.env.FCM_SERVICE_ACCOUNT_PATH ||
      ''
  ).trim();
  if (path) {
    return JSON.parse(readFileSync(path, 'utf8'));
  }
  return null;
}
