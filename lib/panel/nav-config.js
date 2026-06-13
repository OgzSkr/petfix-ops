/**
 * PetFix Panel — HzlMrktOps, Pazaryeri ve E-Ticaret modül navigasyonu.
 */

import { HZLMRKTOPS_BASE } from '../marketnext/constants.js';

export const PANEL_MODULES = {
  hzlmrktops: {
    id: 'hzlmrktops',
    label: 'HzlMrktOps',
    items: [
      { id: 'dashboard', href: HZLMRKTOPS_BASE, label: 'Ana Panel', icon: 'mn-dashboard', aliases: ['/quick-commerce', '/dashboard', '/marketnext'] },
      { id: 'orders', href: `${HZLMRKTOPS_BASE}/siparisler`, label: 'Siparişler', icon: 'orders', aliases: [`${HZLMRKTOPS_BASE}/profit`, `${HZLMRKTOPS_BASE}/orders`, '/quick-commerce/orders', `${HZLMRKTOPS_BASE}/orders/uber-eats`, `${HZLMRKTOPS_BASE}/orders/yemeksepeti`, `${HZLMRKTOPS_BASE}/orders/getir`, '/uber-eats', '/yemeksepeti', '/getir', '/marketnext/siparisler', '/marketnext/profit', '/marketnext/orders'] },
      { id: 'products', href: `${HZLMRKTOPS_BASE}/urunler`, label: 'Ürünler', icon: 'products', aliases: [`${HZLMRKTOPS_BASE}/matching`, `${HZLMRKTOPS_BASE}/matching/inbox`, `${HZLMRKTOPS_BASE}/matching/mappings`, `${HZLMRKTOPS_BASE}/matching/masters`, `${HZLMRKTOPS_BASE}/sync`, '/products', '/eslestirme-merkezi', '/products/inbox', '/products/mappings', '/urun-havuzu', '/marketnext/urunler', '/marketnext/matching', '/marketnext/sync'] }
    ]
  },
  marketplace: {
    id: 'marketplace',
    label: 'Pazaryeri & Buybox',
    items: [
      { id: 'trendyol', href: '/marketplace/trendyol', label: 'Trendyol Pazaryeri', icon: 'trendyol', aliases: ['/komisyon-tarifesi', '/trendyol'] },
      { id: 'buybox', href: '/marketplace/buybox', label: 'Buybox Takibi', icon: 'buybox' },
      { id: 'profit', href: '/marketplace/profit', label: 'Fiyat ve Kâr', icon: 'profit' },
      { id: 'orders', href: '/marketplace/orders', label: 'Sipariş Kârlılığı', icon: 'orders', aliases: ['/siparisler'] },
      { id: 'products', href: '/marketplace/products', label: 'Ürün Ayarları', icon: 'products', aliases: ['/urunler'] },
      { id: 'shipping', href: '/marketplace/shipping', label: 'Kargo Maliyetleri', icon: 'shipping' }
    ]
  },
  ecommerce: {
    id: 'ecommerce',
    label: 'E-Ticaret',
    items: [
      { id: 'woocommerce', href: '/ecommerce/woocommerce', label: 'WooCommerce', icon: 'channel-woo', aliases: ['/woocommerce'] },
      { id: 'woocommerce-orders', href: '/ecommerce/woocommerce/orders', label: 'Siparişler', icon: 'orders' }
    ]
  },
  admin: {
    id: 'admin',
    label: 'Yönetim',
    items: [
      { id: 'branches', href: '/admin/branches', label: 'Şubeler', icon: 'branches', tag: 'Yakında' },
      { id: 'users', href: '/admin/users', label: 'Kullanıcılar', icon: 'users', tag: 'Yakında' },
      { id: 'status', href: '/admin/status', label: 'Sistem Durumu', icon: 'status' },
      { id: 'settings', href: '/admin/settings', label: 'Ayarlar', icon: 'settings', aliases: ['/ayarlar'] }
    ]
  }
};

/** @deprecated use PANEL_MODULES.hzlmrktops */
export const MARKETNEXT_PANEL_MODULE = PANEL_MODULES.hzlmrktops;

/** Toplama/tablet modunda gösterilecek minimal HzlMrktOps menü */
export const QC_PICKING_NAV_IDS = new Set(['dashboard']);

export function listPanelModules() {
  return Object.values(PANEL_MODULES);
}

export function findNavItemByPath(pathname) {
  const path = normalizePath(pathname);
  for (const mod of listPanelModules()) {
    for (const item of mod.items) {
      if (normalizePath(item.href) === path) {
        return { module: mod, item };
      }
      for (const alias of item.aliases || []) {
        if (normalizePath(alias) === path) {
          return { module: mod, item, alias: true };
        }
      }
    }
  }
  return null;
}

