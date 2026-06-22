import crypto from 'node:crypto';
import { envValue } from '../env.js';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const PREFIX = 'v1:';

function deriveKey(rawKey) {
  return crypto.createHash('sha256').update(String(rawKey), 'utf8').digest();
}

export function isEncryptionAvailable(platformEnv = null) {
  const key = envValue(process.env, platformEnv, 'ENCRYPTION_KEY', '');
  return Boolean(String(key).trim().length >= 32);
}

export function readEncryptionKey(platformEnv = null) {
  const key = envValue(process.env, platformEnv, 'ENCRYPTION_KEY', '');
  return String(key).trim().length >= 32 ? String(key).trim() : '';
}

export function encryptJson(payload, encryptionKey) {
  if (!encryptionKey || encryptionKey.length < 32) {
    throw new Error('ENCRYPTION_KEY en az 32 karakter olmalı');
  }
  const key = deriveKey(encryptionKey);
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload ?? {}), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${Buffer.concat([iv, tag, encrypted]).toString('base64')}`;
}

export function decryptJson(ciphertext, encryptionKey) {
  if (!ciphertext || typeof ciphertext !== 'string' || !ciphertext.startsWith(PREFIX)) {
    return null;
  }
  if (!encryptionKey || encryptionKey.length < 32) {
    throw new Error('ENCRYPTION_KEY en az 32 karakter olmalı');
  }
  const raw = Buffer.from(ciphertext.slice(PREFIX.length), 'base64');
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(IV_LEN, IV_LEN + 16);
  const encrypted = raw.subarray(IV_LEN + 16);
  const key = deriveKey(encryptionKey);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8'));
}

export function shouldUseEncryptedChannelSecrets(platformEnv = null) {
  const explicit = envValue(process.env, platformEnv, 'CHANNEL_SECRETS_ENCRYPTED', '');
  if (explicit === true || explicit === 'true' || explicit === '1') return true;
  if (explicit === false || explicit === 'false' || explicit === '0') return false;
  return isEncryptionAvailable(platformEnv);
}
