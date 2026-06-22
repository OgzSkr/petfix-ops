import { paths } from '../../config.js';
import {
  isMaskedValue,
  isMissingConfigValue,
  persistPlatformConfigUpdates,
  readPlatformConfigEnv
} from '../../env.js';
import { UberEatsAdapter } from '../../channels/uber-eats.js';
import { YemeksepetiAdapter } from '../../channels/yemeksepeti.js';

function requiredPayloadValue(value, label) {
  const text = String(value || '').trim();
  if (!text || isMissingConfigValue(text)) {
    throw new Error(`${label} zorunludur.`);
  }
  return text;
}

function safeVisibleValue(value) {
  return isMissingConfigValue(value) ? '' : String(value || '');
}

export function createChannelSettingsService() {
  async function getUberEatsSettings() {
    const env = await readPlatformConfigEnv(paths.platformEnv);
    const apiKey = safeVisibleValue(env.UBER_EATS_API_KEY);
    const apiSecret = safeVisibleValue(env.UBER_EATS_API_SECRET);

    return {
      supplierId: safeVisibleValue(env.UBER_EATS_SUPPLIER_ID),
      integrationRef: safeVisibleValue(env.UBER_EATS_INTEGRATION_REF),
      storeId: safeVisibleValue(env.UBER_EATS_STORE_ID),
      apiKey: '',
      apiKeyConfigured: !isMissingConfigValue(apiKey),
      apiSecret: '',
      apiSecretConfigured: !isMissingConfigValue(apiSecret),
      channel: env.UBER_EATS_CHANNEL || 'market',
      environment: env.UBER_EATS_ENV || 'PROD'
    };
  }

  async function saveUberEatsSettings(payload) {
    const existing = await readPlatformConfigEnv(paths.platformEnv);
    const apiKeyInput = String(payload.apiKey || '').trim();
    const apiSecretInput = String(payload.apiSecret || '').trim();
    const nextApiKey = isMaskedValue(apiKeyInput) || !apiKeyInput
      ? existing.UBER_EATS_API_KEY
      : apiKeyInput;
    const nextApiSecret = !apiSecretInput || isMaskedValue(apiSecretInput)
      ? existing.UBER_EATS_API_SECRET
      : apiSecretInput;

    if (isMissingConfigValue(nextApiKey)) {
      throw new Error('API Key zorunludur.');
    }
    if (isMissingConfigValue(nextApiSecret)) {
      throw new Error('API Secret zorunludur.');
    }

    const channel = payload.channel === 'yemek' ? 'yemek' : 'market';

    await persistPlatformConfigUpdates(paths.platformEnv, {
      UBER_EATS_SUPPLIER_ID: requiredPayloadValue(payload.supplierId, 'Satıcı ID'),
      UBER_EATS_INTEGRATION_REF: String(payload.integrationRef || existing.UBER_EATS_INTEGRATION_REF || '').trim(),
      UBER_EATS_STORE_ID: String(payload.storeId || existing.UBER_EATS_STORE_ID || '').trim(),
      UBER_EATS_API_KEY: nextApiKey,
      UBER_EATS_API_SECRET: nextApiSecret,
      UBER_EATS_CHANNEL: channel,
      UBER_EATS_ENV: payload.environment === 'STAGE' ? 'STAGE' : 'PROD'
    });

    const adapter = new UberEatsAdapter();
    const health = await adapter.healthCheck({ probe: true });

    return {
      ok: true,
      health
    };
  }

  async function getYemeksepetiSettings() {
    const env = await readPlatformConfigEnv(paths.platformEnv);
    const clientId = safeVisibleValue(env.YEMEKSEPETI_CLIENT_ID);
    const clientSecret = safeVisibleValue(env.YEMEKSEPETI_CLIENT_SECRET);

    const chainId = safeVisibleValue(env.YEMEKSEPETI_CHAIN_ID);
    const adapter = new YemeksepetiAdapter();

    return {
      chainId,
      vendorId: safeVisibleValue(env.YEMEKSEPETI_VENDOR_ID),
      clientId: '',
      clientIdConfigured: !isMissingConfigValue(clientId),
      clientSecret: '',
      clientSecretConfigured: !isMissingConfigValue(clientSecret),
      partnerPortalUrl: adapter.partnerPortalUrl(chainId)
    };
  }

  async function saveYemeksepetiSettings(payload) {
    const existing = await readPlatformConfigEnv(paths.platformEnv);
    const clientIdInput = String(payload.clientId || '').trim();
    const clientSecretInput = String(payload.clientSecret || '').trim();
    const nextClientId = isMaskedValue(clientIdInput) || !clientIdInput
      ? existing.YEMEKSEPETI_CLIENT_ID
      : clientIdInput;
    const nextClientSecret = !clientSecretInput || isMaskedValue(clientSecretInput)
      ? existing.YEMEKSEPETI_CLIENT_SECRET
      : clientSecretInput;

    if (isMissingConfigValue(nextClientId)) {
      throw new Error('Client ID zorunludur.');
    }
    if (isMissingConfigValue(nextClientSecret)) {
      throw new Error('Client Secret zorunludur.');
    }

    await persistPlatformConfigUpdates(paths.platformEnv, {
      YEMEKSEPETI_CHAIN_ID: requiredPayloadValue(payload.chainId, 'Chain ID'),
      YEMEKSEPETI_VENDOR_ID: requiredPayloadValue(payload.vendorId, 'Vendor ID'),
      YEMEKSEPETI_CLIENT_ID: nextClientId,
      YEMEKSEPETI_CLIENT_SECRET: nextClientSecret
    });

    const adapter = new YemeksepetiAdapter();
    const health = await adapter.healthCheck();

    return {
      ok: true,
      health
    };
  }

  return {
    getUberEatsSettings,
    saveUberEatsSettings,
    getYemeksepetiSettings,
    saveYemeksepetiSettings
  };
}
