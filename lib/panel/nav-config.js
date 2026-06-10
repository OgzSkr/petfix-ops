/**
 * PetFix Panel — dört bounded context navigasyonu.
 * İş kuralları ayrı modüllerde kalır; burada yalnızca bilgi mimarisi ve URL'ler.
 */

export const PANEL_MODULES = {
  general: {
    id: 'general',
    label: 'Genel',
    items: [
      { id: 'overview', href: '/dashboard', label: 'Genel Bakış', icon: 'overview' },
      { id: 'uber-eats', href: '/uber-eats', label: 'Uber Eats', icon: 'channel-uber' },
      { id: 'yemeksepeti', href: '/yemeksepeti', label: 'Yemeksepeti', icon: 'channel-ys' },
      { id: 'woocommerce', href: '/woocommerce', label: 'WooCommerce', icon: 'channel-woo' },
      { id: 'getir', href: '/getir', label: 'Getir', icon: 'channel-getir' }
    ]
  },
  products: {
    id: 'products',
    label: 'Ürün Merkezi',
    items: [
      { id: 'pool', href: '/products', label: 'Ana Ürün Havuzu', icon: 'pool', aliases: ['/urun-havuzu'] },
      { id: 'inbox', href: '/products/inbox', label: 'Gelen Kutusu', icon: 'inbox', badgeKey: 'inbox' },
      { id: 'mappings', href: '/products/mappings', label: 'Kanal Eşleşmeleri', icon: 'mappings' },
      { id: 'channel-costs', href: '/products/costs', label: 'Diğer Kanal Maliyetleri', icon: 'channel-costs', aliases: ['/kanal-maliyetleri'] },
      { id: 'data-quality', href: '/products/data-quality', label: 'Veri Kalitesi', icon: 'quality', badgeKey: 'quality' }
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
      { id: 'shipping', href: '/marketplace/shipping', label: 'Kargo Maliyetleri', icon: 'shipping' },
      { id: 'reports', href: '/marketplace/reports', label: 'Raporlar', icon: 'reports' }
    ]
  },
  quickCommerce: {
    id: 'quick-commerce',
    label: 'Hızlı Teslimat',
    items: [
      { id: 'overview', href: '/quick-commerce', label: 'Operasyon Genel Bakış', icon: 'qc-overview', aliases: ['/ops/panel', '/ops/panel/'] },
      { id: 'orders', href: '/quick-commerce/orders', label: 'Canlı Siparişler', icon: 'qc-orders' },
      { id: 'picking', href: '/quick-commerce/picking', label: 'Toplama Kuyruğu', icon: 'qc-picking', aliases: ['/ops', '/ops/'] },
      { id: 'couriers', href: '/quick-commerce/couriers', label: 'Kurye Yönetimi', icon: 'qc-couriers' },
      { id: 'integrations', href: '/quick-commerce/integrations', label: 'Kanal Entegrasyonları', icon: 'qc-integrations', aliases: ['/ops/integrations', '/ops/integrations/'] },
      { id: 'errors', href: '/quick-commerce/errors', label: 'Hatalı İşlemler', icon: 'qc-errors' },
      { id: 'health', href: '/quick-commerce/health', label: 'Sistem Sağlığı', icon: 'qc-health', aliases: ['/ops/durum', '/ops/durum/'] }
    ]
  },
  admin: {
    id: 'admin',
    label: 'Yönetim',
    items: [
      { id: 'branches', href: '/admin/branches', label: 'Şubeler', icon: 'branches' },
      { id: 'users', href: '/admin/users', label: 'Kullanıcılar', icon: 'users' },
      { id: 'status', href: '/admin/status', label: 'Sistem Durumu', icon: 'status' },
      { id: 'settings', href: '/admin/settings', label: 'Ayarlar', icon: 'settings', aliases: ['/ayarlar'] }
    ]
  }
};

/** Toplama/tablet modunda gösterilecek minimal QC menü */
export const QC_PICKING_NAV_IDS = new Set(['picking', 'orders']);

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
  const mod = PANEL_MODULES[activeModule];
  if (!mod) return { module: PANEL_MODULES.general, item: mod?.items?.[0] };
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
  '/eslestirme-merkezi': '/products',
  '/urun-havuzu': null,
  '/trendyol': '/marketplace/trendyol',
  '/komisyon-tarifesi': null,
  '/siparisler': '/marketplace/orders',
  '/ayarlar': '/admin/settings',
  '/ops': '/quick-commerce/picking',
  '/ops/panel': '/quick-commerce',
  '/ops/integrations': '/quick-commerce/integrations',
  '/ops/durum': '/quick-commerce/health',
  '/urunler': '/marketplace/products',
  '/kanal-maliyetleri': '/products/costs'
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
