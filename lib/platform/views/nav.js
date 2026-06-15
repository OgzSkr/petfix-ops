import { escapeHtml, jsonForHtml } from './format.js';
import { getChannel, channelHasFeature } from '../../channels/registry.js';
import { buildOrdersPageBootstrap } from './orders-bootstrap.js';
import { renderBenimposSaleFragment, renderBenimposReadinessBanner } from './orders-page-fragments.js';
import { renderMarketplaceSubNav } from '../../panel/shell/marketplace-nav.js';
import { wrapPanelPage } from '../../panel/shell/wrap-panel-page.js';
import { renderChannelLogo } from '../../panel/components/channel-logos.js';
import { isEcommerceChannel, isHzlMrktOpsBuyboxChannel, MARKETNEXT_BUYBOX_CHANNEL_IDS } from '../../marketnext/constants.js';
import { TERMINAL_ORDER_STATUS_KEYS } from '../../order-lifecycle-status.js';

function resolveChannelPanelNav(channelId) {
  if (isEcommerceChannel(channelId)) {
    return { activeModule: 'ecommerce', activeItem: channelId };
  }
  if (isHzlMrktOpsBuyboxChannel(channelId)) {
    return { activeModule: 'hzlmrktops', activeItem: channelId };
  }
  return { activeModule: 'marketplace', activeItem: channelId };
}

export function renderLogoutButton(auth) {
  if (!auth.isEnabled()) return '';
  return '<button type="button" id="logoutBtn" class="platform-logout" aria-label="Çıkış yap">Çıkış</button>';
}

