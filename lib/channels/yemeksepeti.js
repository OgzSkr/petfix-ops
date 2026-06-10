import { ChannelAdapter } from './base-adapter.js';
import { readEnvFile } from '../env.js';
import { paths } from '../config.js';
import { isMissingConfigValue } from '../env.js';
import { getYemeksepetiAccessToken } from './yemeksepeti-auth.js';

const API_BASE = 'https://yemeksepeti.partner.deliveryhero.io/v2';

/** Yemeksepeti Q-Commerce — read-only sipariş + kâr/zarar. */
export class YemeksepetiAdapter extends ChannelAdapter {
  constructor() {
    super('yemeksepeti', 'Yemeksepeti');
    this.syncEnabled = true;
    this.scope = 'orders-profit';
  }

  async loadConfig() {
    const env = await readEnvFile(paths.platformEnv);

    return {
      chainId: env.YEMEKSEPETI_CHAIN_ID || process.env.YEMEKSEPETI_CHAIN_ID || '',
      vendorId: env.YEMEKSEPETI_VENDOR_ID || process.env.YEMEKSEPETI_VENDOR_ID || '',
      clientId: env.YEMEKSEPETI_CLIENT_ID || process.env.YEMEKSEPETI_CLIENT_ID || '',
      clientSecret: env.YEMEKSEPETI_CLIENT_SECRET || process.env.YEMEKSEPETI_CLIENT_SECRET || ''
    };
  }

  isConfigured(cfg) {
    return Boolean(
      cfg.chainId &&
      cfg.vendorId &&
      cfg.clientId &&
      cfg.clientSecret &&
      !isMissingConfigValue(cfg.clientId) &&
      !isMissingConfigValue(cfg.clientSecret)
    );
  }

  partnerPortalUrl(chainId) {
    const id = String(chainId || '').trim();
    return id
      ? `https://partner-app.yemeksepeti.com/shops-integrations/chain/${encodeURIComponent(id)}`
      : 'https://partner-app.yemeksepeti.com/';
  }

  async healthCheck(options = {}) {
    const cfg = await this.loadConfig();
    const configured = this.isConfigured(cfg);
    const hasIds = Boolean(cfg.chainId && cfg.vendorId);
    const base = {
      configured,
      syncEnabled: this.syncEnabled,
      scope: this.scope,
      chainId: cfg.chainId || '',
      vendorId: cfg.vendorId || '',
      partnerPortalUrl: this.partnerPortalUrl(cfg.chainId)
    };

    if (!configured) {
      return {
        ...base,
        ok: false,
        message: hasIds
          ? 'Mağaza bilgileri tanımlı — Partner Portal OAuth (CLIENT_ID / CLIENT_SECRET) eksik'
          : 'Yemeksepeti Partner API bilgilerini Ayarlar sayfasından girin'
      };
    }

    if (!options.live) {
      return {
        ...base,
        ok: true,
        message: 'Read-only sipariş sync aktif — kâr/zarar analizi hazır'
      };
    }

    try {
      const token = await getYemeksepetiAccessToken(cfg);
      const catalogUrl =
        `${API_BASE}/chains/${encodeURIComponent(cfg.chainId)}/vendors/${encodeURIComponent(cfg.vendorId)}/catalog?page=1&page_size=1`;
      const catalogRes = await fetch(catalogUrl, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }
      });
      const catalogText = await catalogRes.text();
      if (!catalogRes.ok) {
        throw new Error(`Katalog API HTTP ${catalogRes.status}: ${catalogText.slice(0, 200)}`);
      }
      const catalogData = catalogText ? JSON.parse(catalogText) : {};
      const catalogPages = Number(catalogData.total_pages) || 0;

      const { fetchYemeksepetiOrders } = await import('./yemeksepeti-orders.js');
      const { fetchYemeksepetiOrdersFromOps } = await import('./yemeksepeti-ops-orders.js');
      const apiOrders = await fetchYemeksepetiOrders(cfg, { days: 7 });
      const opsOrders = await fetchYemeksepetiOrdersFromOps({ days: 7 });
      const orderCount = apiOrders.length + opsOrders.length;

      const parts = ['OAuth OK', 'katalog erişimi OK'];
      if (catalogPages > 0) parts.push(`${catalogPages} katalog sayfası`);
      parts.push(`Partner API (7g): ${apiOrders.length} sipariş`);
      if (opsOrders.length) parts.push(`Webhook/Ops (7g): ${opsOrders.length} sipariş`);
      if (!apiOrders.length && !opsOrders.length) {
        parts.push('YS tarafında kayıtlı sipariş yok — Partner Portal → Shop Integrations → test siparişi veya canlı sipariş bekleyin');
      }

      return {
        ...base,
        ok: true,
        oauth: true,
        catalogOk: true,
        catalogPages,
        ordersLast7Days: orderCount,
        partnerApiOrdersLast7Days: apiOrders.length,
        opsWebhookOrdersLast7Days: opsOrders.length,
        message: parts.join(' · ')
      };
    } catch (err) {
      return {
        ...base,
        ok: false,
        message: err?.message || 'Bağlantı testi başarısız'
      };
    }
  }

  async fetchOrders(options = {}) {
    if (!this.syncEnabled) {
      return [];
    }

    const cfg = await this.loadConfig();
    if (!this.isConfigured(cfg)) {
      return [];
    }

    const { fetchYemeksepetiOrders } = await import('./yemeksepeti-orders.js');
    const { mergeYemeksepetiOrderSources } = await import('./yemeksepeti-ops-orders.js');
    const apiOrders = await fetchYemeksepetiOrders(cfg, options);
    return mergeYemeksepetiOrderSources(apiOrders, options);
  }

  normalizeOrder(order) {
    return {
      channel: 'yemeksepeti',
      orderNumber: String(order.orderNumber || ''),
      orderDateMs: order.orderDateMs || 0,
      status: order.status || '',
      salesAmount: Number(order.salesAmount || 0),
      raw: order
    };
  }
}
