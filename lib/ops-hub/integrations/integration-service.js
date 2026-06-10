import { randomUUID } from 'node:crypto';
import { OPS_CHANNELS } from '../constants.js';
import { normalizeBranchChannelConfig } from '../domain/branch-channel-config.js';
import { resolveOpsHubConfig } from '../config.js';
import {
  getBranchChannelConfig,
  listBranchChannelConfigs,
  upsertBranchChannelConfig
} from '../db/repository.js';
import { probeTgoGroceryPackages } from '../channels/tgo-grocery-fetch.js';
import { getIntegrationChannelMeta } from './channel-guides.js';
import {
  applySecretPreservation,
  branchConfigToTgoCfg,
  branchConfigToYsCfg,
  envFallbackForChannel,
  isGetirConfigComplete,
  isTgoConfigComplete,
  isYsConfigComplete,
  loadPlatformEnv,
  maskChannelConfigSecrets,
  mergeChannelConfig
} from './config-bridge.js';
import { YemeksepetiAdapter } from '../../channels/yemeksepeti.js';
import { buildIntegrationSetupChecklist } from './integration-checklist.js';

function resolveIntegrationStatus(channel, config, meta = {}) {
  if (meta.enabled === false) {
    return 'disabled';
  }

  const complete =
    channel === 'trendyol_go'
      ? isTgoConfigComplete(branchConfigToTgoCfg(config))
      : channel === 'yemeksepeti'
        ? isYsConfigComplete(branchConfigToYsCfg(config))
        : isGetirConfigComplete(config);

  if (!complete) {
    return 'missing';
  }

  if (meta.lastTestOk === true) {
    return 'connected';
  }
  if (meta.lastTestOk === false) {
    return 'error';
  }

  return 'ready';
}

export function buildWebhookPanel(platformEnv = {}) {
  const base = resolveOpsHubConfig(platformEnv).publicApiBaseUrl;
  return {
    baseUrl: base,
    endpoints: {
      yemeksepetiOrders: `${base}/webhooks/v1/yemeksepeti/orders`,
      yemeksepetiCatalog: `${base}/webhooks/v1/yemeksepeti/catalog`,
      getirOrders: `${base}/webhooks/v1/getir/orders`
    }
  };
}

export function ensureWebhookSecret(config = {}) {
  const secret = String(config.webhookSecret || '').trim();
  if (secret) {
    return config;
  }
  return { ...config, webhookSecret: randomUUID().replace(/-/g, '') };
}

export async function listIntegrations(pool, options = {}) {
  const platformEnv = options.platformEnv || (await loadPlatformEnv());
  const branchId = options.branchId;
  const rows = branchId && pool ? await listBranchChannelConfigs(pool, branchId) : [];
  const rowByChannel = new Map(rows.map((row) => [row.channel, row]));
  const webhooks = buildWebhookPanel(platformEnv);

  const integrations = OPS_CHANNELS.map((channel) => {
    const meta = getIntegrationChannelMeta(channel);
    const row = rowByChannel.get(channel);
    const storedConfig = row?.config_json || row?.config || {};
    const config = mergeChannelConfig(
      channel,
      storedConfig,
      envFallbackForChannel(channel, platformEnv)
    );
    const configMeta = storedConfig._meta || {};
    const status = resolveIntegrationStatus(channel, config, {
      enabled: row?.enabled ?? true,
      lastTestOk: configMeta.lastTestOk
    });

    return {
      channel,
      label: meta?.label || channel,
      gate: meta?.gate || null,
      gateNote: meta?.gateNote || null,
      status,
      enabled: row?.enabled ?? true,
      integrationMode: row?.integration_mode || 'direct',
      autoAcceptOrders: config.autoAcceptOrders ?? true,
      config: maskChannelConfigSecrets(config),
      lastTestAt: configMeta.lastTestAt || null,
      lastTestMessage: configMeta.lastTestMessage || null,
      source: row ? 'database' : 'env_fallback'
    };
  });

  return { integrations, webhooks };
}

export async function getIntegrationDetail(pool, channel, options = {}) {
  const platformEnv = options.platformEnv || (await loadPlatformEnv());
  const branchId = options.branchId;
  const meta = getIntegrationChannelMeta(channel);
  if (!meta) {
    return null;
  }

  const row = branchId && pool ? await getBranchChannelConfig(pool, branchId, channel) : null;
  const storedConfig = row?.config_json || row?.config || {};
  const config = mergeChannelConfig(
    channel,
    storedConfig,
    envFallbackForChannel(channel, platformEnv)
  );

  const configMeta = storedConfig._meta || {};
  const setupChecklist = await buildIntegrationSetupChecklist(channel, {
    config,
    configMeta,
    platformEnv
  });

  return {
    channel,
    meta,
    enabled: row?.enabled ?? true,
    integrationMode: row?.integration_mode || 'direct',
    config: maskChannelConfigSecrets(config),
    webhooks: buildWebhookPanel(platformEnv),
    setupChecklist,
    guide: {
      steps: meta.steps,
      portalUrl: meta.portalUrl,
      prerequisite: meta.prerequisite || null,
      fields: meta.fields
    }
  };
}

