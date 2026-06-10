import { ChannelAdapter } from './base-adapter.js';
import { isMissingConfigValue } from '../env.js';
import { readTrendyolEnv } from '../trendyol-env.js';

/**
 * Trendyol Pazaryeri — aktif kanal.
 * BuyBox, sipariş kârlılığı ve ürün ayarları mevcut platform servisleri üzerinden çalışır.
 */
export class TrendyolMarketplaceAdapter extends ChannelAdapter {
  constructor() {
    super('trendyol-marketplace', 'Trendyol Pazaryeri');
    this.legacyChannelId = 'trendyol';
    this.syncEnabled = true;
    this.scope = 'full';
  }

  async loadConfig() {
    const env = await readTrendyolEnv();
    return {
      sellerId: env.TRENDYOL_SELLER_ID || '',
      apiKey: env.TRENDYOL_API_KEY || '',
      apiSecret: env.TRENDYOL_API_SECRET || '',
      environment: env.TRENDYOL_ENVIRONMENT || 'PROD'
    };
  }

  isConfigured(cfg) {
    return Boolean(
      cfg.sellerId && cfg.apiKey && cfg.apiSecret &&
      !isMissingConfigValue(cfg.sellerId) &&
      !isMissingConfigValue(cfg.apiKey) &&
      !isMissingConfigValue(cfg.apiSecret)
    );
  }

  async healthCheck() {
    const cfg = await this.loadConfig();
    if (!this.isConfigured(cfg)) {
      return {
        ok: false,
        configured: false,
        syncEnabled: true,
        message: 'Trendyol Pazaryeri API bilgileri eksik — Ayarlar sayfasından yapılandırın'
      };
    }

    return {
      ok: true,
      configured: true,
      syncEnabled: true,
      message: 'Aktif — BuyBox, kârlılık ve BenimPOS satış hattı hazır'
    };
  }

  async fetchOrders(options = {}) {
    const cfg = await this.loadConfig();
    if (!this.isConfigured(cfg)) {
      return [];
    }

    const env = await readTrendyolEnv();
    const { fetchTrendyolOrders } = await import('../order-profitability.js');
    return fetchTrendyolOrders(env, options);
  }
}
