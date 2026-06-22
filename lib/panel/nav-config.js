/**
 * PetFix Ops — HzlMrktOps ve Yönetim modül navigasyonu.
 */

import { HZLMRKTOPS_BASE } from '../hzlmrktops/constants.js';

export const PANEL_MODULES = {
  hzlmrktops: {
    id: 'hzlmrktops',
    label: 'HzlMrktOps',
    items: [
      { id: 'dashboard', href: HZLMRKTOPS_BASE, label: 'Ana Panel', shortLabel: 'Panel', hint: 'Kanal ve otomasyon özeti', icon: 'mn-dashboard', aliases: ['/quick-commerce', '/dashboard'] },
      { id: 'orders', href: `${HZLMRKTOPS_BASE}/siparisler`, label: 'Siparişler', shortLabel: 'Sipariş', hint: 'Gelen ve tamamlanan siparişler', icon: 'orders', aliases: [`${HZLMRKTOPS_BASE}/profit`, `${HZLMRKTOPS_BASE}/orders`, '/quick-commerce/orders', `${HZLMRKTOPS_BASE}/orders/uber-eats`, `${HZLMRKTOPS_BASE}/orders/yemeksepeti`, `${HZLMRKTOPS_BASE}/orders/getir`, '/uber-eats', '/yemeksepeti', '/getir'] },
      { id: 'reports', href: `${HZLMRKTOPS_BASE}/raporlar`, label: 'Raporlar', shortLabel: 'Rapor', hint: 'Satış, kanal ve ürün özeti', icon: 'reports' },
      { id: 'customers', href: `${HZLMRKTOPS_BASE}/musteriler`, label: 'Müşteriler', shortLabel: 'Müşteri', hint: 'Sipariş veren müşteriler', icon: 'users' },
      { id: 'products', href: `${HZLMRKTOPS_BASE}/urunler`, label: 'Ürünler', shortLabel: 'Ürün', hint: 'Eşleştirme, fiyat ve stok', icon: 'products', aliases: [`${HZLMRKTOPS_BASE}/matching`, `${HZLMRKTOPS_BASE}/matching/inbox`, `${HZLMRKTOPS_BASE}/matching/mappings`, `${HZLMRKTOPS_BASE}/matching/masters`, `${HZLMRKTOPS_BASE}/sync`, '/products', '/eslestirme-merkezi', '/products/inbox', '/products/mappings', '/urun-havuzu', '/urunler'] },
      { id: 'integrations', href: `${HZLMRKTOPS_BASE}/integrations`, label: 'Kanallar', shortLabel: 'Kanal', hint: 'Getir, YS, Uber kurulumu', icon: 'integrations', aliases: ['/ops/integrations', '/quick-commerce/integrations'] },
      { id: 'system', href: `${HZLMRKTOPS_BASE}/sistem`, label: 'Sistem Nabzı', shortLabel: 'Sistem', hint: 'Otomatik işlerin durumu', icon: 'status', aliases: ['/ops/system', '/quick-commerce/system'] }
    ]
  },
  admin: {
    id: 'admin',
    label: 'Yönetim',
    items: [
      { id: 'branches', href: '/admin/branches', label: 'Şubeler', shortLabel: 'Şube', icon: 'branches' },
      { id: 'users', href: '/admin/users', label: 'Personel', shortLabel: 'Personel', icon: 'users' },
      { id: 'status', href: '/admin/status', label: 'Sistem Durumu', shortLabel: 'Durum', icon: 'status' },
      { id: 'settings', href: '/admin/settings', label: 'Ayarlar', shortLabel: 'Ayar', icon: 'settings', aliases: ['/ayarlar'] }
    ]
  }
};

/** Toplama/tablet modunda gösterilecek minimal HzlMrktOps menü */
export const QC_PICKING_NAV_IDS = new Set(['dashboard']);

/** Sol menüde gösterilecek Pazaryeri öğeleri — ops reposunda kullanılmaz */
export const MARKETPLACE_SIDEBAR_NAV_IDS = new Set();

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
  '/siparisler': `${HZLMRKTOPS_BASE}/siparisler`,
  '/ayarlar': '/admin/settings',
  '/ops': HZLMRKTOPS_BASE,
  '/ops/panel': HZLMRKTOPS_BASE,
  '/ops/integrations': `${HZLMRKTOPS_BASE}/integrations`,
  '/ops/system': `${HZLMRKTOPS_BASE}/sistem`,
  '/ops/durum': '/admin/status',
  '/urunler': `${HZLMRKTOPS_BASE}/urunler`,
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
  '/quick-commerce/integrations': `${HZLMRKTOPS_BASE}/integrations`,
  '/quick-commerce/errors': HZLMRKTOPS_BASE,
  '/quick-commerce/health': '/admin/status',
  '/getir': `${HZLMRKTOPS_BASE}/siparisler`,
  '/uber-eats': `${HZLMRKTOPS_BASE}/siparisler`,
  '/yemeksepeti': `${HZLMRKTOPS_BASE}/siparisler`,
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
