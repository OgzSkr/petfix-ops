import { readEnvFile, readPlatformConfigEnv, envValue } from '../../env.js';
import { paths } from '../../config.js';
import { getBranchChannelConfig } from '../db/repository.js';
import {
  branchConfigToTgoCfg,
  branchConfigToYsCfg,
  envFallbackForChannel,
  mergeChannelConfig
} from './config-bridge.js';

async function loadPlatformEnv(options = {}) {
  return options.platformEnv || (await readPlatformConfigEnv(paths.platformEnv));
}

export async function resolveBranchChannelConfig(pool, channel, options = {}) {
  const platformEnv = await loadPlatformEnv(options);
  const branchId = options.branchId || null;
  const row =
    pool && branchId
      ? await getBranchChannelConfig(pool, branchId, channel, { platformEnv })
      : null;
  const stored = row?.config_json || {};
  const merged = mergeChannelConfig(channel, stored, envFallbackForChannel(channel, platformEnv));

  return {
    channel,
    branchId,
    enabled: row?.enabled ?? true,
    integrationMode: row?.integration_mode || 'direct',
    autoAcceptOrders: merged.autoAcceptOrders ?? row?.auto_accept_orders ?? false,
    config: merged,
    source: row ? 'database' : 'env_fallback'
  };
}

export async function resolveTgoOpsConfig(pool, options = {}) {
  const resolved = await resolveBranchChannelConfig(pool, 'trendyol_go', options);
  return branchConfigToTgoCfg(resolved.config);
}

export async function resolveYemeksepetiOpsConfig(pool, options = {}) {
  const resolved = await resolveBranchChannelConfig(pool, 'yemeksepeti', options);
  return branchConfigToYsCfg(resolved.config);
}

export async function resolveYemeksepetiWebhookSecret(pool, options = {}) {
  const env = await loadPlatformEnv(options);
  const fromEnv = String(envValue(process.env, env, 'YEMEKSEPETI_WEBHOOK_SECRET') || '').trim();
  if (fromEnv) {
    return fromEnv;
  }
  const resolved = await resolveBranchChannelConfig(pool, 'yemeksepeti', options);
  return String(resolved.config.webhookSecret || '').trim();
}

export async function resolveGetirWebhookSecret(pool, options = {}) {
  const resolved = await resolveBranchChannelConfig(pool, 'getir', options);
  const fromConfig = String(resolved.config.webhookSecret || '').trim();
  if (fromConfig) {
    return fromConfig;
  }
  const env = await loadPlatformEnv(options);
  return String(
    env.GETIR_WEBHOOK_SECRET ||
      process.env.GETIR_WEBHOOK_SECRET ||
      ''
  ).trim();
}

export async function resolveGetirOpsConfig(pool, options = {}) {
  const { resolveGetirApiConfig } = await import('../../channels/getir-api.js');
  const resolved = await resolveBranchChannelConfig(pool, 'getir', options);
  const config = resolved.config || {};
  const api = resolveGetirApiConfig({
    shopId: config.shopId,
    apiUsername: config.apiUsername,
    apiPassword: config.apiPassword,
    apiBaseUrl: config.apiBaseUrl,
    apiInitialPassword: config.apiInitialPassword,
    apiEnv: config.apiEnv || 'prod'
  });
  return {
    shopId: api.shopId,
    apiUsername: api.username,
    apiPassword: api.password,
    apiBaseUrl: api.baseUrl,
    apiInitialPassword: api.initialPassword,
    apiEnv: String(config.apiEnv || 'prod').trim()
  };
}
