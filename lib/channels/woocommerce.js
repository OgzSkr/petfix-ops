import { ChannelAdapter } from './base-adapter.js';
import { readEnvFile } from '../env.js';
import { paths } from '../config.js';
import { isMissingConfigValue } from '../env.js';
import { fetchWooCommerceOrders } from './woocommerce-orders.js';

/** WooCommerce mağaza — read-only sipariş + kâr/zarar. */
export class WooCommerceAdapter extends ChannelAdapter {
  constructor() {
    super('woocommerce', 'WooCommerce');
    this.syncEnabled = true;
    this.scope = 'orders-profit';
  }

  async loadConfig() {
    const env = await readEnvFile(paths.platformEnv);
    return {
      baseUrl: String(env.WOOCOMMERCE_URL || process.env.WOOCOMMERCE_URL || '').replace(/\/$/, ''),
      key: env.WOOCOMMERCE_KEY || process.env.WOOCOMMERCE_KEY || '',
      secret: env.WOOCOMMERCE_SECRET || process.env.WOOCOMMERCE_SECRET || ''
    };
  }

  isConfigured(cfg) {
    return Boolean(cfg.baseUrl && cfg.key && cfg.secret && !isMissingConfigValue(cfg.key));
  }

  buildAuthHeader(cfg) {
    return `Basic ${Buffer.from(`${cfg.key}:${cfg.secret}`).toString('base64')}`;
  }

  async pingApi(cfg) {
    const url = new URL(`${cfg.baseUrl}/wp-json/wc/v3/orders`);
    url.searchParams.set('per_page', '1');

    const response = await fetch(url, {
      headers: {
        Authorization: this.buildAuthHeader(cfg),
        Accept: 'application/json'
      }
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}${body ? `: ${body.slice(0, 120)}` : ''}`);
    }

    return true;
  }

  async healthCheck(options = {}) {
    const cfg = await this.loadConfig();
    if (!this.isConfigured(cfg)) {
      return {
        ok: false,
        configured: false,
        syncEnabled: this.syncEnabled,
        scope: this.scope,
        message: 'WooCommerce REST bilgileri eksik — Ayarlar sayfasından mağaza URL ve anahtarları girin'
      };
    }

    if (options.live) {
      try {
        await this.pingApi(cfg);
        return {
          ok: true,
          configured: true,
          syncEnabled: this.syncEnabled,
          scope: this.scope,
          message: 'Bağlantı OK — read-only sipariş sync aktif'
        };
      } catch (error) {
        return {
          ok: false,
          configured: true,
          syncEnabled: this.syncEnabled,
          scope: this.scope,
          message: `Bağlantı hatası: ${error.message}`
        };
      }
    }

    return {
      ok: true,
      configured: true,
      syncEnabled: this.syncEnabled,
      scope: this.scope,
      message: 'Read-only sipariş sync aktif — kâr/zarar analizi hazır'
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

    return fetchWooCommerceOrders(cfg, options);
  }

  normalizeOrder(order) {
    return {
      channel: 'woocommerce',
      orderNumber: String(order.orderNumber || ''),
      orderDateMs: order.orderDate ? new Date(order.orderDate).getTime() : 0,
      status: order.status || '',
      salesAmount: Number(order.packageGrossAmount || 0) - Number(order.packageTotalDiscount || 0),
      raw: order
    };
  }
}
