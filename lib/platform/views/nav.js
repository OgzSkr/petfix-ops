import { escapeHtml, jsonForHtml } from './format.js';
import { PLATFORM_NAME, PLATFORM_SHORT } from '../brand.js';
import { listPlatformNavTabs, getChannel, channelHasFeature } from '../../channels/registry.js';
import { buildOrdersPageBootstrap } from './orders-bootstrap.js';
import { renderBenimposSaleFragment, renderBenimposReadinessBanner } from './orders-page-fragments.js';

import { renderMarketplaceSubNav } from '../../panel/shell/marketplace-nav.js';
import { wrapPanelPage } from '../../panel/shell/wrap-panel-page.js';
import { renderChannelLogo } from '../../panel/components/channel-logos.js';

const TRENDYOL_SUB_TABS = [
  { id: 'pricing', href: '/marketplace/trendyol', label: 'Fiyat & Kâr' },
  { id: 'orders', href: '/marketplace/orders', label: 'Sipariş Kârlılığı' },
  { id: 'products', href: '/marketplace/products', label: 'Ürün Ayarları' }
];

export function renderLogoutButton(auth) {
  if (!auth.isEnabled()) return '';
  return '<button type="button" id="logoutBtn" class="platform-logout" aria-label="Çıkış yap">Çıkış</button>';
}

export function renderPlatformTopNav(activeTab, auth) {
  const logoutBtn = renderLogoutButton(auth);
  const links = listPlatformNavTabs().map((tab) => {
    const active = tab.id === activeTab ? ' class="active" aria-current="page"' : '';
    const badge = tab.badge
      ? ` <span class="platform-nav-badge">${escapeHtml(tab.badge)}</span>`
      : '';
    return `<a href="${tab.href}"${active}>${escapeHtml(tab.label)}${badge}</a>`;
  }).join('');

  return `<header class="platform-header">
    <div class="platform-header-inner">
      <a class="platform-brand" href="/dashboard">
        <span class="platform-logo" aria-hidden="true">PF</span>
        <span class="platform-brand-text">
          <strong>${escapeHtml(PLATFORM_SHORT)}</strong>
          <span class="platform-tagline">${escapeHtml(PLATFORM_NAME)}</span>
        </span>
      </a>
      <button type="button" class="platform-nav-toggle" id="platformNavToggle" aria-expanded="false" aria-controls="platformTopNav">Menü</button>
      <div class="platform-header-actions">
        <nav class="platform-topnav" id="platformTopNav" aria-label="Ana navigasyon">${links}</nav>
        ${logoutBtn}
      </div>
    </div>
  </header>`;
}

export function renderTrendyolSubNav(activeSubTab) {
  const map = {
    pricing: 'trendyol',
    trendyol: 'trendyol',
    buybox: 'buybox',
    orders: 'orders',
    products: 'products',
    shipping: 'shipping'
  };
  return renderMarketplaceSubNav(map[activeSubTab] || activeSubTab);
}

export function renderTrendyolSubNavLegacy(activeSubTab) {
  const links = TRENDYOL_SUB_TABS.map((tab) => {
    const active = tab.id === activeSubTab ? ' class="active"' : '';
    return `<a href="${tab.href}"${active}>${escapeHtml(tab.label)}</a>`;
  }).join('');

  return `<nav class="trendyol-subnav" aria-label="Trendyol Pazaryeri">${links}</nav>`;
}

