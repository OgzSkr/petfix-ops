import { paths } from '../../config.js';
import {
  isMaskedValue,
  isMissingConfigValue,
  readEnvFile,
  updateEnvFile
} from '../../env.js';
import { UberEatsAdapter } from '../../channels/uber-eats.js';
import { YemeksepetiAdapter } from '../../channels/yemeksepeti.js';
import { WooCommerceAdapter } from '../../channels/woocommerce.js';
import { createDhlEcommerceClient, isDhlConfigured, readDhlConfig } from '../../carriers/dhl-ecommerce-client.js';

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
    const env = await readEnvFile(paths.platformEnv);
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
    const existing = await readEnvFile(paths.platformEnv);
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

    await updateEnvFile(paths.platformEnv, {
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
    const env = await readEnvFile(paths.platformEnv);
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
    const existing = await readEnvFile(paths.platformEnv);
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

    await updateEnvFile(paths.platformEnv, {
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

  async function getWooCommerceSettings() {
    const env = await readEnvFile(paths.platformEnv);
    const key = safeVisibleValue(env.WOOCOMMERCE_KEY);
    const secret = safeVisibleValue(env.WOOCOMMERCE_SECRET);

    return {
      baseUrl: safeVisibleValue(env.WOOCOMMERCE_URL),
      key: '',
      keyConfigured: !isMissingConfigValue(key),
      secret: '',
      secretConfigured: !isMissingConfigValue(secret)
    };
  }

  async function saveWooCommerceSettings(payload) {
    const existing = await readEnvFile(paths.platformEnv);
    const keyInput = String(payload.key || '').trim();
    const secretInput = String(payload.secret || '').trim();
    const nextKey = isMaskedValue(keyInput) || !keyInput
      ? existing.WOOCOMMERCE_KEY
      : keyInput;
    const nextSecret = !secretInput || isMaskedValue(secretInput)
      ? existing.WOOCOMMERCE_SECRET
      : secretInput;

    if (isMissingConfigValue(nextKey)) {
      throw new Error('Consumer Key zorunludur.');
    }
    if (isMissingConfigValue(nextSecret)) {
      throw new Error('Consumer Secret zorunludur.');
    }

    let baseUrl = requiredPayloadValue(payload.baseUrl, 'Mağaza URL');
    baseUrl = baseUrl.replace(/\/$/, '');

    await updateEnvFile(paths.platformEnv, {
      WOOCOMMERCE_URL: baseUrl,
      WOOCOMMERCE_KEY: nextKey,
      WOOCOMMERCE_SECRET: nextSecret
    });

    const adapter = new WooCommerceAdapter();
    const health = await adapter.healthCheck({ live: true });

    return {
      ok: true,
      health
    };
  }

  async function getDhlSettings() {
    const env = await readEnvFile(paths.platformEnv);
    const clientId = safeVisibleValue(env.DHL_API_CLIENT_ID);
    const clientSecret = safeVisibleValue(env.DHL_API_CLIENT_SECRET);
    const password = safeVisibleValue(env.DHL_API_PASSWORD);

    return {
      customerNumber: safeVisibleValue(env.DHL_CUSTOMER_NUMBER),
      clientId: '',
      clientIdConfigured: !isMissingConfigValue(clientId),
      clientSecret: '',
      clientSecretConfigured: !isMissingConfigValue(clientSecret),
      password: '',
      passwordConfigured: !isMissingConfigValue(password),
      environment: env.DHL_API_ENV || 'PROD',
      configured: isDhlConfigured(env)
    };
  }

  async function saveDhlSettings(payload) {
    const existing = await readEnvFile(paths.platformEnv);
    const clientIdInput = String(payload.clientId || '').trim();
    const clientSecretInput = String(payload.clientSecret || '').trim();
    const passwordInput = String(payload.password || '').trim();

    const nextClientId = isMaskedValue(clientIdInput) || !clientIdInput
      ? existing.DHL_API_CLIENT_ID
      : clientIdInput;
    const nextClientSecret = !clientSecretInput || isMaskedValue(clientSecretInput)
      ? existing.DHL_API_CLIENT_SECRET
      : clientSecretInput;
    const nextPassword = !passwordInput || isMaskedValue(passwordInput)
      ? existing.DHL_API_PASSWORD
      : passwordInput;

    if (isMissingConfigValue(nextClientId)) {
      throw new Error('DHL Client ID zorunludur.');
    }
    if (isMissingConfigValue(nextClientSecret)) {
      throw new Error('DHL Client Secret zorunludur.');
    }
    if (isMissingConfigValue(nextPassword)) {
      throw new Error('DHL panel şifresi zorunludur.');
    }

    await updateEnvFile(paths.platformEnv, {
      DHL_API_CLIENT_ID: nextClientId,
      DHL_API_CLIENT_SECRET: nextClientSecret,
      DHL_CUSTOMER_NUMBER: requiredPayloadValue(payload.customerNumber, 'DHL Müşteri No'),
      DHL_API_PASSWORD: nextPassword,
      DHL_API_ENV: payload.environment === 'STAGE' ? 'STAGE' : 'PROD'
    });

    const client = createDhlEcommerceClient(readDhlConfig({
      ...existing,
      DHL_API_CLIENT_ID: nextClientId,
      DHL_API_CLIENT_SECRET: nextClientSecret,
      DHL_CUSTOMER_NUMBER: payload.customerNumber,
      DHL_API_PASSWORD: nextPassword,
      DHL_API_ENV: payload.environment === 'STAGE' ? 'STAGE' : 'PROD'
    }));
    const health = await client.healthCheck();

    return {
      ok: true,
      health
    };
  }

  return {
    getUberEatsSettings,
    saveUberEatsSettings,
    getYemeksepetiSettings,
    saveYemeksepetiSettings,
    getWooCommerceSettings,
    saveWooCommerceSettings,
    getDhlSettings,
    saveDhlSettings
  };
}
