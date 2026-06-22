/**
 * Tek Credential Provider katmanı.
 *
 * Hiçbir kanal adapter'ı / ingest modülü doğrudan env veya farklı config kaynaklarını
 * okumamalı; hepsi `getChannelCredentials({ channel, branchId })` üzerinden okur.
 *
 * Bugün arka kaynak: platform env (.env + data/runtime-secrets.env) ve — Ops Hub açıksa —
 * şube/kanal DB konfigürasyonu (ops_branch_channel_config) ile birleşim.
 * İleride bu fonksiyonun imzası korunarak arka uç şifreli DB + tenant yapısına geçirilebilir.
 */
import {
  readEnvFile,
  readPlatformConfigEnv,
  isMissingConfigValue,
  isMaskedValue,
  persistPlatformConfigUpdates
} from '../env.js';
import { paths } from '../config.js';
import { MASKED_SECRET } from '../ops-hub/integrations/config-bridge.js';
import { shouldUseEncryptedChannelSecrets } from '../crypto/secrets.js';

async function loadPlatformEnv(platformEnv) {
  if (platformEnv) return platformEnv;
  return readPlatformConfigEnv(paths.platformEnv);
}

function envPick(env, key, fallback = '') {
  const fromEnv = env?.[key];
  if (fromEnv !== undefined && fromEnv !== null && String(fromEnv).trim() !== '') return fromEnv;
  const fromProcess = process.env?.[key];
  if (fromProcess !== undefined && fromProcess !== null && String(fromProcess).trim() !== '') return fromProcess;
  return fallback;
}

function getirFromEnv(env) {
  return {
    shopId: envPick(env, 'GETIR_SHOP_ID'),
    apiUsername: envPick(env, 'GETIR_API_USERNAME'),
    apiPassword: envPick(env, 'GETIR_API_PASSWORD'),
    apiInitialPassword: envPick(env, 'GETIR_API_INITIAL_PASSWORD'),
    apiBaseUrl: envPick(env, 'GETIR_API_BASE_URL'),
    // Varsayılan tüketiciye bırakılır (adapter → 'dev', ingest → 'prod' davranışı korunur).
    apiEnv: envPick(env, 'GETIR_API_ENV', '')
  };
}

async function resolveGetir(env, branchId) {
  const envCfg = getirFromEnv(env);
  try {
    const { bootstrapOpsHub, getOpsHubPool, isOpsHubReady } = await import('../ops-hub/bootstrap.js');
    if (!isOpsHubReady()) {
      await bootstrapOpsHub(env);
    }
    const pool = getOpsHubPool();
    if (pool) {
      const { resolveGetirOpsConfig } = await import('../ops-hub/integrations/branch-config-resolver.js');
      const opsCfg = await resolveGetirOpsConfig(pool, { platformEnv: env, branchId });
      // Ops resolver DB + env birleşimi döndürür; boş apiEnv için env varsayılanını koru.
      return { ...envCfg, ...opsCfg, apiEnv: opsCfg.apiEnv || envCfg.apiEnv };
    }
  } catch {
    // Ops Hub yoksa yalnızca env fallback
  }
  return envCfg;
}

function resolveYemeksepeti(env) {
  return {
    chainId: envPick(env, 'YEMEKSEPETI_CHAIN_ID'),
    vendorId: envPick(env, 'YEMEKSEPETI_VENDOR_ID'),
    storeId: envPick(env, 'YEMEKSEPETI_STORE_ID'),
    externalPartnerConfigId: envPick(env, 'YEMEKSEPETI_EXTERNAL_PARTNER_CONFIG_ID'),
    clientId: envPick(env, 'YEMEKSEPETI_CLIENT_ID'),
    clientSecret: envPick(env, 'YEMEKSEPETI_CLIENT_SECRET')
  };
}

