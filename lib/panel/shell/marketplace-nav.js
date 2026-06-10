import { escapeHtml } from '../../platform/views/format.js';

/** Pazaryeri modülü alt navigasyonu — hızlı teslimat ile karışmaz */
export const MARKETPLACE_SUB_TABS = [
  { id: 'trendyol', href: '/marketplace/trendyol', label: 'Fiyat & Kâr', aliases: ['/komisyon-tarifesi'] },
  { id: 'buybox', href: '/marketplace/buybox', label: 'Buybox Takibi' },
  { id: 'orders', href: '/marketplace/orders', label: 'Sipariş Kârlılığı', aliases: ['/siparisler'] },
  { id: 'products', href: '/marketplace/products', label: 'Ürün Ayarları', aliases: ['/urunler'] },
  { id: 'shipping', href: '/marketplace/shipping', label: 'Kargo Maliyetleri' }
];

export function renderMarketplaceSubNav(activeSubTab, { pathname = '' } = {}) {
  const path = normalizePath(pathname);
  const links = MARKETPLACE_SUB_TABS.map((tab) => {
    const isActive = tab.id === activeSubTab
      || normalizePath(tab.href) === path
      || (tab.aliases || []).some((a) => normalizePath(a) === path);
    const active = isActive ? ' class="active"' : '';
    return `<a href="${escapeHtml(tab.href)}"${active}>${escapeHtml(tab.label)}</a>`;
  }).join('');

  return `<nav class="pf-marketplace-subnav trendyol-subnav" aria-label="Trendyol Pazaryeri">${links}</nav>`;
}

function normalizePath(pathname) {
  if (!pathname) return '';
  const p = pathname.split('?')[0];
  return p.endsWith('/') && p.length > 1 ? p.slice(0, -1) : p;
}

export function resolveMarketplaceSubTab(pathname, queryView) {
  const path = normalizePath(pathname);
  if (path === '/marketplace/buybox' || queryView === 'catalog') return 'buybox';
  if (path === '/marketplace/orders' || path === '/siparisler') return 'orders';
  if (path === '/marketplace/products' || path === '/urunler') return 'products';
  if (path === '/marketplace/shipping') return 'shipping';
  return 'trendyol';
}
