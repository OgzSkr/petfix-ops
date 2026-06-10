import { readEnvFile } from '../../env.js';
import { paths } from '../../config.js';
import { isMissingConfigValue } from '../../env.js';
import { defaultChannelConfig } from '../domain/branch-channel-config.js';

const SECRET_FIELDS = new Set(['apiSecret', 'clientSecret', 'webhookSecret', 'apiKey']);

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
      autoAcceptOrders: true
    };
  }
  if (channel === 'yemeksepeti') {
    return {
      clientId: env.YEMEKSEPETI_CLIENT_ID || '',
      clientSecret: env.YEMEKSEPETI_CLIENT_SECRET || '',
      vendorId: env.YEMEKSEPETI_VENDOR_ID || '',
      chainId: env.YEMEKSEPETI_CHAIN_ID || '',
      webhookSecret: env.YEMEKSEPETI_WEBHOOK_SECRET || '',
      autoAcceptOrders: true
    };
  }
  if (channel === 'getir') {
    return {
      shopId: env.GETIR_SHOP_ID || '',
      autoAcceptOrders: true
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
  return Boolean(String(config.shopId || '').trim());
}
