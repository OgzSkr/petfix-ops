import { encryptJson, decryptJson, readEncryptionKey, shouldUseEncryptedChannelSecrets } from '../../crypto/secrets.js';
import { SECRET_FIELDS } from './config-bridge.js';

const EXTRA_SECRET_FIELDS = ['apiInitialPassword', 'apiPassword', 'password'];

export function listSecretFieldNames() {
  return [...SECRET_FIELDS, ...EXTRA_SECRET_FIELDS.filter((f) => !SECRET_FIELDS.has(f))];
}

export function splitSecretsFromConfig(config = {}) {
  const secrets = {};
  const publicConfig = { ...config };
  for (const field of listSecretFieldNames()) {
    const value = String(publicConfig[field] ?? '').trim();
    if (value) {
      secrets[field] = publicConfig[field];
      delete publicConfig[field];
    }
  }
  return { secrets, publicConfig };
}

export function mergeSecretsIntoConfig(publicConfig = {}, secrets = {}) {
  if (!secrets || typeof secrets !== 'object') {
    return { ...publicConfig };
  }
  return { ...publicConfig, ...secrets };
}

export function encryptChannelSecrets(secrets, platformEnv = null) {
  if (!secrets || !Object.keys(secrets).length) {
    return null;
  }
  if (!shouldUseEncryptedChannelSecrets(platformEnv)) {
    return null;
  }
  const key = readEncryptionKey(platformEnv);
  return encryptJson(secrets, key);
}

export function decryptChannelSecrets(ciphertext, platformEnv = null) {
  if (!ciphertext) {
    return {};
  }
  const key = readEncryptionKey(platformEnv);
  if (!key) {
    return {};
  }
  try {
    const decrypted = decryptJson(ciphertext, key);
    return decrypted && typeof decrypted === 'object' ? decrypted : {};
  } catch {
    return {};
  }
}

export function prepareConfigForStorage(config = {}, existingCiphertext = null, platformEnv = null) {
  const { secrets, publicConfig } = splitSecretsFromConfig(config);
  if (!shouldUseEncryptedChannelSecrets(platformEnv)) {
    return { config: { ...publicConfig, ...secrets }, secretsCiphertext: null };
  }

  const existingSecrets = decryptChannelSecrets(existingCiphertext, platformEnv);
  const mergedSecrets = { ...existingSecrets, ...secrets };
  const ciphertext = Object.keys(mergedSecrets).length
    ? encryptChannelSecrets(mergedSecrets, platformEnv)
    : existingCiphertext;

  return {
    config: publicConfig,
    secretsCiphertext: ciphertext
  };
}

export function hydrateStoredChannelConfig(row, platformEnv = null) {
  if (!row) return null;
  const publicConfig = row.config_json || row.config || {};
  const secrets = decryptChannelSecrets(row.secrets_ciphertext, platformEnv);
  const config = mergeSecretsIntoConfig(publicConfig, secrets);
  return {
    ...row,
    config_json: config,
    config
  };
}
