import { TrendyolMarketplaceAdapter } from './trendyol-marketplace.js';
import { GetirAdapter } from './getir.js';
import { UberEatsAdapter } from './uber-eats.js';
import { YemeksepetiAdapter } from './yemeksepeti.js';
import { WooCommerceAdapter } from './woocommerce.js';
import { CHANNEL_SCOPE } from '../platform/brand.js';

/**
 * Tek kanal kaynağı — operasyon, eşleştirme ve navigasyon buradan türetilir.
 * Aktif kanallar: trendyol-marketplace, uber-eats, woocommerce
 * Planlı: getir
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
    matchingRole: 'sales',
    description: 'BuyBox, ürün maliyeti, sipariş kârlılığı — tam operasyon',
    features: ['buybox', 'products', 'orders', 'profit', 'matching-catalog', 'benimpos-sale']
  },
  getir: {
    id: 'getir',
    label: 'Getir',
    shortLabel: 'Getir',
    route: '/getir',
    navTabId: 'getir',
    status: 'planned',
    scope: CHANNEL_SCOPE.ORDERS_PROFIT,
    matchingRole: 'sales',
    description: 'Sipariş takibi ve kâr/zarar analizi',
    features: ['orders', 'profit']
  },
  'uber-eats': {
    id: 'uber-eats',
    label: 'Uber Eats / Trendyol Go',
    shortLabel: 'Uber',
    route: '/uber-eats',
    navTabId: 'uber-eats',
    status: 'active',
    scope: CHANNEL_SCOPE.ORDERS_PROFIT,
    matchingRole: 'sales',
    description: 'Uber Eats Trendyol Go — sipariş takibi, eşleştirme ve BenimPOS satış',
    features: ['orders', 'profit', 'matching-catalog', 'matching-review', 'benimpos-sale']
  },
  yemeksepeti: {
    id: 'yemeksepeti',
    label: 'Yemeksepeti',
    shortLabel: 'YemekSepeti',
    route: '/yemeksepeti',
    navTabId: 'yemeksepeti',
    status: 'active',
    scope: CHANNEL_SCOPE.ORDERS_PROFIT,
    matchingRole: 'sales',
    description: 'Q-Commerce katalog eşleştirme aktif; sipariş API entegrasyonu YS tarafında açılınca devreye girer',
    features: ['orders', 'profit', 'matching-catalog']
  },
  woocommerce: {
    id: 'woocommerce',
    label: 'WooCommerce',
    shortLabel: 'WooCommerce',
    route: '/woocommerce',
    navTabId: 'woocommerce',
    status: 'active',
    scope: CHANNEL_SCOPE.ORDERS_PROFIT,
    matchingRole: 'sales',
    description: 'petfix.com.tr mağaza siparişleri — katalog eşleştirme ve kâr/zarar analizi',
    features: ['orders', 'profit', 'matching-catalog']
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

  const navChannels = [
    { channelId: 'trendyol-marketplace', label: 'Trendyol Pazaryeri' },
    { channelId: 'uber-eats' },
    { channelId: 'getir' },
    { channelId: 'yemeksepeti' }
  ];

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
    { id: 'dashboard', href: '/dashboard', label: 'Genel Bakış' },
    ...channelTabs,
    { id: 'benimpos', href: '/products', label: 'BenimPOS' },
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
