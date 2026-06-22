import { ChannelAdapter } from './base-adapter.js';
import { isMissingConfigValue } from '../env.js';
import { getChannelCredentials } from './credentials.js';
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

  async loadConfig(options = {}) {
    return getChannelCredentials({ channel: 'uber-eats', branchId: options.branchId || null });
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