export function renderChannelOrdersPage({ channelId, auth, productMatchingMode = 'legacy' }) {
  const channel = getChannel(channelId);
  const channelLabel = channel?.label || channelId;
  const bootstrapPayload = buildOrdersPageBootstrap({ channelId, auth, productMatchingMode });
  const bootstrap = jsonForHtml(bootstrapPayload);
  const benimposSaleEnabled = channelHasFeature(channelId, 'benimpos-sale');
  const benimposAssets = renderBenimposSaleFragment(benimposSaleEnabled);

  const benimposModal = benimposAssets.modal;
  const benimposScript = benimposAssets.script;

  const innerHtml = `
      <div class="orders-wrap">
        <section class="panel channel-orders-intro">
          <h2 class="channel-orders-heading">${renderChannelLogo(channelId, { size: 'md' })}<span>${escapeHtml(channelLabel)}</span></h2>
          <p class="platform-lead">Sipariş takibi ve kâr/zarar analizi. Maliyetler <a href="/products/mappings">Kanal Eşleşmeleri</a> sayfasından yönetilir (Trendyol Pazaryeri maliyetlerinden ayrı).</p>
          <p class="orders-source-note muted" id="ordersSourceNote" hidden></p>
          <div id="channelHealth" class="channel-health">Durum yükleniyor…</div>
          ${renderBenimposReadinessBanner()}
        </section>

        ${channelId === 'uber-eats' ? `<nav class="orders-subnav" id="uberOrdersSubnav" role="tablist" aria-label="Uber Eats görünümü">
          <button type="button" class="orders-subnav-tab active" data-orders-view="orders" role="tab" aria-selected="true">Sipariş Kârlılığı</button>
          <button type="button" class="orders-subnav-tab" data-orders-view="loss-products" role="tab" aria-selected="false">Zarar Eden Ürünler</button>
        </nav>` : ''}

        <section class="ops-summary-strip ops-summary-strip--orders" id="ordersSummaryStrip" aria-live="polite">
          <div class="ops-summary-item"><span>Dönem siparişi</span><strong id="statCount">—</strong></div>
          <div class="ops-summary-item"><span>Toplam ciro</span><strong id="statSales">—</strong></div>
          <div class="ops-summary-item"><span>Toplam net kâr</span><strong id="statProfit">—</strong></div>
          <div class="ops-summary-item"><span>Ort. kâr / sipariş</span><strong id="statAvgProfit">—</strong></div>
          <div class="ops-summary-item ops-summary-item--ok"><span>Kârlı</span><strong id="statProfitable">—</strong></div>
          <div class="ops-summary-item ops-summary-item--danger"><span>Zarar</span><strong id="statLoss">—</strong></div>
          <div class="ops-summary-item ops-summary-item--warn"><span>Veri uyarısı</span><strong id="statWarnings">—</strong></div>
        </section>

        <section class="ops-summary-strip ops-summary-strip--orders ops-summary-strip--matching" id="ordersMatchingStrip" hidden aria-live="polite">
          <div class="ops-summary-item"><span>Satır (dönem)</span><strong id="matchStatTotal">—</strong></div>
          <div class="ops-summary-item ops-summary-item--ok"><span>Eşleştirilmiş</span><strong id="matchStatMapped">—</strong></div>
          <div class="ops-summary-item ops-summary-item--warn"><span>Eşleşmemiş</span><strong id="matchStatUnmapped">—</strong></div>
          <div class="ops-summary-item"><span>Legacy yedek</span><strong id="matchStatFallback">—</strong></div>
        </section>

        <div class="orders-matching-banner" id="ordersMatchingBanner" hidden aria-live="polite"></div>

        <div class="orders-quality-banner" id="ordersQualityBanner" hidden aria-live="polite"></div>

        <div class="orders-quick-filters" id="ordersQuickFilters" role="group" aria-label="Kârlılık hızlı filtre">
          <span class="orders-quick-label">Hızlı filtre:</span>
          <button type="button" class="orders-quick-btn active" data-profit="all">Tümü</button>
          <button type="button" class="orders-quick-btn" data-profit="loss">Zarar</button>
          <button type="button" class="orders-quick-btn" data-profit="profit">Kârlı</button>
          <button type="button" class="orders-quick-btn" data-profit="zero">Sıfır kâr</button>
        </div>

        <form id="ordersFilterForm" class="orders-filter-card">
          <div class="orders-filter-grid">
            <div>
              <label for="daysSelect">Dönem</label>
              <select id="daysSelect" name="days">
                <option value="1">Bugün</option>
                <option value="7">Son 7 gün</option>
                <option value="14" selected>Son 14 gün</option>
                <option value="30">Son 30 gün</option>
                <option value="60">Son 60 gün</option>
                <option value="custom">Özel tarih aralığı</option>
              </select>
            </div>
            <div class="custom-date-field">
              <label for="startDate">Başlangıç</label>
              <input type="date" id="startDate" name="startDate" disabled>
            </div>
            <div class="custom-date-field">
              <label for="endDate">Bitiş</label>
              <input type="date" id="endDate" name="endDate" disabled>
            </div>
            <div>
              <label for="statusFilter">Sipariş durumu</label>
              <select id="statusFilter" name="status">
                <option value="">Tüm durumlar</option>
              </select>
            </div>
            <div id="matchingFilterField" hidden>
              <label for="matchingFilter">Eşleştirme</label>
              <select id="matchingFilter" name="matching">
                <option value="all">Tüm siparişler</option>
                <option value="unmapped">Eşleşmemiş satır var</option>
                <option value="needs_review">Kontrol gereken satır</option>
              </select>
            </div>
            <div>
              <label for="profitFilter">Kârlılık</label>
              <select id="profitFilter" name="profit">
                <option value="all">Tüm siparişler</option>
                <option value="profit">Kârlı</option>
                <option value="loss">Zarar</option>
                <option value="zero">Sıfır kâr</option>
              </select>
            </div>
          </div>
          <div class="orders-filter-actions">
            <button type="button" class="btn-coral" id="clearOrderFilters">Filtreleri Temizle</button>
            <button type="submit" class="btn-brown">Uygula</button>
          </div>
        </form>

        <section class="orders-card" id="ordersListPanel">
          <div class="orders-card-head">
            <h2>Sipariş Kârlılığı — Liste</h2>
          </div>
          <div class="orders-toolbar">
            <button type="button" class="btn-brown" id="refreshOrders">Verileri Güncelle</button>
            <button type="button" class="btn-green" id="exportReport">Raporu İndir</button>
          </div>
          <div class="orders-table-wrap" id="ordersTableWrap">
            <table class="orders-table">
              <thead>
                <tr>
                  <th data-sort="orderNumber">Sipariş No <span class="sort-icon">↕</span></th>
                  <th data-sort="orderDateMs">Tarih <span class="sort-icon">↕</span></th>
                  <th data-sort="status">Durum <span class="sort-icon">↕</span></th>
                  <th data-sort="salesAmount">Tutar (₺) <span class="sort-icon">↕</span></th>
                  <th data-sort="netProfit">Net kâr (₺) <span class="sort-icon">↕</span></th>
                  <th data-sort="profitRate">Kâr oranı <span class="sort-icon">↕</span></th>
                  <th data-sort="profitMargin">Marj <span class="sort-icon">↕</span></th>
                  <th>Detay</th>
                </tr>
              </thead>
              <tbody id="ordersBody">
                <tr><td colspan="8" class="orders-loading">Yükleniyor…</td></tr>
              </tbody>
            </table>
          </div>
          <div class="orders-footer" id="ordersFooter">Yükleniyor…</div>
        </section>

        ${channelId === 'uber-eats' ? `<section class="orders-card orders-loss-products-panel" id="uberLossProductsPanel" hidden>
          <div class="orders-card-head">
            <div>
              <h2>Zarar Eden Ürünler</h2>
              <p class="orders-loss-products-lead muted">Zararlı siparişlerdeki ürün satırları. <strong>Uber eşleştir</strong> → havuzda eşleştirme modalı · <strong>Ana havuz</strong> → BenimPOS ürünü · <strong>Maliyet</strong> → kanal maliyetleri · sipariş numarası → sipariş detayı.</p>
            </div>
            <div class="orders-loss-products-head-links">
              <a class="btn-detail ghost" href="/products?tab=uber-eats">Uber katalog</a>
              <a class="btn-detail ghost" href="/products?tab=master">Ana ürün havuzu</a>
            </div>
          </div>
          <div class="orders-loss-products-toolbar">
            <label class="orders-loss-products-check">
              <input type="checkbox" id="lossProductsIssuesOnly">
              <span>Yalnızca eşleşme / maliyet uyarısı olanlar</span>
            </label>
            <input type="search" id="lossProductsSearch" class="orders-loss-products-search" placeholder="Barkod veya ürün ara…" aria-label="Zarar eden ürün ara">
            <button type="button" class="btn-coral" id="lossProductsUnmapAllBtn">Tüm eşleştirmeleri kaldır</button>
          </div>
          <section class="ops-summary-strip ops-summary-strip--orders ops-summary-strip--loss-products" id="lossProductsSummary" aria-live="polite">
            <div class="ops-summary-item"><span>Ürün (barkod)</span><strong id="lossProdStatCount">—</strong></div>
            <div class="ops-summary-item ops-summary-item--danger"><span>Toplam satır neti</span><strong id="lossProdStatNet">—</strong></div>
            <div class="ops-summary-item ops-summary-item--warn"><span>Eşleşme sorunu</span><strong id="lossProdStatMatching">—</strong></div>
            <div class="ops-summary-item ops-summary-item--warn"><span>Maliyet uyarısı</span><strong id="lossProdStatCost">—</strong></div>
          </section>
          <div class="orders-table-wrap" id="lossProductsTableWrap">
            <table class="orders-table orders-loss-products-table">
              <thead>
                <tr>
                  <th>Ürün</th>
                  <th>Barkod</th>
                  <th>Eşleşme</th>
                  <th>Zarar sipariş</th>
                  <th>Adet</th>
                  <th>Satış</th>
                  <th>Maliyet</th>
                  <th>Satır neti</th>
                  <th>Uyarı</th>
                  <th>Düzenle</th>
                </tr>
              </thead>
              <tbody id="lossProductsBody">
                <tr><td colspan="10" class="orders-loading">Siparişler yüklendikten sonra liste oluşur.</td></tr>
              </tbody>
            </table>
          </div>
          <div class="orders-footer" id="lossProductsFooter">—</div>
        </section>` : ''}
      </div>
      <div class="orders-modal-backdrop" id="orderModalBackdrop">
        <div class="orders-modal" role="dialog" aria-modal="true">
          <div class="orders-modal-head">
            <h3 id="orderModalTitle">Sipariş detayı</h3>
            <button type="button" class="orders-modal-close" id="orderModalClose" aria-label="Kapat">×</button>
          </div>
          <div class="orders-modal-body" id="orderModalBody"></div>
        </div>
      </div>
      <div class="orders-toast" id="ordersToast"></div>
      ${benimposModal}
      <script id="bootstrap" type="application/json">${bootstrap}</script>
      ${benimposScript}`;

  return wrapPanelPage({
    title: `${channelLabel} — Sipariş Kârlılığı`,
    activeModule: 'general',
    activeItem: channelId,
    auth,
    bodyClass: 'orders-page channel-orders-page pf-channel-page',
    bodyHtml: innerHtml,
    stylesheets: ['/assets/styles.css?v=corp1', '/assets/orders.css?v=2'],
    scripts: ['/assets/channel-page.js?v=2', '/assets/orders.js?v=10']
  });
}