async function resolveDefaultBranchId(platformEnv) {
  try {
    const { bootstrapOpsHub, isOpsHubReady, getOpsHubState } = await import('../ops-hub/bootstrap.js');
    if (!isOpsHubReady()) {
      await bootstrapOpsHub(platformEnv);
    }
    return getOpsHubState().branch?.id || null;
  } catch {
    return null;
  }
}

async function resolveYemeksepetiWithBranch(env, branchId) {
  const envCfg = resolveYemeksepeti(env);
  if (!branchId) return envCfg;
  try {
    const { bootstrapOpsHub, getOpsHubPool, isOpsHubReady } = await import('../ops-hub/bootstrap.js');
    if (!isOpsHubReady()) {
      await bootstrapOpsHub(env);
    }
    const pool = getOpsHubPool();
    if (pool) {
      const { resolveYemeksepetiOpsConfig } = await import('../ops-hub/integrations/branch-config-resolver.js');
      const opsCfg = await resolveYemeksepetiOpsConfig(pool, { platformEnv: env, branchId });
      return { ...envCfg, ...opsCfg };
    }
  } catch {
    // fallback env
  }
  return envCfg;
}

async function resolveUberEatsWithBranch(env, branchId) {
  const envCfg = resolveUberEats(env);
  if (!branchId) return envCfg;
  try {
    const { bootstrapOpsHub, getOpsHubPool, isOpsHubReady } = await import('../ops-hub/bootstrap.js');
    if (!isOpsHubReady()) {
      await bootstrapOpsHub(env);
    }
    const pool = getOpsHubPool();
    if (pool) {
      const { resolveTgoOpsConfig } = await import('../ops-hub/integrations/branch-config-resolver.js');
      const opsCfg = await resolveTgoOpsConfig(pool, { platformEnv: env, branchId });
      return { ...envCfg, ...opsCfg };
    }
  } catch {
    // fallback env
  }
  return envCfg;
}

function buildUberAuthToken(apiKey, apiSecret) {
  if (!apiKey || !apiSecret || isMissingConfigValue(apiKey) || isMissingConfigValue(apiSecret)) {
    return '';
  }
  return Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
}

function resolveUberEats(env) {
  const apiKey = envPick(env, 'UBER_EATS_API_KEY');
  const apiSecret = envPick(env, 'UBER_EATS_API_SECRET');
  return {
    supplierId: envPick(env, 'UBER_EATS_SUPPLIER_ID'),
    integrationRef: envPick(env, 'UBER_EATS_INTEGRATION_REF'),
    storeId: envPick(env, 'UBER_EATS_STORE_ID'),
    apiKey,
    apiSecret,
    channel: envPick(env, 'UBER_EATS_CHANNEL', 'market'),
    environment: envPick(env, 'UBER_EATS_ENV', 'PROD'),
    authToken: buildUberAuthToken(apiKey, apiSecret)
  };
}


/**
 * Tek giriş noktası — kanal bazlı normalize edilmiş kimlik bilgisi nesnesi döndürür.
 * @param {object} args
 * @param {string} args.channel - kanal id (registry id'leri)
 * @param {string|null} [args.branchId] - şube/tenant kimliği (ileride zorunlu olacak)
 * @param {object|null} [args.platformEnv] - önceden okunmuş platform env (opsiyonel hız için)
 */
export async function getChannelCredentials({ channel, branchId = null, platformEnv = null } = {}) {
  const env = await loadPlatformEnv(platformEnv);
  const effectiveBranchId = branchId || (await resolveDefaultBranchId(env));

  switch (channel) {
    case 'getir':
      return resolveGetir(env, effectiveBranchId);
    case 'yemeksepeti':
      return resolveYemeksepetiWithBranch(env, effectiveBranchId);
    case 'uber-eats':
      return resolveUberEatsWithBranch(env, effectiveBranchId);
    default:
      return {};
  }
}

const REGISTRY_TO_OPS = {
  getir: 'getir',
  yemeksepeti: 'yemeksepeti',
  'uber-eats': 'trendyol_go'
};