export async function saveIntegration(pool, channel, payload = {}, options = {}) {
  const branchId = options.branchId;
  if (!branchId) {
    throw Object.assign(new Error('branchId zorunlu'), { statusCode: 400 });
  }

  const existingRow = await getBranchChannelConfig(pool, branchId, channel);
  const existingConfig = existingRow?.config_json || existingRow?.config || {};
  const platformEnv = options.platformEnv || (await loadPlatformEnv());

  let merged = mergeChannelConfig(
    channel,
    applySecretPreservation(payload.config || payload, existingConfig),
    {}
  );

  if (channel === 'yemeksepeti') {
    merged = ensureWebhookSecret(merged);
  }

  merged.autoAcceptOrders =
    payload.autoAcceptOrders ?? payload.config?.autoAcceptOrders ?? merged.autoAcceptOrders ?? true;

  if (existingConfig._meta) {
    merged._meta = existingConfig._meta;
  }

  const normalized = normalizeBranchChannelConfig({
    channel,
    integrationMode: payload.integrationMode || existingRow?.integration_mode || 'direct',
    config: merged,
    enabled: payload.enabled ?? existingRow?.enabled ?? true
  });

  const saved = await upsertBranchChannelConfig(pool, {
    branchId,
    channel: normalized.channel,
    integrationMode: normalized.integrationMode,
    config: normalized.config,
    enabled: normalized.enabled
  });

  return {
    ok: true,
    channel,
    config: maskChannelConfigSecrets(saved.config_json || normalized.config),
    enabled: saved.enabled,
    autoAcceptOrders: normalized.config.autoAcceptOrders
  };
}

export async function testIntegrationConnection(channel, config = {}, options = {}) {
  const platformEnv = options.platformEnv || (await loadPlatformEnv());
  const merged = mergeChannelConfig(channel, config, envFallbackForChannel(channel, platformEnv));

  if (channel === 'trendyol_go') {
    const cfg = branchConfigToTgoCfg(merged);
    if (!isTgoConfigComplete(cfg)) {
      return { ok: false, message: 'Eksik alan: sellerId, apiKey, apiSecret, storeId' };
    }
    const packages = await probeTgoGroceryPackages(cfg);
    return {
      ok: packages.ok,
      message: packages.message || (packages.ok ? 'Grocery packages OK' : 'Packages probe başarısız'),
      details: packages
    };
  }

  if (channel === 'yemeksepeti') {
    const cfg = branchConfigToYsCfg(merged);
    if (!isYsConfigComplete(cfg)) {
      return { ok: false, message: 'Eksik alan: clientId, clientSecret, vendorId, chainId' };
    }
    const adapter = new YemeksepetiAdapter();
    const originalLoad = adapter.loadConfig.bind(adapter);
    adapter.loadConfig = async () => cfg;
    const result = await adapter.healthCheck({ live: true });
    adapter.loadConfig = originalLoad;
    return {
      ok: Boolean(result.ok),
      message: result.message || (result.ok ? 'OAuth + katalog OK' : 'Bağlantı testi başarısız'),
      details: {
        oauth: result.oauth,
        catalogOk: result.catalogOk,
        catalogPages: result.catalogPages,
        ordersLast7Days: result.ordersLast7Days
      }
    };
  }

  if (channel === 'getir') {
    if (!isGetirConfigComplete(merged)) {
      return { ok: false, message: 'shopId zorunlu' };
    }
    return {
      ok: false,
      message: 'G3 FAIL — Getir API credential henüz yok; whitelist sürecini tamamlayın',
      details: { gate: 'G3' }
    };
  }

  return { ok: false, message: `Bilinmeyen kanal: ${channel}` };
}

export async function testAndPersistIntegration(pool, channel, payload = {}, options = {}) {
  const branchId = options.branchId;
  const platformEnv = options.platformEnv || (await loadPlatformEnv());
  const existingRow = branchId ? await getBranchChannelConfig(pool, branchId, channel) : null;
  const existingConfig = existingRow?.config_json || existingRow?.config || {};
  const config = mergeChannelConfig(
    channel,
    applySecretPreservation(payload.config || payload, existingConfig),
    envFallbackForChannel(channel, platformEnv)
  );

  const testResult = await testIntegrationConnection(channel, config, { platformEnv });
  const now = new Date().toISOString();

  if (branchId && existingRow) {
    const nextConfig = {
      ...existingConfig,
      _meta: {
        ...(existingConfig._meta || {}),
        lastTestAt: now,
        lastTestOk: testResult.ok,
        lastTestMessage: testResult.message
      }
    };
    await upsertBranchChannelConfig(pool, {
      branchId,
      channel,
      integrationMode: existingRow.integration_mode || 'direct',
      config: nextConfig,
      enabled: existingRow.enabled
    });
  }

  return {
    ok: testResult.ok,
    channel,
    testedAt: now,
    ...testResult
  };
}
