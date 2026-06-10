import { readEnvFile } from '../../env.js';
import { paths } from '../../config.js';
import { getBranchChannelConfig } from '../db/repository.js';
import {
  branchConfigToTgoCfg,
  branchConfigToYsCfg,
  envFallbackForChannel,
  mergeChannelConfig
} from './config-bridge.js';

export async function resolveBranchChannelConfig(pool, channel, options = {}) {
  const platformEnv = options.platformEnv || (await readEnvFile(paths.platformEnv));
  const branchId = options.branchId || null;
  const row =
    pool && branchId ? await getBranchChannelConfig(pool, branchId, channel) : null;
  const stored = row?.config_json || {};
  const merged = mergeChannelConfig(channel, stored, envFallbackForChannel(channel, platformEnv));

  return {
    channel,
    branchId,
    enabled: row?.enabled ?? true,
    integrationMode: row?.integration_mode || 'direct',
    autoAcceptOrders: merged.autoAcceptOrders ?? row?.auto_accept_orders ?? true,
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
  const resolved = await resolveBranchChannelConfig(pool, 'yemeksepeti', options);
  const fromConfig = String(resolved.config.webhookSecret || '').trim();
  if (fromConfig) {
    return fromConfig;
  }
  const env = options.platformEnv || (await readEnvFile(paths.platformEnv));
  return String(env.YEMEKSEPETI_WEBHOOK_SECRET || process.env.YEMEKSEPETI_WEBHOOK_SECRET || '').trim();
}