function preserveSecret(incoming, existing) {
  const value = String(incoming ?? '').trim();
  if (!value || value === MASKED_SECRET || isMaskedValue(value)) {
    return existing;
  }
  return value;
}

function envUpdatesForChannel(channel, values = {}, existing = {}, options = {}) {
  const omitSecrets = options.omitSecrets === true;
  switch (channel) {
    case 'getir': {
      const updates = {
        GETIR_SHOP_ID: values.shopId ?? existing.shopId ?? '',
        GETIR_API_USERNAME: values.apiUsername ?? existing.apiUsername ?? '',
        GETIR_API_BASE_URL: values.apiBaseUrl ?? existing.apiBaseUrl ?? '',
        GETIR_API_ENV: values.apiEnv ?? existing.apiEnv ?? ''
      };
      if (!omitSecrets) {
        updates.GETIR_API_PASSWORD = preserveSecret(values.apiPassword, existing.apiPassword);
        updates.GETIR_API_INITIAL_PASSWORD = preserveSecret(values.apiInitialPassword, existing.apiInitialPassword);
      }
      return updates;
    }
    case 'yemeksepeti': {
      const updates = {
        YEMEKSEPETI_CHAIN_ID: values.chainId ?? existing.chainId ?? '',
        YEMEKSEPETI_VENDOR_ID: values.vendorId ?? existing.vendorId ?? '',
        YEMEKSEPETI_STORE_ID: values.storeId ?? existing.storeId ?? '',
        YEMEKSEPETI_EXTERNAL_PARTNER_CONFIG_ID: values.externalPartnerConfigId ?? existing.externalPartnerConfigId ?? ''
      };
      if (!omitSecrets) {
        updates.YEMEKSEPETI_CLIENT_ID = preserveSecret(values.clientId, existing.clientId);
        updates.YEMEKSEPETI_CLIENT_SECRET = preserveSecret(values.clientSecret, existing.clientSecret);
      }
      return updates;
    }
    case 'uber-eats': {
      const updates = {
        UBER_EATS_SUPPLIER_ID: values.supplierId ?? existing.supplierId ?? '',
        UBER_EATS_INTEGRATION_REF: values.integrationRef ?? existing.integrationRef ?? '',
        UBER_EATS_STORE_ID: values.storeId ?? existing.storeId ?? '',
        UBER_EATS_CHANNEL: values.channel === 'yemek' ? 'yemek' : (values.channel || existing.channel || 'market'),
        UBER_EATS_ENV: values.environment === 'STAGE' ? 'STAGE' : (values.environment || existing.environment || 'PROD')
      };
      if (!omitSecrets) {
        updates.UBER_EATS_API_KEY = preserveSecret(values.apiKey, existing.apiKey);
        updates.UBER_EATS_API_SECRET = preserveSecret(values.apiSecret, existing.apiSecret);
      }
      return updates;
    }
    default:
      return null;
  }
}

function opsConfigForChannel(channel, values = {}, existing = {}) {
  switch (channel) {
    case 'getir':
      return {
        shopId: values.shopId ?? existing.shopId ?? '',
        apiUsername: values.apiUsername ?? existing.apiUsername ?? '',
        apiPassword: preserveSecret(values.apiPassword, existing.apiPassword),
        apiInitialPassword: preserveSecret(values.apiInitialPassword, existing.apiInitialPassword),
        apiBaseUrl: values.apiBaseUrl ?? existing.apiBaseUrl ?? '',
        apiEnv: values.apiEnv ?? existing.apiEnv ?? 'dev',
        autoAcceptOrders: values.autoAcceptOrders ?? true
      };
    case 'yemeksepeti':
      return {
        chainId: values.chainId ?? existing.chainId ?? '',
        vendorId: values.vendorId ?? existing.vendorId ?? '',
        storeId: values.storeId ?? existing.storeId ?? '',
        externalPartnerConfigId: values.externalPartnerConfigId ?? existing.externalPartnerConfigId ?? '',
        clientId: preserveSecret(values.clientId, existing.clientId),
        clientSecret: preserveSecret(values.clientSecret, existing.clientSecret),
        webhookSecret: preserveSecret(values.webhookSecret, existing.webhookSecret),
        autoAcceptOrders: values.autoAcceptOrders ?? true
      };
    case 'uber-eats':
      return {
        sellerId: values.supplierId ?? existing.supplierId ?? '',
        storeId: values.storeId ?? existing.storeId ?? '',
        apiKey: preserveSecret(values.apiKey, existing.apiKey),
        apiSecret: preserveSecret(values.apiSecret, existing.apiSecret),
        autoAcceptOrders: values.autoAcceptOrders ?? true
      };
    default:
      return null;
  }
}