export function renderChannelPlaceholderPage({ channelId, auth }) {
  const channel = getChannel(channelId);
  const channelLabel = channel?.label || channelId;
  const bootstrap = jsonForHtml({ authRequired: Boolean(auth.isEnabled()), channelId, channelLabel });

  const innerHtml = `
      <main class="platform-main">
        <section class="panel channel-empty-state">
          <div class="channel-empty-icon" aria-hidden="true">⎈</div>
          <h2>${escapeHtml(channelLabel)}</h2>
          <p class="channel-empty-lead">Sipariş ve kârlılık takibi için önce API bağlantısını tamamlayın. Bilgileri girdiğinizde bu kanal otomatik olarak sipariş çekmeye başlar.</p>
          <div id="channelHealth" class="channel-health">Durum yükleniyor…</div>
          <div class="channel-empty-actions">
            <a class="btn btn-primary" href="/admin/settings">Bağlantıyı kur</a>
            <a class="btn btn-ghost" href="/dashboard">Dashboard'a dön</a>
          </div>
          <p class="channel-empty-hint muted">Maliyetler <a href="/products/mappings">Kanal Eşleşmeleri</a> sayfasından yönetilir.</p>
        </section>
      </main>
      <script id="bootstrap" type="application/json">${bootstrap}</script>`;

  return wrapPanelPage({
    title: channelLabel,
    activeModule: 'general',
    activeItem: channelId,
    auth,
    bodyClass: 'channel-page pf-channel-page',
    bodyHtml: innerHtml,
    stylesheets: ['/assets/styles.css'],
    scripts: ['/assets/channel-page.js?v=2']
  });
}
