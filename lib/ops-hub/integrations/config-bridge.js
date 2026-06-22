import { readEnvFile } from '../../env.js';
import { paths } from '../../config.js';
import { isMissingConfigValue, envValue } from '../../env.js';
import { defaultChannelConfig } from '../domain/branch-channel-config.js';
import { isGetirApiConfigComplete } from '../../channels/getir-api.js';

const SECRET_FIELDS = new Set(['apiSecret', 'clientSecret', 'webhookSecret', 'apiKey', 'apiPassword', 'password']);

export { SECRET_FIELDS };

export const MASKED_SECRET = '********';

export async function loadPlatformEnv() {
  return readEnvFile(paths.platformEnv);
}

export function envFallbackForChannel(channel, env = {}) {
  if (channel === 'trendyol_go') {
    return {
      sellerId: env.UBER_EATS_SUPPLIER_ID || env.TRENDYOL_SELLER_ID || '',
      apiKey: env.UBER_EATS_API_KEY || env.TRENDYOL_API_KEY || '',
      apiSecret: env.UBER_EATS_API_SECRET || env.TRENDYOL_API_SECRET || '',
      storeId: env.UBER_EATS_STORE_ID || '',
      autoAcceptOrders: false
    };
  }
  if (channel === 'yemeksepeti') {
    return {
      clientId: envValue(process.env, env, 'YEMEKSEPETI_CLIENT_ID'),
      clientSecret: envValue(process.env, env, 'YEMEKSEPETI_CLIENT_SECRET'),
      vendorId: envValue(process.env, env, 'YEMEKSEPETI_VENDOR_ID'),
      storeId: envValue(process.env, env, 'YEMEKSEPETI_STORE_ID'),
      externalPartnerConfigId: envValue(process.env, env, 'YEMEKSEPETI_EXTERNAL_PARTNER_CONFIG_ID'),
      chainId: envValue(process.env, env, 'YEMEKSEPETI_CHAIN_ID'),
      webhookSecret: envValue(process.env, env, 'YEMEKSEPETI_WEBHOOK_SECRET'),
      autoAcceptOrders: false
    };
  }
  if (channel === 'getir') {
    return {
      shopId: env.GETIR_SHOP_ID || '',
      apiUsername: env.GETIR_API_USERNAME || '',
      apiPassword: env.GETIR_API_PASSWORD || '',
      apiInitialPassword: env.GETIR_API_INITIAL_PASSWORD || '',
      apiBaseUrl: env.GETIR_API_BASE_URL || '',
      apiEnv: env.GETIR_API_ENV || 'dev',
      webhookSecret: env.GETIR_WEBHOOK_SECRET || '',
      autoAcceptOrders: false
    };
  }
  return defaultChannelConfig(channel);
}

export function mergeChannelConfig(channel, storedConfig = {}, envFallback = {}) {
  return {
    ...defaultChannelConfig(channel),
    ...envFallback,
    ...(storedConfig && typeof storedConfig === 'object' ? storedConfig : {})
  };
}

export function maskChannelConfigSecrets(config = {}) {
  const masked = { ...config };
  for (const key of Object.keys(masked)) {
    if (SECRET_FIELDS.has(key) && String(masked[key] || '').trim()) {
      masked[key] = MASKED_SECRET;
    }
  }
  return masked;
}

export function applySecretPreservation(incoming = {}, existing = {}) {
  const merged = { ...incoming };
  for (const field of SECRET_FIELDS) {
    const value = String(incoming[field] ?? '').trim();
    if (!value || value === MASKED_SECRET) {
      if (existing[field]) {
        merged[field] = existing[field];
      } else {
        delete merged[field];
      }
    }
  }
  return merged;
}

export function branchConfigToTgoCfg(config = {}) {
  const apiKey = String(config.apiKey || '').trim();
  const apiSecret = String(config.apiSecret || '').trim();
  return {
    supplierId: String(config.sellerId || '').trim(),
    storeId: String(config.storeId || '').trim(),
    apiKey,
    apiSecret,
    integrationRef: '',
    environment: 'PROD',
    authToken: apiKey && apiSecret ? Buffer.from(`${apiKey}:${apiSecret}`).toString('base64') : ''
  };
}

export function branchConfigToYsCfg(config = {}) {
  return {
    chainId: String(config.chainId || '').trim(),
    vendorId: String(config.vendorId || '').trim(),
    storeId: String(config.storeId || '').trim(),
    externalPartnerConfigId: String(config.externalPartnerConfigId || '').trim(),
    clientId: String(config.clientId || '').trim(),
    clientSecret: String(config.clientSecret || '').trim()
  };
}

export function isYsConfigComplete(cfg) {
  return Boolean(
    cfg.chainId &&
    cfg.vendorId &&
    cfg.clientId &&
    cfg.clientSecret &&
    !isMissingConfigValue(cfg.clientId) &&
    !isMissingConfigValue(cfg.clientSecret)
  );
}

export function isTgoConfigComplete(cfg) {
  return Boolean(
    cfg.supplierId &&
    cfg.apiKey &&
    cfg.apiSecret &&
    !isMissingConfigValue(cfg.apiKey) &&
    !isMissingConfigValue(cfg.apiSecret)
  );
}

export function isGetirConfigComplete(config = {}) {
  return isGetirApiConfigComplete({
    shopId: config.shopId,
    username: config.apiUsername || config.username,
    password: config.apiPassword || config.password,
    baseUrl: config.apiBaseUrl || config.baseUrl,
    initialPassword: config.apiInitialPassword || config.initialPassword,
    env: config.apiEnv || config.env || 'prod'
  });
}