async function syncOpsBranchConfig(channel, config, options = {}) {
  const opsChannel = REGISTRY_TO_OPS[channel];
  if (!opsChannel) return null;

  try {
    const { bootstrapOpsHub, getOpsHubPool, isOpsHubReady } = await import('../ops-hub/bootstrap.js');
    const platformEnv = options.platformEnv || (await loadPlatformEnv());
    if (!isOpsHubReady()) {
      await bootstrapOpsHub(platformEnv);
    }
    const pool = getOpsHubPool();
    if (!pool) return null;

    const { getBranchById } = await import('../ops-hub/branches/branch-repository.js');
    const { ensureDefaultBranch } = await import('../ops-hub/db/repository.js');
    const { saveIntegration } = await import('../ops-hub/integrations/integration-service.js');
    let branch = null;
    if (options.branchId) {
      branch = await getBranchById(pool, options.branchId);
    }
    if (!branch) {
      branch = await ensureDefaultBranch(pool);
    }
    return saveIntegration(pool, opsChannel, {
      config,
      enabled: options.enabled ?? true,
      autoAcceptOrders: config.autoAcceptOrders ?? true
    }, { branchId: branch.id, platformEnv });
  } catch {
    return null;
  }
}

/**
 * Tek yazma yolu — platform env + Ops Hub DB config birlikte güncellenir.
 * @returns {Promise<{ ok: boolean, health?: object, ops?: object }>}
 */
export async function saveChannelCredentials({
  channel,
  branchId = null,
  values = {},
  options = {}
} = {}) {
  if (!channel) {
    throw Object.assign(new Error('channel zorunlu'), { statusCode: 400 });
  }

  const existing = await getChannelCredentials({ channel, branchId, platformEnv: options.platformEnv });
  const platformEnv = options.platformEnv || (await loadPlatformEnv());
  const effectiveBranchId = branchId || (await resolveDefaultBranchId(platformEnv));

  const omitSecrets = shouldUseEncryptedChannelSecrets(platformEnv);
  const envUpdates = envUpdatesForChannel(channel, values, existing, { omitSecrets });
  if (!envUpdates) {
    throw Object.assign(new Error(`Desteklenmeyen kanal: ${channel}`), { statusCode: 400 });
  }
  await persistPlatformConfigUpdates(paths.platformEnv, envUpdates);

  const opsConfig = opsConfigForChannel(channel, values, existing);
  const ops = opsConfig
    ? await syncOpsBranchConfig(channel, opsConfig, {
      platformEnv,
      enabled: options.enabled,
      branchId: effectiveBranchId
    })
    : null;

  let health = null;
  if (options.probe !== false) {
    const { getChannelAdapter } = await import('./registry.js');
    const adapter = getChannelAdapter(channel);
    if (adapter) {
      health = await adapter.healthCheck(
        channel === 'yemeksepeti' ? { live: true }
          : channel === 'uber-eats' || channel === 'getir' ? { probe: true }
              : {}
      );
    }
  }

  return { ok: true, health, ops };
}
