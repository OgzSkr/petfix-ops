import { TrendyolMarketplaceAdapter } from './trendyol-marketplace.js';
import { GetirAdapter } from './getir.js';
import { UberEatsAdapter } from './uber-eats.js';
import { YemeksepetiAdapter } from './yemeksepeti.js';
import { WooCommerceAdapter } from './woocommerce.js';
import { CHANNEL_SCOPE } from '../platform/brand.js';
import { PRODUCT_LINE } from '../hzlmrktops/constants.js';

/**
 * Tek kanal kaynağı — operasyon, eşleştirme ve navigasyon buradan türetilir.
 * productLine: hzlmrktops | marketplace | ecommerce
 */
export const CHANNELS = {
  'trendyol-marketplace': {
    id: 'trendyol-marketplace',
    label: 'Trendyol Pazaryeri',
    shortLabel: 'Trendyol',
    route: '/marketplace/trendyol',
    ordersRoute: '/marketplace/orders',
    navTabId: 'trendyol',
    status: 'active',
    scope: CHANNEL_SCOPE.FULL,
    productLine: PRODUCT_LINE.MARKETPLACE,
    matchingRole: null,
    description: 'BuyBox, ürün maliyeti, sipariş kârlılığı — pazaryeri modülü',
    features: ['buybox', 'products', 'orders', 'profit']
  },
  getir: {
    id: 'getir',
    label: 'Getir',
    shortLabel: 'Getir',
    route: '/hzlmrktops/siparisler',
    navTabId: 'getir',
    status: 'active',
    scope: CHANNEL_SCOPE.ORDERS_PROFIT,
    productLine: PRODUCT_LINE.HZLMRKTOPS,
    matchingRole: 'sales',
    description: 'HzlMrktOps — Getir Çarşı sipariş ve eşleştirme',
    features: ['orders', 'profit', 'matching-catalog', 'matching-review', 'benimpos-sale']
  },
  'uber-eats': {
    id: 'uber-eats',
    label: 'Uber Eats / Trendyol Go',
    shortLabel: 'Uber',
    route: '/hzlmrktops/siparisler',
    navTabId: 'uber-eats',
    status: 'active',
    scope: CHANNEL_SCOPE.ORDERS_PROFIT,
    productLine: PRODUCT_LINE.HZLMRKTOPS,
    matchingRole: 'sales',
    description: 'HzlMrktOps — TGO/Uber sipariş, eşleştirme ve BenimPOS satış',
    features: ['orders', 'profit', 'matching-catalog', 'matching-review', 'benimpos-sale']
  },
  yemeksepeti: {
    id: 'yemeksepeti',
    label: 'Yemeksepeti',
    shortLabel: 'YemekSepeti',
    route: '/hzlmrktops/siparisler',
    navTabId: 'yemeksepeti',
    status: 'active',
    scope: CHANNEL_SCOPE.ORDERS_PROFIT,
    productLine: PRODUCT_LINE.HZLMRKTOPS,
    matchingRole: 'sales',
    description: 'HzlMrktOps — YS Hızlı Market sipariş ve katalog eşleştirme',
    features: ['orders', 'profit', 'matching-catalog', 'matching-review', 'benimpos-sale']
  },
  woocommerce: {
    id: 'woocommerce',
    label: 'WooCommerce',
    shortLabel: 'WooCommerce',
    route: '/ecommerce/woocommerce',
    navTabId: 'woocommerce',
    status: 'active',
    scope: CHANNEL_SCOPE.ORDERS_PROFIT,
    productLine: PRODUCT_LINE.ECOMMERCE,
    matchingRole: null,
    description: 'E-ticaret modülü — petfix.com.tr mağaza siparişleri',
    features: ['orders', 'profit']
  }
};

const adapters = {
  'trendyol-marketplace': new TrendyolMarketplaceAdapter(),
  getir: new GetirAdapter(),
  'uber-eats': new UberEatsAdapter(),
  yemeksepeti: new YemeksepetiAdapter(),
  woocommerce: new WooCommerceAdapter()
};

export function listChannels() {
  return Object.values(CHANNELS);
}

export function listActiveChannels() {
  return listChannels().filter((channel) => channel.status === 'active');
}

export function listPlannedChannels() {
  return listChannels().filter((channel) => channel.status === 'planned');
}

export function listOrderProfitChannels() {
  return listChannels().filter((channel) => channel.scope === CHANNEL_SCOPE.ORDERS_PROFIT);
}

export function listMatchingSalesChannels() {
  return listChannels().filter((channel) => channel.matchingRole === 'sales');
}

export function listActiveMatchingSalesChannels() {
  return listMatchingSalesChannels().filter((channel) => channel.status === 'active');
}

export function listHzlMrktOpsChannels() {
  return listChannels().filter((channel) => channel.productLine === PRODUCT_LINE.HZLMRKTOPS);
}

export function listActiveHzlMrktOpsChannels() {
  return listHzlMrktOpsChannels().filter((channel) => channel.status === 'active');
}

export function listHzlMrktOpsMatchingSalesChannels() {
  return listMatchingSalesChannels().filter((channel) => channel.productLine === PRODUCT_LINE.HZLMRKTOPS);
}

export function listActiveHzlMrktOpsMatchingSalesChannels() {
  return listHzlMrktOpsMatchingSalesChannels().filter((channel) => channel.status === 'active');
}

export function listMarketplaceChannels() {
  return listChannels().filter((channel) => channel.productLine === PRODUCT_LINE.MARKETPLACE);
}

export function listEcommerceChannels() {
  return listChannels().filter((channel) => channel.productLine === PRODUCT_LINE.ECOMMERCE);
}

export function getChannel(channelId) {
  return CHANNELS[channelId] || null;
}

export function getChannelAdapter(channelId) {
  return adapters[channelId] || null;
}

export function channelHasFeature(channelId, feature) {
  const channel = getChannel(channelId);
  return Boolean(channel?.features?.includes(feature));
}

export function channelShortLabel(channelId) {
  const channel = getChannel(channelId);
  return channel?.shortLabel || channelId;
}

export function listPlatformNavTabs() {
  const channelById = (id) => CHANNELS[id] || null;

  const navChannels = listActiveHzlMrktOpsChannels().map((channel) => ({
    channelId: channel.id,
    label: channel.label
  }));

  const channelTabs = navChannels.map(({ channelId, label }) => {
    const channel = channelById(channelId);
    if (!channel) return null;
    return {
      id: channel.navTabId || channel.id,
      href: channel.route,
      label: label || channel.label,
      badge: channel.status === 'planned' ? 'yakında' : null
    };
  }).filter(Boolean);

  return [
    { id: 'hzlmrktops', href: '/hzlmrktops', label: 'HzlMrktOps' },
    ...channelTabs,
    { id: 'marketplace', href: '/marketplace/trendyol', label: 'Pazaryeri' },
    { id: 'ecommerce', href: '/ecommerce/woocommerce', label: 'E-Ticaret' },
    { id: 'ayarlar', href: '/admin/settings', label: 'Ayarlar' }
  ];
}

export function getActiveChannelAdapters() {
  return listActiveChannels()
    .map((channel) => adapters[channel.id])
    .filter(Boolean);
}

export async function getChannelsHealth() {
  const rows = [];

  for (const channel of listChannels()) {
    const adapter = adapters[channel.id];
    const health = adapter ? await adapter.healthCheck() : { ok: false, message: 'Adapter yok' };
    rows.push({
      ...channel,
      health
    });
  }

  return rows;
}
