import {
  escapeHtml,
  jsonForHtml
} from './format.js';
import { renderTrendyolSubNav, renderHzlMrktOpsProfitPage as renderHzlMrktOpsProfitPageView } from './nav.js';
import { renderMarketplaceSubNav } from '../../panel/shell/marketplace-nav.js';
import { buildOrdersPageBootstrap } from './orders-bootstrap.js';
import { renderBenimposSaleFragment, renderBenimposReadinessBanner } from './orders-page-fragments.js';
import { createPlatformPages } from './pages-platform.js';
import { resolveMatchingModeForChannel } from '../../product-matching/resolve.js';
import { renderTariffPanelHtml } from './tariff-panel-html.js';
import { renderCatalogPanelHtml, renderTariffViewSwitchHtml, renderTrackPanelHtml, renderWorkspaceStatusHtml } from './catalog-panel-html.js';
import { wrapPanelPage } from '../../panel/shell/wrap-panel-page.js';
import { renderShippingPage } from '../../panel/views/shipping-page.js';

export function createPageViews(auth, runtimeConfig = {}) {
  const platformPages = createPlatformPages(auth, runtimeConfig);

  function renderProductsPage() {
  const bootstrap = jsonForHtml({
    authRequired: Boolean(auth.isEnabled()),
    costScope: 'trendyol-marketplace',
    costScopeLabel: 'Trendyol Pazaryeri'
  });

  const innerHtml = `
      ${renderTrendyolSubNav('products')}
      <div class="products-wrap pf-marketplace-content">
        <section class="ops-summary-strip" id="productsSummaryStrip" aria-live="polite">
          <div class="ops-summary-item"><span>Maliyet kaydı</span><strong id="productsSummaryListed">—</strong></div>
          <div class="ops-summary-item"><span>Maliyeti dolu</span><strong id="productsSummaryWithCost">—</strong></div>
          <div class="ops-summary-item ops-summary-item--warn"><span>Maliyeti eksik</span><strong id="productsSummaryEmptyCost">—</strong></div>
          <div class="ops-summary-item"><span>Filtrelenen</span><strong id="productsSummaryFiltered">—</strong></div>
        </section>
        <form id="filterForm" class="filter-card">
          <div class="filter-grid">
            <div><label>Ürün adı</label><input name="title" type="search" placeholder="Ürün adı"></div>
            <div><label>Barkod</label><input name="barcode" placeholder="Barkod"></div>
            <div><label>Marka</label><input name="brand" placeholder="Marka"></div>
            <div><label>Model kodu</label><input name="modelCode" placeholder="Model kodu"></div>
            <div><label>Stok</label><div class="filter-range"><input name="stockMin" inputmode="numeric" placeholder="min"><input name="stockMax" inputmode="numeric" placeholder="max"></div></div>
            <div class="filter-toggle"><input type="checkbox" name="emptyCostOnly" id="emptyCostOnly"><label for="emptyCostOnly">Maliyeti boş olanlar</label></div>
            <div><label>Maliyet</label><div class="filter-range"><input name="costMin" inputmode="decimal" placeholder="min"><input name="costMax" inputmode="decimal" placeholder="max"></div></div>
            <div><label>Desi</label><div class="filter-range"><input name="desiMin" inputmode="decimal" placeholder="min"><input name="desiMax" inputmode="decimal" placeholder="max"></div></div>
            <div><label>İade oranı</label><div class="filter-range"><input name="returnMin" inputmode="decimal" placeholder="min"><input name="returnMax" inputmode="decimal" placeholder="max"></div></div>
          </div>
          <div class="filter-actions">
            <button type="button" class="btn-coral" id="clearFilters">Filtreleri Temizle</button>
            <button type="submit" class="btn-brown">Filtrele</button>
          </div>
        </form>
        <section class="settings-card">
          <div class="settings-head">
            <h2>Ürün Ayarları — Trendyol Pazaryeri</h2>
            <p class="platform-lead">BuyBox ve Trendyol sipariş kârlılığı bu maliyet setini kullanır. Diğer kanallar için <a href="/hzlmrktops/urunler">Ürünler</a> sayfasını kullanın.</p>
            <div class="zoom-controls">
              <button type="button" id="zoomOut">A−</button>
              <span id="zoomLabel">75%</span>
              <button type="button" id="zoomIn">A+</button>
              <button type="button" id="zoomReset" title="Sıfırla">⟲</button>
            </div>
          </div>
          <div class="settings-toolbar">
            <button type="button" class="btn-brown" id="refreshData">Verileri Güncelle</button>
            <button type="button" class="btn-green" id="exportCsv">Excel Dosyasını İndir</button>
            <button type="button" class="btn-green outline" id="importExcel">Excel ile İçeri Aktar</button>
            <button type="button" class="btn-green outline" id="importXml">XML Yükle</button>
            <input type="file" id="importExcelFile" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>
            <span class="settings-toolbar-hint"><strong>Verileri Güncelle</strong> Trendyol API’den ürünleri çeker; <strong>maliyet</strong> ve <strong>desi</strong> elle girilir, senkron bunları silmez. Diğer alanları değiştirdikten sonra satırdaki <strong>Güncelle</strong> ile kaydedin.</span>
          </div>
          <div class="products-table-wrap" id="productsTableWrap">
            <table class="products-table">
              <thead>
                <tr>
                  <th>Ürün Bilgisi</th>
                  <th>Barkod</th>
                  <th>Ürün Maliyeti (KDV Dahil)</th>
                  <th>Desi</th>
                  <th>Marka</th>
                  <th>Model Kodu</th>
                  <th>Stok(Ad...</th>
                  <th>İade Oranı</th>
                  <th>Teslimat Tipi</th>
                  <th>Ekstra Gider</th>
                </tr>
              </thead>
              <tbody id="productsBody"></tbody>
            </table>
          </div>
          <div class="products-footer" id="productsFooter">Yükleniyor…</div>
        </section>
      </div>
      <div class="products-toast" id="productsToast"></div>
      <script id="bootstrap" type="application/json">${bootstrap}</script>`;

  return wrapPanelPage({
    title: 'Ürün Ayarları — Trendyol Pazaryeri',
    activeModule: 'marketplace',
    activeItem: 'products',
    auth,
    bodyClass: 'products-page pf-marketplace-page',
    bodyHtml: innerHtml,
    stylesheets: ['/assets/styles.css?v=corp2', '/assets/products.css?v=3'],
    scripts: ['/assets/products.js?v=8']
  });
}

  function renderLoginPage() {
  const authDisabled = !auth.isEnabled();

  return `<!doctype html>
  <html lang="tr">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <meta name="robots" content="noindex, nofollow">
      <title>Giriş — PetFix Panel</title>
      <link rel="stylesheet" href="/assets/styles.css">
    </head>
    <body class="login-page">
      <main class="login-card">
        <h1>PetFix Panel</h1>
        <p class="login-lead">${authDisabled ? 'Kimlik doğrulama kapalı. Panele dönebilirsiniz.' : 'PetFix Çok Kanallı Kârlılık ve Operasyon Paneli — devam etmek için platform token girin.'}</p>
        <form id="loginForm" class="login-form">
          <label for="token">Platform Token</label>
          <input id="token" type="password" autocomplete="current-password" ${authDisabled ? 'disabled' : ''} placeholder="Platform API token">
          <button type="submit" ${authDisabled ? 'disabled' : ''}>Giriş Yap</button>
        </form>
        <p class="muted" id="loginStatus"></p>
        ${authDisabled
    ? '<p class="login-link"><a href="/dashboard">Panele git →</a></p>'
    : '<p class="login-link"><button type="button" class="login-clear-btn" id="loginClearSession">Kayıtlı oturumu temizle</button></p>'}
      </main>
      <script src="/assets/login.js?v=2" defer></script>
    </body>
  </html>`;
}

  function renderOrdersPage() {
  const bootstrapPayload = buildOrdersPageBootstrap({
    channelId: 'trendyol-marketplace',
    auth,
    productMatchingMode: resolveMatchingModeForChannel(
      runtimeConfig.productMatchingMode || 'legacy',
      'trendyol-marketplace',
      runtimeConfig.productMatchingModeByChannel
    )
  });
  const bootstrap = jsonForHtml(bootstrapPayload);
  const benimposAssets = renderBenimposSaleFragment(bootstrapPayload.benimposSaleEnabled);

  const innerHtml = `
      ${renderTrendyolSubNav('orders')}
      <div class="orders-wrap pf-marketplace-content">
        <section class="panel orders-intro">
          <h2>Sipariş Kârlılığı</h2>
          <p class="platform-lead">Trendyol Pazaryeri siparişlerinin net kâr analizi. Maliyetler <a href="/marketplace/products">Ürün Ayarları</a> ve onaylı eşleştirmeler (<a href="/hzlmrktops/urunler">Ürünler</a>) üzerinden hesaplanır.</p>
          <div id="channelHealth" class="channel-health">Durum yükleniyor…</div>
          ${renderBenimposReadinessBanner()}
        </section>

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

        <details class="orders-alert-card orders-alert-collapse" id="emailAlertCard">
          <summary class="orders-alert-summary">
            <span>E-posta — Zarar Sipariş Bildirimi</span>
            <label class="alert-toggle" onclick="event.stopPropagation()"><input type="checkbox" id="emailEnabled"> Aktif</label>
          </summary>
          <p class="orders-alert-lead">Net kârı negatif olan yeni siparişlerde <strong>petfixltd@gmail.com</strong> adresine e-posta gönderilir. Aynı sipariş bir kez bildirilir.</p>
          <div class="orders-filter-grid alert-grid">
            <div>
              <label for="emailTo">Alıcı e-posta</label>
              <input id="emailTo" type="email" value="petfixltd@gmail.com" placeholder="petfixltd@gmail.com">
            </div>
            <div>
              <label for="emailInterval">Kontrol aralığı (dk)</label>
              <input id="emailInterval" inputmode="numeric" value="5">
            </div>
            <div>
              <label for="emailLookback">Son kaç saat</label>
              <input id="emailLookback" inputmode="numeric" value="6">
            </div>
          </div>
          <p class="orders-alert-note" id="emailSmtpNote">SMTP ayarları .env dosyasından okunur (Gmail uygulama şifresi gerekir).</p>
          <div class="orders-alert-actions">
            <button type="button" class="btn-brown" id="emailSave">Kaydet</button>
            <button type="button" class="btn-green outline" id="emailTest">Test E-postası</button>
            <button type="button" class="btn-green" id="emailCheckNow">Şimdi Kontrol Et</button>
          </div>
          <p class="orders-alert-status" id="emailStatus">Yükleniyor…</p>
        </details>

        <section class="orders-card">
          <div class="orders-card-head">
            <h2>Sipariş Kârlılığı — Liste</h2>
            <div class="orders-head-tools">
              <div class="zoom-controls">
                <button type="button" id="zoomOut">A−</button>
                <span id="zoomLabel">90%</span>
                <button type="button" id="zoomIn">A+</button>
                <button type="button" id="zoomReset" title="Sıfırla">⟲</button>
              </div>
            </div>
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
      ${benimposAssets.modal}
      <script id="bootstrap" type="application/json">${bootstrap}</script>
      ${benimposAssets.script}`;

  return wrapPanelPage({
    title: 'Sipariş Kârlılığı — Trendyol Pazaryeri',
    activeModule: 'marketplace',
    activeItem: 'orders',
    auth,
    bodyClass: 'orders-page pf-marketplace-page',
    bodyHtml: innerHtml,
    stylesheets: ['/assets/styles.css?v=corp2', '/assets/orders.css?v=25'],
    scripts: ['/assets/channel-page.js?v=3', '/assets/orders.js?v=31']
  });
  }


  function renderLivePerformancePage() {
    const bootstrap = jsonForHtml({
      authRequired: Boolean(auth.isEnabled()),
      channelId: 'trendyol-marketplace',
      channelLabel: 'Trendyol Pazaryeri'
    });

    const innerHtml = `
      ${renderTrendyolSubNav('live')}
      <div class="pf-marketplace-content">
        <section class="panel live-performance-panel" id="livePerformancePanel" aria-label="Canlı performans">
          <div class="live-performance-head">
            <div class="live-performance-title-wrap">
              <span class="live-performance-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-9-9"/><path d="M12 3v9l4 2"/></svg>
              </span>
              <div>
                <h2 class="section-title">Canlı Performans</h2>
                <p class="section-desc" id="livePerformanceDesc">Bugünkü ciro, net kâr ve sipariş kârlılığı — Trendyol Pazaryeri</p>
              </div>
            </div>
            <div class="live-performance-actions">
              <span class="live-updated muted" id="liveUpdatedAt">Yükleniyor…</span>
              <button type="button" class="btn btn-primary" id="refreshLivePerformance">Verileri Güncelle</button>
            </div>
          </div>

          <p class="live-performance-note muted" id="liveCostNote" hidden>
            Maliyeti eksik ürünler kâr hesabını etkiler.
            <a href="/marketplace/products">Ürün Ayarları</a> üzerinden güncelleyin.
          </p>

          <div class="live-performance-body">
            <div class="live-performance-chart-col">
              <p class="live-chart-eyebrow">Bugünkü Net Kârım</p>
              <p class="live-today-profit" id="liveTodayProfit">—</p>
              <div id="liveChartWrap" class="live-chart-wrap">
                <div class="kpi-skeleton">Grafik yükleniyor…</div>
              </div>
              <p class="live-chart-legend muted">Kâr performansı — saatlik birikimli net kâr (Europe/Istanbul)</p>
            </div>
            <div id="liveKpiStack" class="live-kpi-stack">
              <div class="kpi-skeleton">Metrikler yükleniyor…</div>
            </div>
          </div>

          <div class="live-orders-panel">
            <div class="live-orders-head">
              <div>
                <h3>Sipariş Kârlılık Analizi</h3>
                <span class="live-orders-channel-link muted">
                  <a href="/marketplace/orders">Detaylı sipariş listesi →</a>
                </span>
              </div>
              <span class="muted" id="liveOrdersMeta">—</span>
            </div>
            <div class="live-orders-toolbar">
              <div class="live-orders-toolbar-left">
                <span class="live-orders-range muted" id="liveOrdersRange">—</span>
                <div class="live-orders-profit-filters" id="liveOrdersProfitFilters" role="group" aria-label="Kârlılık filtresi">
                  <button type="button" class="live-profit-filter active" data-profit="all">Tümü</button>
                  <button type="button" class="live-profit-filter" data-profit="profit">Kârlı</button>
                  <button type="button" class="live-profit-filter" data-profit="loss">Zarar</button>
                </div>
              </div>
              <div class="live-orders-pagination">
                <button type="button" class="btn btn-ghost btn-sm" id="exportLiveOrders">Raporu İndir</button>
                <label class="live-orders-page-size">
                  <span>Sayfa başına</span>
                  <select id="liveOrdersPageSize" aria-label="Sayfa başına kayıt">
                    <option value="10">10</option>
                    <option value="25" selected>25</option>
                    <option value="50">50</option>
                    <option value="100">100</option>
                  </select>
                </label>
                <div class="live-orders-page-nav" id="liveOrdersPageNav" aria-label="Sayfa gezinme"></div>
              </div>
            </div>
            <div class="live-orders-table-wrap">
              <table class="live-orders-table data-table live-orders-table--single-channel">
                <thead>
                  <tr>
                    <th>Sipariş Numarası</th>
                    <th>Sipariş Tarihi</th>
                    <th class="live-orders-col-channel">Kanal</th>
                    <th>Sipariş Tutarı (₺)</th>
                    <th>Kâr Tutarı (₺)</th>
                    <th>Kâr Oranı (%)</th>
                    <th>Kâr Marjı (%)</th>
                  </tr>
                </thead>
                <tbody id="liveOrdersBody">
                  <tr><td colspan="7" class="table-loading">Yükleniyor…</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
      <script id="bootstrap" type="application/json">${bootstrap}</script>`;

    return wrapPanelPage({
      title: 'Canlı Performans — Trendyol Pazaryeri',
      activeModule: 'marketplace',
      activeItem: 'trendyol',
      auth,
      bodyClass: 'live-performance-page pf-marketplace-page',
      bodyHtml: innerHtml,
      stylesheets: ['/assets/styles.css?v=corp2'],
      scripts: ['/assets/live-performance.js?v=1']
    });
  }

  function renderCommissionTariffPage() {
    const bootstrap = jsonForHtml({ authRequired: Boolean(auth.isEnabled()) });

    const innerHtml = `
      ${renderMarketplaceSubNav('trendyol')}
      <main class="tariff-page-wrap panel pf-marketplace-content">
        ${renderWorkspaceStatusHtml()}
        ${renderTariffViewSwitchHtml()}
        <div id="tariffViewRoot">
          ${renderTariffPanelHtml()}
        </div>
        <div id="catalogViewRoot" hidden>
          ${renderCatalogPanelHtml()}
        </div>
        <div id="trackViewRoot" hidden>
          ${renderTrackPanelHtml()}
        </div>
      </main>
      <div class="tariff-toast" id="tariffToast" role="status" aria-live="polite"></div>
      <script id="bootstrap" type="application/json">${bootstrap}</script>`;

    return wrapPanelPage({
      title: 'Fiyat & Kâr — Trendyol Pazaryeri',
      activeModule: 'marketplace',
      activeItem: 'trendyol',
      auth,
      bodyClass: 'tariff-page pf-marketplace-page',
      bodyHtml: innerHtml,
      stylesheets: ['/assets/styles.css', '/assets/tariff.css?v=17'],
      scripts: ['/assets/catalog-view.js?v=4', '/assets/track-view.js?v=4', '/assets/tariff.js?v=18']
    });
  }

  function renderHzlMrktOpsProfitPage() {
    return renderHzlMrktOpsProfitPageView({
      auth,
      productMatchingMode: runtimeConfig.productMatchingMode
    });
  }

  return {
    renderProductsPage,
    renderShippingPage: () => renderShippingPage({ auth }),
    renderCommissionTariffPage,
    renderLivePerformancePage,
    renderLoginPage,
    renderOrdersPage,
    renderHzlMrktOpsProfitPage,
    ...platformPages
  };
}