export function renderTrendyolSubNav(activeSubTab) {
  const map = {
    pricing: 'trendyol',
    trendyol: 'trendyol',
    live: 'live',
    'live-performance': 'live',
    buybox: 'buybox',
    orders: 'orders',
    products: 'products',
    shipping: 'shipping'
  };
  return renderMarketplaceSubNav(map[activeSubTab] || activeSubTab);
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
          <p class="platform-lead">Sipariş takibi ve kâr/zarar analizi. Maliyetler <a href="/hzlmrktops/urunler">Ürünler</a> sayfasından yönetilir.</p>
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
        <div class="orders-cache-banner" id="ordersCacheBanner" hidden aria-live="polite"></div>

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
            <input type="search" id="ordersSearch" class="orders-search" placeholder="Sipariş no, müşteri veya ürün ara…" aria-label="Sipariş ara" autocomplete="off">
            <button type="button" class="btn-brown" id="refreshOrders">Verileri Güncelle</button>
            <button type="button" class="btn-green" id="exportReport">Raporu İndir</button>
          </div>
          <div class="orders-table-wrap" id="ordersTableWrap">
            <table class="orders-table">
              <thead>
                <tr>
                  <th data-sort="orderNumber">Sipariş No <span class="sort-icon">↕</span></th>
                  <th data-sort="orderDateMs">Tarih <span class="sort-icon">↕</span></th>
                  <th>Müşteri</th>
                  <th>Teslimat</th>
                  <th data-sort="status">Durum <span class="sort-icon">↕</span></th>
                  <th data-sort="salesAmount">Tutar (₺) <span class="sort-icon">↕</span></th>
                  <th data-sort="netProfit">Net kâr (₺) <span class="sort-icon">↕</span></th>
                  <th data-sort="profitRate">Kâr oranı <span class="sort-icon">↕</span></th>
                  <th data-sort="profitMargin">Marj <span class="sort-icon">↕</span></th>
                  <th>Detay</th>
                </tr>
              </thead>
              <tbody id="ordersBody">
                <tr><td colspan="10" class="orders-loading">Yükleniyor…</td></tr>
              </tbody>
            </table>
          </div>
          <div class="orders-footer" id="ordersFooter">Yükleniyor…</div>
        </section>

        ${channelId === 'uber-eats' ? `<section class="orders-card orders-loss-products-panel" id="uberLossProductsPanel" hidden>
          <div class="orders-card-head">
            <div>
              <h2>Zarar Eden Ürünler</h2>
              <p class="orders-loss-products-lead muted">Zararlı siparişlerdeki ürün satırları. <strong>Uber eşleştir</strong> → havuzda eşleştirme modalı · <strong>Ana havuz</strong> → BenimPOS ürünü · <strong>Maliyet</strong> → BenimPOS master · sipariş numarası → sipariş detayı.</p>
            </div>
            <div class="orders-loss-products-head-links">
              <a class="btn-detail ghost" href="/hzlmrktops/urunler?tab=uber-eats">Uber katalog</a>
              <a class="btn-detail ghost" href="/hzlmrktops/urunler">Ana ürün havuzu</a>
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
    ...resolveChannelPanelNav(channelId),
    auth,
    bodyClass: 'orders-page channel-orders-page pf-channel-page',
    bodyHtml: innerHtml,
    stylesheets: ['/assets/styles.css?v=corp2', '/assets/orders.css?v=25'],
    scripts: ['/assets/channel-page.js?v=3', '/assets/orders.js?v=30']
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
            <a class="btn btn-ghost" href="/hzlmrktops">HzlMrktOps</a>
          </div>
          <p class="channel-empty-hint muted">Maliyetler <a href="/hzlmrktops/urunler">Ürünler</a> sayfasından yönetilir.</p>
        </section>
      </main>
      <script id="bootstrap" type="application/json">${bootstrap}</script>`;

  const panelNav = resolveChannelPanelNav(channelId);
  return wrapPanelPage({
    title: channelLabel,
    ...panelNav,
    auth,
    bodyClass: 'channel-page pf-channel-page',
    bodyHtml: innerHtml,
    stylesheets: ['/assets/styles.css'],
    scripts: ['/assets/channel-page.js?v=3']
  });
}

export function renderHzlMrktOpsProfitPage({ auth, productMatchingMode = 'legacy' }) {
  const benimposAssets = renderBenimposSaleFragment(true);
  const bootstrap = jsonForHtml({
    authRequired: Boolean(auth.isEnabled()),
    multiChannel: true,
    opsMode: true,
    channelId: null,
    channelLabel: 'HzlMrktOps',
    productMatchingMode: 'legacy',
    productsPath: '/hzlmrktops/urunler',
    matchingPath: '/hzlmrktops/urunler',
    orderDateTimezone: 'Europe/Istanbul',
    apiPath: '/api/hzlmrktops/orders',
    exportPath: '/api/hzlmrktops/orders/export',
    benimposSaleEnabled: true,
    channelHealthEnabled: false,
    terminalOrderStatusKeys: TERMINAL_ORDER_STATUS_KEYS
  });

  const channelTabs = [
    { id: 'all', label: 'Tüm kanallar', planned: false },
    ...MARKETNEXT_BUYBOX_CHANNEL_IDS.map((channelId) => {
      const channel = getChannel(channelId);
      if (!channel) return null;
      return {
        id: channel.id,
        label: channel.label,
        route: channel.route,
        planned: channel.status !== 'active'
      };
    }).filter(Boolean)
  ];

  const innerHtml = `
      <div class="orders-wrap pf-ops-orders">
        <section class="panel channel-orders-intro">
          <h2>Siparişler</h2>
          <p class="platform-lead">Aktif ve tamamlanan kanal siparişlerini buradan takip edin. Maliyet ve kâr takibi BenimPOS tarafında yapılır.</p>
          <nav class="orders-subnav" id="marketnextChannelFilters" role="tablist" aria-label="Kanal filtresi">
            ${channelTabs.map((tab, index) => {
              if (tab.planned) {
                return `<span class="orders-subnav-tab orders-subnav-tab--planned" title="Yakında">${renderChannelLogo(tab.id, { size: 'xs' })}<em class="orders-subnav-soon">yakında</em></span>`;
              }
              return `<button type="button" class="orders-subnav-tab orders-subnav-tab--channel${index === 0 ? ' active' : ''}" data-channel="${escapeHtml(tab.id)}" data-label="${escapeHtml(tab.label)}" role="tab" aria-selected="${index === 0 ? 'true' : 'false'}" title="${escapeHtml(tab.label)}">${tab.id === 'all' ? '<span>Tümü</span>' : renderChannelLogo(tab.id, { size: 'sm' })}<span class="orders-subnav-count" data-count-for="${escapeHtml(tab.id)}"></span></button>`;
            }).join('')}
          </nav>
        </section>

        <nav class="orders-lifecycle-tabs" id="ordersLifecycleTabs" role="tablist" aria-label="Sipariş durumu">
          <button type="button" class="orders-lifecycle-tab active" data-lifecycle="active" role="tab" aria-selected="true">Aktif Siparişler <span class="orders-lifecycle-count" id="lifecycleCountActive"></span></button>
          <button type="button" class="orders-lifecycle-tab" data-lifecycle="completed" role="tab" aria-selected="false">Tamamlanmış Siparişler <span class="orders-lifecycle-count" id="lifecycleCountCompleted"></span></button>
        </nav>

        <form id="ordersFilterForm" class="orders-filter-card orders-filter-card--compact">
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
              <label for="statusFilter">Durum</label>
              <select id="statusFilter" name="status">
                <option value="">Tüm durumlar</option>
              </select>
            </div>
          </div>
          <div class="orders-filter-actions">
            <button type="button" class="btn-coral" id="clearOrderFilters">Filtreleri Temizle</button>
            <button type="submit" class="btn-brown">Uygula</button>
          </div>
        </form>

        <div class="orders-cache-banner" id="ordersCacheBanner" hidden aria-live="polite"></div>

        <section class="orders-card" id="ordersListPanel">
          <div class="orders-toolbar">
            <input type="search" id="ordersSearch" class="orders-search" placeholder="Sipariş no, müşteri veya ürün ara…" aria-label="Sipariş ara" autocomplete="off">
            <button type="button" class="btn-brown" id="refreshOrders">Verileri Güncelle</button>
          </div>
          <div class="orders-table-wrap" id="ordersTableWrap">
            <table class="orders-table orders-table--ops">
              <thead>
                <tr>
                  <th data-sort="orderNumber">ID <span class="sort-icon">↕</span></th>
                  <th>Kanal</th>
                  <th data-sort="customerName">Adı Soyadı <span class="sort-icon">↕</span></th>
                  <th>Ödeme Tipi</th>
                  <th>Teslimat</th>
                  <th data-sort="salesAmount">Tutar <span class="sort-icon">↕</span></th>
                  <th data-sort="status">Durumu <span class="sort-icon">↕</span></th>
                  <th title="BenimPOS otomatik aktarım durumu">BenimPOS</th>
                  <th data-sort="orderDateMs">Sipariş Tarihi <span class="sort-icon">↕</span></th>
                  <th>Fatura</th>
                  <th>İşlem</th>
                </tr>
              </thead>
              <tbody id="ordersBody">
                <tr><td colspan="11" class="orders-loading">Yükleniyor…</td></tr>
              </tbody>
            </table>
          </div>
          <div class="orders-footer" id="ordersFooter">Yükleniyor…</div>
        </section>
      </div>
      <div class="orders-modal-backdrop" id="orderModalBackdrop">
        <div class="orders-modal orders-modal--ops" role="dialog" aria-modal="true">
          <div class="orders-modal-head">
            <h3 id="orderModalTitle">Sipariş Detayı</h3>
            <button type="button" class="orders-modal-close" id="orderModalClose" aria-label="Kapat">×</button>
          </div>
          <div class="orders-modal-body" id="orderModalBody"></div>
        </div>
      </div>
      <div class="orders-toast" id="ordersToast"></div>
      ${benimposAssets.modal}
      <script id="bootstrap" type="application/json">${bootstrap}</script>
      ${benimposAssets.script}`;

  return wrapPanelPage({
    title: 'HzlMrktOps — Siparişler',
    activeModule: 'hzlmrktops',
    activeItem: 'orders',
    auth,
    bodyClass: 'orders-page ops-orders-page pf-channel-page',
    bodyHtml: innerHtml,
    stylesheets: ['/assets/styles.css?v=corp2', '/assets/orders.css?v=25'],
    scripts: ['/assets/channel-logos.js?v=2', '/assets/orders.js?v=30']
  });
}
