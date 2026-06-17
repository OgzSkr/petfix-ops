import { ChannelAdapter } from './base-adapter.js';
import { readEnvFile } from '../env.js';
import { paths } from '../config.js';
import { isMissingConfigValue } from '../env.js';
import { probeGetirApi } from './getir-api.js';

async function canListGetirOpsOrders() {
  try {
    const { bootstrapOpsHub, getOpsHubPool, isOpsHubReady } = await import('../ops-hub/bootstrap.js');
    const { readEnvFile } = await import('../env.js');
    const { paths } = await import('../config.js');
    if (!isOpsHubReady()) {
      await bootstrapOpsHub(await readEnvFile(paths.platformEnv));
    }
    return Boolean(getOpsHubPool());
  } catch {
    return false;
  }
}

/** Getir Çarşı — API poll + webhook ingest. */
export class GetirAdapter extends ChannelAdapter {
  constructor() {
    super('getir', 'Getir Çarşı');
    this.syncEnabled = true;
    this.scope = 'orders-profit';
  }

  async loadConfig() {
    const env = await readEnvFile(paths.platformEnv);
    return {
      shopId: env.GETIR_SHOP_ID || process.env.GETIR_SHOP_ID || '',
      apiUsername: env.GETIR_API_USERNAME || process.env.GETIR_API_USERNAME || '',
      apiPassword: env.GETIR_API_PASSWORD || process.env.GETIR_API_PASSWORD || '',
      apiInitialPassword: env.GETIR_API_INITIAL_PASSWORD || process.env.GETIR_API_INITIAL_PASSWORD || '',
      apiBaseUrl: env.GETIR_API_BASE_URL || process.env.GETIR_API_BASE_URL || '',
      apiEnv: env.GETIR_API_ENV || process.env.GETIR_API_ENV || 'dev'
    };
  }

  isConfigured(cfg) {
    return Boolean(
      cfg.shopId &&
      cfg.apiUsername &&
      cfg.apiPassword &&
      cfg.apiBaseUrl &&
      !isMissingConfigValue(cfg.apiPassword)
    );
  }

  async healthCheck(options = {}) {
    const cfg = await this.loadConfig();
    if (!this.isConfigured(cfg)) {
      const opsOrders = await canListGetirOpsOrders();
      if (opsOrders) {
        return {
          ok: true,
          configured: true,
          syncEnabled: this.syncEnabled,
          opsOrdersOnly: true,
          message: 'Getir API eksik — Ops/webhook kayıtlarından siparişler gösteriliyor'
        };
      }
      return {
        ok: false,
        configured: false,
        syncEnabled: this.syncEnabled,
        message: 'GETIR_SHOP_ID, GETIR_API_BASE_URL, GETIR_API_USERNAME ve GETIR_API_PASSWORD gerekli'
      };
    }

    if (!options.probe) {
      return {
        ok: true,
        configured: true,
        syncEnabled: this.syncEnabled,
        message: 'Getir API bilgileri kayıtlı'
      };
    }

    const probe = await probeGetirApi({
      shopId: cfg.shopId,
      username: cfg.apiUsername,
      password: cfg.apiPassword,
      baseUrl: cfg.apiBaseUrl,
      initialPassword: cfg.apiInitialPassword,
      env: cfg.apiEnv
    });
    return {
      ok: probe.ok,
      configured: true,
      syncEnabled: this.syncEnabled,
      message: probe.message,
      details: probe.details
    };
  }

  async fetchOrders() {
    return [];
  }
}
