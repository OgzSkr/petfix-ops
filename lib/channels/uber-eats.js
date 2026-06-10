import { ChannelAdapter } from './base-adapter.js';
import { readEnvFile } from '../env.js';
import { paths } from '../config.js';
import { isMissingConfigValue } from '../env.js';
import { fetchUberEatsOrders } from './uber-eats-orders.js';
import { probeUberEatsApis } from './uber-eats-health.js';

/**
 * Uber Eats Trendyol Go — sipariş, katalog, eşleştirme ve BenimPOS satış hattı.
 * API: https://developers.tgoapps.com/
 */
export class UberEatsAdapter extends ChannelAdapter {
  constructor() {
    super('uber-eats', 'Uber Eats');
    this.syncEnabled = true;
    this.scope = 'orders-profit';
  }

  async loadConfig() {
    const env = await readEnvFile(paths.platformEnv);
    const apiKey = env.UBER_EATS_API_KEY || process.env.UBER_EATS_API_KEY || '';
    const apiSecret = env.UBER_EATS_API_SECRET || process.env.UBER_EATS_API_SECRET || '';

    return {
      supplierId: env.UBER_EATS_SUPPLIER_ID || process.env.UBER_EATS_SUPPLIER_ID || '',
      integrationRef: env.UBER_EATS_INTEGRATION_REF || process.env.UBER_EATS_INTEGRATION_REF || '',
      storeId: env.UBER_EATS_STORE_ID || process.env.UBER_EATS_STORE_ID || '',
      apiKey,
      apiSecret,
      channel: env.UBER_EATS_CHANNEL || process.env.UBER_EATS_CHANNEL || 'market',
      environment: env.UBER_EATS_ENV || process.env.UBER_EATS_ENV || 'PROD',
      authToken: buildAuthToken(apiKey, apiSecret)
    };
  }

  isConfigured(cfg) {
    return Boolean(
      cfg.supplierId &&
      cfg.apiKey &&
      cfg.apiSecret &&
      !isMissingConfigValue(cfg.apiKey) &&
      !isMissingConfigValue(cfg.apiSecret)
    );
  }

  async healthCheck(options = {}) {
    const cfg = await this.loadConfig();
    const configured = this.isConfigured(cfg);

    const base = {
      ok: configured,
      configured,
      syncEnabled: this.syncEnabled,
      scope: this.scope,
      channel: cfg.channel || 'market',
      message: configured
        ? 'Trendyol Go yapılandırıldı — operasyon panelinden tam sync çalıştırın'
        : 'Uber Eats Trendyol Go API bilgilerini Ayarlar sayfasından girin'
    };

    if (!configured || !options.probe) {
      return base;
    }

    const probe = await probeUberEatsApis(cfg);
    const apiOk = probe.orders.ok && probe.catalog.ok;
    return {
      ...base,
      ok: apiOk,
      probe,
      storeId: probe.catalog.storeId || cfg.storeId || null,
      message: apiOk
        ? `API bağlı · ${probe.catalog.message}`
        : [probe.orders.message, probe.catalog.message].filter(Boolean).join(' · ')
    };
  }

  async fetchOrders(options = {}) {
    if (!this.syncEnabled) {
      return [];
    }

    const cfg = await this.loadConfig();
    if (!this.isConfigured(cfg)) {
      return [];
    }

    if (cfg.channel === 'yemek') {
      throw new Error('Uber Eats Yemek hattı henüz desteklenmiyor — UBER_EATS_CHANNEL=market kullanın.');
    }

    return fetchUberEatsOrders(cfg, options);
  }

  normalizeOrder(order) {
    return {
      channel: 'uber-eats',
      orderNumber: String(order.orderNumber || order.id || ''),
      orderDateMs: order.orderDateMs || 0,
      status: order.status || '',
      salesAmount: Number(order.salesAmount || order.total || 0),
      raw: order
    };
  }
}

function buildAuthToken(apiKey, apiSecret) {
  if (!apiKey || !apiSecret || isMissingConfigValue(apiKey) || isMissingConfigValue(apiSecret)) {
    return '';
  }
  return Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
}