export function resolveActiveNav(activeModule, activeItem) {
  const mod = PANEL_MODULES[activeModule] || PANEL_MODULES.hzlmrktops;
  const item = mod.items.find((i) => i.id === activeItem) || mod.items[0];
  return { module: mod, item };
}

function normalizePath(pathname) {
  if (!pathname || pathname === '/') return '/';
  return pathname.endsWith('/') && pathname.length > 1
    ? pathname.slice(0, -1)
    : pathname;
}

/** Eski URL → yeni canonical URL (query korunur) */
export const LEGACY_REDIRECTS = {
  '/eslestirme-merkezi': `${HZLMRKTOPS_BASE}/urunler`,
  '/urun-havuzu': `${HZLMRKTOPS_BASE}/urunler`,
  '/trendyol': '/marketplace/trendyol',
  '/komisyon-tarifesi': null,
  '/siparisler': '/marketplace/orders',
  '/ayarlar': '/admin/settings',
  '/ops': HZLMRKTOPS_BASE,
  '/ops/panel': HZLMRKTOPS_BASE,
  '/ops/integrations': '/admin/settings',
  '/ops/durum': '/admin/status',
  '/urunler': '/marketplace/products',
  '/dashboard': HZLMRKTOPS_BASE,
  '/products': `${HZLMRKTOPS_BASE}/urunler`,
  '/products/inbox': `${HZLMRKTOPS_BASE}/urunler`,
  '/products/mappings': `${HZLMRKTOPS_BASE}/urunler`,
  '/products/data-quality': `${HZLMRKTOPS_BASE}/urunler`,
  '/kanal-maliyetleri': `${HZLMRKTOPS_BASE}/urunler`,
  '/products/costs': `${HZLMRKTOPS_BASE}/urunler`,
  '/quick-commerce': HZLMRKTOPS_BASE,
  '/quick-commerce/orders': `${HZLMRKTOPS_BASE}/siparisler`,
  '/quick-commerce/picking': HZLMRKTOPS_BASE,
  '/quick-commerce/integrations': '/admin/settings',
  '/quick-commerce/errors': HZLMRKTOPS_BASE,
  '/quick-commerce/health': '/admin/status',
  '/getir': `${HZLMRKTOPS_BASE}/siparisler`,
  '/uber-eats': `${HZLMRKTOPS_BASE}/siparisler`,
  '/yemeksepeti': `${HZLMRKTOPS_BASE}/siparisler`,
  '/marketnext': HZLMRKTOPS_BASE,
  '/marketnext/profit': `${HZLMRKTOPS_BASE}/siparisler`,
  '/marketnext/orders': `${HZLMRKTOPS_BASE}/siparisler`,
  '/marketnext/siparisler': `${HZLMRKTOPS_BASE}/siparisler`,
  '/marketnext/urunler': `${HZLMRKTOPS_BASE}/urunler`,
  '/marketnext/picking': HZLMRKTOPS_BASE,
  '/marketnext/integrations': '/admin/settings',
  '/marketnext/errors': HZLMRKTOPS_BASE,
  '/marketnext/health': '/admin/status',
  '/marketnext/orders/uber-eats': `${HZLMRKTOPS_BASE}/siparisler`,
  '/marketnext/orders/yemeksepeti': `${HZLMRKTOPS_BASE}/siparisler`,
  '/marketnext/orders/getir': `${HZLMRKTOPS_BASE}/siparisler`,
  '/marketnext/matching': `${HZLMRKTOPS_BASE}/urunler`,
  '/marketnext/matching/inbox': `${HZLMRKTOPS_BASE}/urunler`,
  '/marketnext/matching/mappings': `${HZLMRKTOPS_BASE}/urunler`,
  '/marketnext/matching/masters': `${HZLMRKTOPS_BASE}/urunler`,
  '/marketnext/matching/data-quality': `${HZLMRKTOPS_BASE}/urunler`,
  '/marketnext/sync': `${HZLMRKTOPS_BASE}/urunler`,
  '/woocommerce': '/ecommerce/woocommerce',
  [`${HZLMRKTOPS_BASE}/integrations`]: '/admin/settings',
  [`${HZLMRKTOPS_BASE}/health`]: '/admin/status',
  [`${HZLMRKTOPS_BASE}/errors`]: HZLMRKTOPS_BASE,
  [`${HZLMRKTOPS_BASE}/picking`]: HZLMRKTOPS_BASE
};

export function buildLegacyRedirect(pathname, searchParams) {
  const path = normalizePath(pathname);
  const trailing = pathname.endsWith('/') && path !== pathname ? '/' : '';
  const target = LEGACY_REDIRECTS[path];
  if (target === undefined) return null;
  if (target === null) return null;

  const qs = searchParams?.toString();
  return qs ? `${target}${trailing}?${qs}` : `${target}${trailing}`;
}
