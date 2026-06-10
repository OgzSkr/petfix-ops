import { jsonForHtml, escapeHtml } from './format.js';
import { renderChannelPlaceholderPage, renderChannelOrdersPage } from './nav.js';
import { renderPetfixShell } from '../../panel/shell/petfix-shell.js';
import { wrapPanelPage } from '../../panel/shell/wrap-panel-page.js';
import { PLATFORM_SHORT } from '../brand.js';
import { listSalesMatchingChannels } from '../../product-matching/constants.js';
import { listActiveChannels, getChannel } from '../../channels/registry.js';
import { resolveMatchingModeForChannel } from '../../product-matching/resolve.js';
import { renderMatchingChannelStrip } from '../../panel/components/channel-logos.js';

export function createPlatformPages(auth, runtimeConfig = {}) {
  function renderGeneralDashboard() {
    const bootstrap = jsonForHtml({ authRequired: Boolean(auth.isEnabled()) });

    const innerHtml = `
        <header class="pf-page-header">
          <div>
            <p class="pf-page-eyebrow">Genel</p>
            <h1>Genel Bakış</h1>
            <p class="pf-page-lead">Sipariş, kârlılık, eşleştirme ve BenimPOS aktarım özeti — tek ekrandan.</p>
          </div>
        </header>

          <section class="executive-summary-strip" id="executiveSummaryStrip" aria-label="Operasyon özeti">
            <div class="executive-kpi"><span>Sipariş</span><strong id="execStatOrders">—</strong></div>
            <div class="executive-kpi"><span>Ciro</span><strong id="execStatRevenue">—</strong></div>
            <div class="executive-kpi executive-kpi--profit"><span>Net kâr</span><strong id="execStatProfit">—</strong></div>
            <div class="executive-kpi executive-kpi--danger"><span>Zarar eden sipariş</span><strong id="execStatLoss">—</strong></div>
            <div class="executive-kpi executive-kpi--warn executive-kpi--link"><a href="/products/inbox" id="execStatUnmatchedLink"><span>Bekleyen eşleştirme</span><strong id="execStatUnmatched">—</strong></a></div>
            <div class="executive-kpi executive-kpi--info"><span>Aktarım / onay bekleyen</span><strong id="execStatPendingSale">—</strong></div>
          </section>

          </section>

          <section class="dashboard-section panel today-actions-panel" id="todayActionsPanel" aria-label="Bugün yapılacaklar" hidden>
            <div class="section-head today-actions-head">
              <div>
                <h2 class="section-title">Bugün yapılacaklar</h2>
                <p class="section-desc" id="todayActionsDesc">Öncelikli görevler — tek tıkla ilgili ekrana gidin</p>
              </div>
              <a href="#actionCenterPanel" class="btn-link today-actions-more">Tüm aksiyonlar ↓</a>
            </div>
            <div id="todayActionsBody" class="today-actions-grid"></div>
          </section>

          <nav class="dashboard-quick-nav dashboard-quick-nav--bar" aria-label="Sayfa içi gezinme">
            <a href="#livePerformancePanel">Canlı</a>
            <a href="#matchingQueuePanel">Eşleştirme</a>
            <a href="#actionCenterPanel">Aksiyonlar</a>
            <a href="#profitSummaryPanel">Dönem</a>
            <a href="#dataIntegrityPanel">Veri denetimi</a>
            <a href="#channelCardsSection">Kanallar</a>
          </nav>

          <section class="dashboard-section panel live-performance-panel" id="livePerformancePanel" aria-label="Canlı performans">
            <div class="live-performance-head">
              <div class="live-performance-title-wrap">
                <span class="live-performance-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-9-9"/><path d="M12 3v9l4 2"/></svg>
                </span>
                <div>
                  <h2 class="section-title">Canlı Performans</h2>
                  <p class="section-desc">Bugünkü ciro, net kâr ve sipariş kârlılığı — tüm kanallar birleşik</p>
                </div>
              </div>
              <div class="live-performance-actions">
                <span class="live-updated muted" id="liveUpdatedAt">Yükleniyor…</span>
                <button type="button" class="btn btn-primary" id="refreshLivePerformance">Verileri Güncelle</button>
              </div>
            </div>

            <div class="live-channel-filters-wrap">
              <div class="live-channel-filters-head">
                <strong>Hızlı filtre</strong>
                <span class="muted">Satış kanalı seçin — grafik ve tablo anında güncellenir</span>
              </div>
              <div class="live-channel-filters" id="liveChannelFilters" role="tablist" aria-label="Satış kanalı filtresi">
                <button type="button" class="live-channel-filter active" data-channel="all" role="tab" aria-selected="true">Tümü</button>
                ${listActiveChannels().map((channel) => {
                  const cssClass = channel.id.replace(/[^a-z0-9-]/g, '');
                  return `<button type="button" class="live-channel-filter live-channel-filter--${escapeHtml(cssClass)}" data-channel="${escapeHtml(channel.id)}" role="tab" aria-selected="false">${escapeHtml(channel.label)}</button>`;
                }).join('\n                ')}
              </div>
            </div>

            <div class="live-performance-body">
              <div class="live-performance-chart-col">
                <p class="live-chart-eyebrow">Bugünkü Net Kârım</p>
                <p class="live-today-profit" id="liveTodayProfit">—</p>
                <div id="liveChartWrap" class="live-chart-wrap">
                  <div class="kpi-skeleton">Grafik yükleniyor…</div>
                </div>
                <p class="live-chart-legend muted">Kâr performansı — saatlik birikimli net kâr</p>
              </div>
              <div id="liveKpiStack" class="live-kpi-stack">
                <div class="kpi-skeleton">Metrikler yükleniyor…</div>
              </div>
            </div>

            <div class="live-orders-panel">
              <div class="live-orders-head">
                <div>
                  <h3>Sipariş Kârlılık Analizi</h3>
                  <span class="live-orders-channel-link muted" id="liveOrdersChannelLink"></span>
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
                  <button type="button" class="btn btn-ghost btn-sm" id="exportLiveOrders">Excel İndir</button>
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
                <table class="live-orders-table data-table">
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

          <section class="dashboard-section panel matching-queue-panel" id="matchingQueuePanel" aria-label="Ürün eşleştirme kuyruğu">
            <div class="section-head">
              <h2 class="section-title">Ürün Eşleştirme Kuyruğu</h2>
              <p class="section-desc">Kanal bazında bekleyen eşleştirme, onay ve eksik ana ürün özeti</p>
            </div>
            <div id="matchingQueueBody" class="matching-queue-body">
              <div class="kpi-skeleton">Eşleştirme kuyruğu yükleniyor…</div>
            </div>
            <div id="channelReadinessCards" class="channel-readiness-grid" hidden aria-label="Kanal satışa hazırlık"></div>
          </section>

          <section class="dashboard-section panel action-center-panel" id="actionCenterPanel" aria-label="Bugün müdahale gerekenler">
            <div class="section-head">
              <h2 class="section-title">Bugün Müdahale Gerekenler</h2>
              <p class="section-desc">Zarar, eksik veri, API ve sistem uyarıları — tek tıkla ilgili ekrana gidin</p>
            </div>
            <div id="actionCenter" class="action-center-grid">
              <div class="kpi-skeleton">Aksiyonlar yükleniyor…</div>
            </div>
          </section>

          <section class="dashboard-section panel dashboard-profit-panel" id="profitSummaryPanel">
            <div class="dashboard-profit-head">
              <div>
                <h2 class="section-title">Dönem Özeti</h2>
                <p class="section-desc" id="periodSummaryDesc">Son 14 gün — kanal bazında ciro ve net kâr</p>
              </div>
              <div class="dashboard-profit-actions">
                <label class="field-inline">Dönem
                  <select id="summaryDays" class="select-modern">
                    <option value="7">Son 7 gün</option>
                    <option value="14" selected>Son 14 gün</option>
                    <option value="30">Son 30 gün</option>
                  </select>
                </label>
                <button type="button" class="btn btn-secondary" id="refreshSummary">Özeti Yenile</button>
              </div>
            </div>
            <div id="kpiGrid" class="kpi-grid kpi-grid--period" aria-label="Dönem metrikleri">
              <div class="kpi-skeleton">Metrikler yükleniyor…</div>
            </div>
            <div id="profitTotals" class="dashboard-profit-totals visually-hidden" aria-hidden="true"></div>
            <div class="dashboard-profit-table-wrap">
              <table class="dashboard-profit-table data-table">
                <thead>
                  <tr>
                    <th>Kanal</th>
                    <th>Sipariş</th>
                    <th>Ciro</th>
                    <th>Net kâr</th>
                    <th>Kâr oranı</th>
                    <th>Durum</th>
                  </tr>
                </thead>
                <tbody id="profitSummaryBody">
                  <tr><td colspan="6" class="table-loading">Yükleniyor…</td></tr>
                </tbody>
              </table>
            </div>
            <p class="dashboard-meta muted" id="costsMeta"></p>
          </section>

          <section class="dashboard-section panel data-integrity-panel" id="dataIntegrityPanel" aria-label="Veri bütünlüğü denetimi">
            <div class="section-head">
              <h2 class="section-title">Veri Bütünlüğü Denetimi</h2>
              <p class="section-desc">Tekrarlayan kayıt ve tutarsızlık taraması — salt okunur, otomatik silme yapmaz</p>
            </div>
            <div id="dataIntegrityBody" class="data-integrity-body">
              <div class="kpi-skeleton">Denetim yükleniyor…</div>
            </div>
          </section>

          <section class="dashboard-section" id="channelCardsSection">
            <div class="section-head">
              <h2 class="section-title">Satış Kanalları</h2>
              <p class="section-desc">API durumu, sipariş özeti ve hızlı erişim</p>
            </div>
            <div id="channelCards" class="channel-cards channel-cards--premium">
              <div class="kpi-skeleton">Kanallar yükleniyor…</div>
            </div>
          </section>

          <details class="dashboard-section panel system-status-panel" id="system-status">
            <summary class="system-status-summary">
              <span class="section-title">Sistem Durumu</span>
              <span class="muted system-status-summary-hint">Altyapı ve senkronizasyon</span>
            </summary>
            <div id="opsSummary" class="system-status-grid">Sistem durumu yükleniyor…</div>
          </details>
        <script id="bootstrap" type="application/json">${bootstrap}</script>`;

    return wrapPanelPage({
      title: 'Genel Bakış',
      activeModule: 'general',
      activeItem: 'overview',
      auth,
      bodyClass: 'dashboard-page pf-dashboard-page',
      bodyHtml: innerHtml,
      stylesheets: ['/assets/styles.css?v=corp1'],
      scripts: ['/assets/general-dashboard.js?v=corp8']
    });
  }

  function renderSettingsPage() {
    const bootstrap = jsonForHtml({ authRequired: Boolean(auth.isEnabled()) });

    const innerHtml = `
        <header class="pf-page-header">
          <div>
            <p class="pf-page-eyebrow">Yönetim</p>
            <h1>Sistem Ayarları</h1>
            <p class="pf-page-lead">Kanal API bağlantıları, worker ve entegrasyon yapılandırması. Kayıtlı secret değerleri maskelenir; yeniden kaydetmeden okunamaz.</p>
          </div>
        </header>
        <p class="pf-module-banner">Güvenlik: Secret alanları boş görünür — değiştirmek için yeni değer girip Kaydet'e basın.</p>
        <main class="platform-main settings-main pf-admin-settings">
          <section class="panel settings-section">
            <h2>Trendyol Pazaryeri</h2>
            <p class="platform-lead">BuyBox worker ve sipariş API bilgileri.</p>
            <div class="settings-grid">
              <div><label for="sellerId">Satıcı ID</label><input id="sellerId" autocomplete="off"></div>
              <div><label for="apiKey">API Key</label><input id="apiKey" autocomplete="off"></div>
              <div><label for="apiSecret">API Secret</label><input id="apiSecret" type="password" autocomplete="off"></div>
              <div><label for="environment">Ortam</label>
                <select id="environment"><option value="PROD">PROD</option><option value="STAGE">STAGE</option></select>
              </div>
              <div><label for="pollIntervalMs">Poll aralığı (ms)</label><input id="pollIntervalMs" inputmode="numeric" value="1000"></div>
              <div><label for="batchSize">Batch boyutu</label><input id="batchSize" inputmode="numeric" value="10"></div>
            </div>
            <div class="settings-actions">
              <button type="button" id="saveTrendyolSettings">Kaydet</button>
              <button type="button" class="secondary" id="startWorkerBtn">Worker Başlat</button>
              <button type="button" class="ghost" id="stopWorkerBtn">Worker Durdur</button>
            </div>
            <p class="muted" id="trendyolSettingsStatus"></p>
          </section>

          <section class="panel settings-section">
            <h2>Uber Eats Trendyol Go</h2>
            <p class="platform-lead">Sipariş takibi ve kâr/zarar için API bilgileri. <a href="https://developers.tgoapps.com/" target="_blank" rel="noopener">developers.tgoapps.com</a> panelindeki alanlarla eşleşir. Read-only sipariş sync aktif.</p>
            <div class="settings-grid">
              <div><label for="uberSupplierId">Satıcı ID (Cari ID)</label><input id="uberSupplierId" placeholder="862084" autocomplete="off"></div>
              <div><label for="uberIntegrationRef">Entegrasyon Referans Kodu <span class="muted">(opsiyonel)</span></label><input id="uberIntegrationRef" placeholder="UUID — TGO correlation id" autocomplete="off"></div>
              <div><label for="uberStoreId">Şube Store ID (opsiyonel)</label><input id="uberStoreId" placeholder="223508" inputmode="numeric" autocomplete="off"></div>
              <div><label for="uberApiKey">API Key</label><input id="uberApiKey" autocomplete="off"></div>
              <div><label for="uberApiSecret">API Secret</label><input id="uberApiSecret" type="password" autocomplete="off"></div>
              <div><label for="uberChannel">Hat</label>
                <select id="uberChannel"><option value="market">Market (Hızlı Market)</option><option value="yemek">Yemek</option></select>
              </div>
              <div><label for="uberEnvironment">Ortam</label>
                <select id="uberEnvironment"><option value="PROD">PROD</option><option value="STAGE">STAGE</option></select>
              </div>
            </div>
            <div class="settings-actions">
              <button type="button" id="saveUberEatsSettings">Kaydet</button>
            </div>
            <p class="muted">Token otomatik üretilir: Base64(API Key:API Secret). Store ID boş bırakılırsa katalog çekiminde sipariş API’sinden otomatik bulunur.</p>
            <p class="muted" id="uberEatsSettingsStatus"></p>
          </section>

          <section class="panel settings-section">
            <h2>Yemeksepeti Partner API</h2>
            <p class="platform-lead">Sipariş ve katalog için OAuth. Partner Portal → <strong>Entegrasyon</strong> → <strong>Ayarlar</strong> → <strong>Secrets Management</strong> (Client ID / Secret). <a id="ysPartnerPortalLink" href="https://partner-app.yemeksepeti.com/" target="_blank" rel="noopener">Partner Portal</a> · <a href="https://developer.yemeksepeti.com/en/documentation/outlet-management-api-how-to-integrate" target="_blank" rel="noopener">API dokümantasyonu</a></p>
            <div class="settings-grid">
              <div><label for="ysChainId">Chain ID</label><input id="ysChainId" placeholder="UUID (zincir)" autocomplete="off"></div>
              <div><label for="ysVendorId">Vendor ID</label><input id="ysVendorId" placeholder="jk2w (dahili kimlik)" autocomplete="off"></div>
              <div><label for="ysClientId">Client ID</label><input id="ysClientId" placeholder="BuyBox-…" autocomplete="off"></div>
              <div><label for="ysClientSecret">Client Secret</label><input id="ysClientSecret" type="password" autocomplete="off"></div>
            </div>
            <div class="settings-actions">
              <button type="button" id="saveYemeksepetiSettings">Kaydet</button>
              <button type="button" class="secondary" id="testYemeksepetiBtn">Bağlantıyı Test Et</button>
            </div>
            <p class="muted">OAuth token otomatik alınır (~2 saat). Katalog: <a href="/products?tab=yemeksepeti">Ürün Merkezi</a> · Sipariş kârlılığı: <a href="/yemeksepeti">Yemeksepeti</a>.</p>
            <details class="settings-webhook-guide">
              <summary>Webhook ve portal kurulumu</summary>
              <ol class="settings-webhook-steps muted">
                <li>Partner Portal → <strong>Entegrasyon</strong> → zinciriniz → <strong>Ayarlar</strong> → <strong>API'si</strong> → <strong>Secrets Management</strong>: Client ID / Secret buraya ve PetFix Ayarlar’a girilir.</li>
                <li><strong>Satıcı Tanımlayıcı</strong>: Dahili Kimlik = Vendor ID (ör. <code>jk2w</code>).</li>
                <li>PetFix siparişleri API ile çeker (polling); canlı sipariş push için <strong>Siparis Webhook Ayarlari</strong> (opsiyonel).</li>
                <li>Portalda <em>Sipariş API Direct</em> “Not Configured” ise Yemeksepeti hesap yöneticisinden Direct Order entegrasyonunu açtırın.</li>
              </ol>
            </details>
            <p class="muted" id="yemeksepetiSettingsStatus"></p>
          </section>

          <section class="panel settings-section">
            <h2>DHL eCommerce (Kendi Anlaşma)</h2>
            <p class="platform-lead"><strong>Trendyol kargo faturası kullanılmaz</strong> — satıcı anlaşmalı kargo (whoPays=1) için maliyet yalnızca DHL API’den gelir; netleşene kadar desi tahmini kullanılır. Eşleştirme: Trendyol <code>cargoTrackingNumber</code> → DHL gönderi ID. <a href="https://apizone.mngkargo.com.tr/tr/product" target="_blank" rel="noopener">apizone.mngkargo.com.tr</a></p>
            <div class="settings-grid">
              <div><label for="dhlCustomerNumber">Müşteri No</label><input id="dhlCustomerNumber" placeholder="DHL müşteri numarası" autocomplete="off"></div>
              <div><label for="dhlClientId">Client ID (X-IBM-Client-Id)</label><input id="dhlClientId" autocomplete="off"></div>
              <div><label for="dhlClientSecret">Client Secret</label><input id="dhlClientSecret" type="password" autocomplete="off"></div>
              <div><label for="dhlPassword">Panel Şifresi</label><input id="dhlPassword" type="password" autocomplete="off"></div>
              <div><label for="dhlEnvironment">Ortam</label>
                <select id="dhlEnvironment"><option value="PROD">PROD</option><option value="STAGE">STAGE</option></select>
              </div>
            </div>
            <div class="settings-actions">
              <button type="button" id="saveDhlSettings">Kaydet</button>
              <button type="button" class="secondary" id="testDhlBtn">Bağlantıyı Test Et</button>
            </div>
            <p class="muted">Production için IP whitelist: <code>entegrasyon@mngkargo.com.tr</code>. Fatura kesilmeden önce maliyet “tahmin” olarak kalır; Finance Query netleşince otomatik güncellenir.</p>
            <p class="muted" id="dhlSettingsStatus"></p>
          </section>

          <section class="panel settings-section">
            <h2>BenimPOS</h2>
            <p class="platform-lead">Stok ve alış fiyatı kaynağı. Panel yalnızca <strong>veri okur</strong>; BenimPOS'ta ürün, stok veya fiyat değiştirilmez.</p>
            <div class="settings-grid">
              <div><label for="benimposBranchId">Branch ID</label><input id="benimposBranchId" placeholder="U238417463" autocomplete="off"></div>
              <div><label for="benimposApiUrl">API URL</label><input id="benimposApiUrl" value="https://dev.benimpos.com/api" autocomplete="off"></div>
              <div><label for="benimposApiKey">API Key</label><input id="benimposApiKey" autocomplete="off"></div>
              <div><label for="benimposSecretKey">Secret Key</label><input id="benimposSecretKey" type="password" autocomplete="off"></div>
            </div>
            <div class="settings-actions">
              <button type="button" id="saveBenimposSettings">Kaydet</button>
              <button type="button" class="secondary" id="testBenimposBtn">Bağlantıyı Test Et</button>
              <button type="button" class="ghost" id="syncBenimposCostsBtn">Boş Maliyetleri Çek</button>
            </div>
            <p class="muted">Alış fiyatları (<code>buyingPrice</code>) yalnızca panelde boş kalan maliyet alanlarına yazılır. Manuel girilmiş maliyetler korunur.</p>
            <p class="muted" id="benimposSettingsStatus"></p>
          </section>

          <section class="panel settings-section">
            <h2>Getir</h2>
            <p class="platform-lead">API bilgilerini girdiğinizde Getir siparişleri ve kârlılık takibi bu panelden yönetilebilir.</p>
            <div class="settings-channel-cards">
              <article class="settings-channel-card">
                <h3>Bağlantı alanları</h3>
                <ul class="settings-field-list">
                  <li><code>GETIR_API_KEY</code> — Getir partner API anahtarı</li>
                  <li><code>GETIR_RESTAURANT_ID</code> — Mağaza / restoran kimliği</li>
                </ul>
                <p class="muted">Değerleri <code>buybox-platform/.env</code> dosyasına ekleyin. Maliyetler <a href="/products/costs">Diğer Kanal Maliyetleri</a> sayfasından gelir.</p>
              </article>
            </div>
          </section>

          <section class="panel settings-section">
            <h2>WooCommerce</h2>
            <p class="platform-lead">Mağaza REST API bilgileriyle WooCommerce siparişleri kârlılık analizine dahil edilebilir. WooCommerce → Ayarlar → Gelişmiş → REST API</p>
            <div class="settings-grid">
              <div><label for="wooBaseUrl">Mağaza URL</label><input id="wooBaseUrl" placeholder="https://www.petfix.com.tr" autocomplete="off"></div>
              <div><label for="wooKey">Consumer Key</label><input id="wooKey" autocomplete="off"></div>
              <div><label for="wooSecret">Consumer Secret</label><input id="wooSecret" type="password" autocomplete="off"></div>
            </div>
            <div class="settings-actions">
              <button type="button" id="saveWooCommerceSettings">Kaydet</button>
              <button type="button" class="secondary" id="testWooCommerceBtn">Bağlantıyı Test Et</button>
            </div>
            <p class="muted">Read/Write izinli REST anahtarı oluşturun. Kayıt sonrası bağlantı otomatik test edilir.</p>
            <p class="muted" id="woocommerceSettingsStatus"></p>
          </section>
        </main>
        <script id="bootstrap" type="application/json">${bootstrap}</script>`;

    return wrapPanelPage({
      title: 'Sistem Ayarları',
      activeModule: 'admin',
      activeItem: 'settings',
      auth,
      bodyClass: 'pf-admin-page',
      bodyHtml: innerHtml,
      stylesheets: ['/assets/styles.css'],
      scripts: ['/assets/settings.js']
    });
  }

  function renderGetirPage() {
    return renderChannelPlaceholderPage({ channelId: 'getir', auth });
  }

  function renderUberEatsPage() {
    return renderChannelOrdersPage({
      channelId: 'uber-eats',
      auth,
      productMatchingMode: resolveMatchingModeForChannel(
        runtimeConfig.productMatchingMode || 'legacy',
        'uber-eats',
        runtimeConfig.productMatchingModeByChannel
      )
    });
  }

  function renderYemeksepetiPage() {
    return renderChannelOrdersPage({
      channelId: 'yemeksepeti',
      auth,
      productMatchingMode: resolveMatchingModeForChannel(
        runtimeConfig.productMatchingMode || 'legacy',
        'yemeksepeti',
        runtimeConfig.productMatchingModeByChannel
      )
    });
  }

  function renderWooCommercePage() {
    return renderChannelOrdersPage({
      channelId: 'woocommerce',
      auth,
      productMatchingMode: resolveMatchingModeForChannel(
        runtimeConfig.productMatchingMode || 'legacy',
        'woocommerce',
        runtimeConfig.productMatchingModeByChannel
      )
    });
  }

  function renderMatchingCenterPage({ defaultTab = 'master', focus = null } = {}) {
    const salesChannels = listSalesMatchingChannels().map((channel) => ({
      ...channel,
      route: getChannel(channel.id)?.route || channel.route || null
    }));
    const navItemByTab = {
      master: 'pool',
      workbench: 'inbox',
      'data-quality': 'data-quality'
    };
    const activeItem = navItemByTab[defaultTab] || 'pool';
    const bootstrap = jsonForHtml({
      authRequired: Boolean(auth.isEnabled()),
      salesChannels,
      defaultTab,
      focus
    });

    const channelStripHtml = renderMatchingChannelStrip(salesChannels);

    const innerHtml = `
        <input type="hidden" id="matchingUiVersion" value="69">
        <header class="pf-page-header matching-hero-card">
          <div>
            <p class="pf-page-eyebrow">Ürün Merkezi · BenimPOS</p>
            <h1 id="matchingHeroTitle">Ürün Eşleştirme Havuzu</h1>
            <p class="pf-page-lead" id="matchingHeroLead">Aksiyon bekleyen eşleştirmeleri hızla çözün. KPI kartları filtreler; satıra tıklayınca detay paneli açılır.</p>
          </div>
          <div class="pf-page-actions matching-hero-actions">
            <button type="button" class="pf-btn-secondary matching-hero-btn-secondary" id="syncMasterBtn">BenimPOS Güncelle</button>
            <button type="button" class="pf-btn-primary matching-hero-btn-primary" id="syncUberCatalogBtn">Katalog Sync</button>
            <div class="matching-hero-menu">
              <button type="button" class="pf-btn-ghost matching-hero-menu-btn" id="matchingHeroMenuBtn" aria-expanded="false" aria-controls="matchingHeroMenuPanel">Diğer ▾</button>
              <div class="matching-hero-menu-panel" id="matchingHeroMenuPanel" hidden>
                <button type="button" class="matching-hero-menu-item" id="runUberOpsBtn">Tam Uber Sync</button>
                <button type="button" class="matching-hero-menu-item" id="autoMatchBtn">Otomatik Eşleştir</button>
                <button type="button" class="matching-hero-menu-item" id="openMatchingSyncFoldBtn">Otomatik sync ayarları</button>
                <button type="button" class="matching-hero-menu-item" id="openUberOpsFoldBtn">TGO operasyon merkezi</button>
                <a class="matching-hero-menu-item matching-hero-menu-link" href="/marketplace/orders">Sipariş Kârlılığı</a>
                <a class="matching-hero-menu-item matching-hero-menu-link" href="/admin/settings">API Ayarları</a>
              </div>
            </div>
          </div>
        </header>

        <section class="pf-kpi-grid matching-kpi-grid--actions" id="matchingKpiGrid" aria-label="Eşleştirme aksiyon özeti">
          <article class="pf-kpi-card pf-kpi-card--link pf-kpi-card--warn matching-action-kpi" data-action-filter="pending_match" title="Eşleşme bekleyen kanal ürünleri">
            <span class="pf-kpi-label">Eşleşme bekleyen</span>
            <strong class="pf-kpi-value" id="kpiPendingMatch">—</strong>
            <span class="pf-kpi-hint">Kanal tarafında karar gerek</span>
          </article>
          <article class="pf-kpi-card pf-kpi-card--link pf-kpi-card--danger matching-action-kpi" data-action-filter="missing_master" title="BenimPOS'ta bulunamayan">
            <span class="pf-kpi-label">BenimPOS'ta yok</span>
            <strong class="pf-kpi-value" id="kpiNotInBenimpos">—</strong>
            <span class="pf-kpi-hint">Ana ürün oluştur / bağla</span>
          </article>
          <article class="pf-kpi-card pf-kpi-card--link matching-action-kpi" data-action-filter="multi_candidate" title="Birden fazla aday veya çakışma">
            <span class="pf-kpi-label">Birden fazla aday</span>
            <strong class="pf-kpi-value" id="kpiMultiCandidate">—</strong>
            <span class="pf-kpi-hint">Barkod / aday çakışması</span>
          </article>
          <article class="pf-kpi-card pf-kpi-card--link pf-kpi-card--warn matching-action-kpi" data-action-filter="data_issues" title="Veri kalitesi sorunları">
            <span class="pf-kpi-label">Veri eksik</span>
            <strong class="pf-kpi-value" id="kpiDataIssues">—</strong>
            <span class="pf-kpi-hint">Stok, maliyet, gramaj…</span>
          </article>
          <article class="pf-kpi-card pf-kpi-card--link pf-kpi-card--ok matching-action-kpi" data-action-filter="bulk_confirmable" title="Yüksek güvenle toplu onay">
            <span class="pf-kpi-label">Toplu onaylanabilir</span>
            <strong class="pf-kpi-value" id="kpiBulkConfirmable">—</strong>
            <span class="pf-kpi-hint">Güven ≥ %88</span>
          </article>
        </section>
        <input type="hidden" name="actionFilter" id="masterActionFilter" value="">
        <p class="matching-sync-meta-line muted" id="matchingSyncMetaLine">Son sync: <span id="kpiMasterSync">—</span></p>

          <details class="matching-fold panel matching-fold--hidden" id="matchingSyncFold">
            <summary class="matching-fold-summary">Otomatik eşleştirme sync</summary>
          <section class="matching-sync-panel" id="matchingSyncPanel" aria-label="Otomatik eşleştirme sync">
            <div class="matching-sync-head">
              <div>
                <h2 class="matching-sync-title">Otomatik Eşleştirme Sync</h2>
                <p class="muted" id="matchingSyncDesc">BenimPOS → katalog → otomatik eşleştirme (zamanlanmış)</p>
              </div>
              <div class="matching-sync-actions">
                <label class="matching-check"><input type="checkbox" id="matchingSyncEnabled"> Aktif</label>
                <button type="button" class="btn btn-ghost btn-sm" id="saveMatchingSyncBtn">Kaydet</button>
                <button type="button" class="btn-brown btn-sm" id="runMatchingSyncBtn">Şimdi Çalıştır</button>
              </div>
            </div>
            <div class="matching-sync-channels" id="matchingSyncChannels" aria-label="Sync kanalları">
              <span class="matching-sync-channels-label">Kanallar:</span>
              <label class="matching-check"><input type="checkbox" name="syncChannel" value="uber-eats" checked> Uber</label>
              <label class="matching-check"><input type="checkbox" name="syncChannel" value="trendyol-marketplace" checked> Trendyol</label>
              <label class="matching-check"><input type="checkbox" name="syncChannel" value="woocommerce" checked> WooCommerce</label>
              <label class="matching-check"><input type="checkbox" name="syncChannel" value="yemeksepeti" checked> Yemeksepeti</label>
              <span class="muted matching-sync-ys-hint">YS: otomatik sync katalogda ~120 sayfa/çalışma (tam liste için manuel sync)</span>
            </div>
            <p class="muted" id="matchingSyncMeta">—</p>
          </section>
          </details>

          <details class="matching-fold panel matching-fold--hidden" id="uberOpsFold">
            <summary class="matching-fold-summary">Uber Eats operasyon merkezi</summary>
          <section class="uber-ops-panel" id="uberOpsPanel" aria-label="Uber Eats operasyon">
            <div class="uber-ops-head">
              <div>
                <h2 class="uber-ops-title">Uber Eats Operasyon Merkezi</h2>
                <p class="muted">Trendyol Go (TRENDGO) — katalog sync, eşleştirme ve BenimPOS satış hazırlığı</p>
              </div>
              <div class="uber-ops-head-actions">
                <span class="uber-ops-progress muted" id="uberOpsProgress">Yükleniyor…</span>
                <button type="button" class="btn btn-ghost btn-sm" id="refreshUberOpsBtn">Durumu Yenile</button>
              </div>
            </div>
            <div class="uber-ops-health" id="uberOpsHealth">API durumu yükleniyor…</div>
            <ol class="uber-ops-checklist" id="uberOpsChecklist"></ol>
          </section>
          </details>

          <details class="matching-fold panel matching-fold--compact matching-fold--hidden" id="matchingOpsFold">
            <summary class="matching-fold-summary">Kanal özeti ve Uber ilerleme</summary>
          <div class="matching-ops-chrome" id="matchingOpsChrome">
          <section class="ops-summary-strip ops-summary-strip--legacy" id="matchingSummaryStrip" aria-live="polite" hidden>
            <div class="ops-summary-item"><span>Ana ürün (BenimPOS)</span><strong id="statMasterCount">—</strong></div>
            <div class="ops-summary-item"><span>Son sync</span><strong id="statMasterSync">—</strong></div>
            <div class="ops-summary-item"><span>Uber eşleşme</span><strong id="statUberMapped">—</strong></div>
            <div class="ops-summary-item ops-summary-item--warn"><span>Bekleyen / çakışma</span><strong id="statPending">—</strong></div>
            <div class="ops-summary-item"><span>Manuel onaylı</span><strong id="statManualConfirmed">—</strong></div>
            <div class="ops-summary-item"><span>Otomatik (onay bekliyor)</span><strong id="statAutoMatched">—</strong></div>
          </section>
          <section class="matching-channel-overview" id="matchingChannelOverview" aria-label="Kanal eşleştirme özeti"></section>
          <div id="matchingSalesGate" class="matching-sales-gate" hidden></div>
          <section id="matchingReviewProgress" class="matching-review-progress" hidden aria-label="Uber eşleştirme ilerlemesi">
            <div class="matching-review-progress-head">
              <div>
                <strong>Uber satış hazırlığı</strong>
                <p class="muted" id="reviewProgressHint">Manuel onaylı eşleştirme oranı</p>
              </div>
              <span class="matching-review-progress-pct" id="reviewProgressPct">—</span>
            </div>
            <div class="matching-review-progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100">
              <div class="matching-review-progress-fill" id="reviewProgressFill"></div>
            </div>
            <div class="matching-review-progress-actions" id="reviewProgressActions"></div>
          </section>
          </div>
          </details>

          <div class="matching-channel-strip" id="matchingChannelStrip" role="toolbar" aria-label="Kanal filtresi">
            ${channelStripHtml}
          </div>

          <nav class="matching-tabs matching-tabs--flat matching-tabs--minimal matching-tabs--modes" id="matchingTabs" aria-label="Çalışma modu">
            <button type="button" class="matching-tab matching-tab--ops matching-tab--inbox" data-tab="workbench" title="Aksiyon bekleyen eşleştirmeler">Gelen Kutusu <span id="workbenchTabCount" class="matching-tab-count"></span></button>
            <button type="button" class="matching-tab active" data-tab="master">Ana Ürün Havuzu</button>
            <button type="button" class="matching-tab matching-tab--ops" data-tab="compare" title="Alan bazlı karşılaştırma ve onay">Karşılaştır ve Onayla <span id="compareTabCount" class="matching-tab-count"></span></button>
            <label class="matching-tabs-more">
              <span class="sr-only">Diğer ekranlar</span>
              <select id="matchingMoreTab" aria-label="Diğer ekranlar">
                <option value="">Diğer…</option>
                <option value="data-quality">Veri Kalitesi</option>
                <option value="uber-eats">TGO katalog</option>
                <option value="trendyol-marketplace">Trendyol katalog</option>
                <option value="yemeksepeti">Yemeksepeti katalog</option>
                <option value="woocommerce">WooCommerce katalog</option>
                <option value="workbench-missing">BenimPOS'ta yok (gelen kutu)</option>
                <option value="conflicts">Barkod çakışması</option>
                <option value="reports">Eksik / fazla</option>
                <option value="logs">Geçmiş</option>
              </select>
            </label>
          </nav>

          <div class="matching-inbox-nudge hidden" id="matchingInboxNudge" role="status" aria-live="polite">
            <div class="matching-inbox-nudge-text">
              <strong id="matchingInboxNudgeCount">—</strong>
              <span id="matchingInboxNudgeLabel">ürün karar bekliyor — Gelen Kutusu ile hızlıca onaylayın.</span>
            </div>
            <div class="matching-inbox-nudge-actions">
              <button type="button" class="btn-brown btn-sm" id="matchingInboxNudgeGo">Gelen Kutusu →</button>
              <button type="button" class="btn-mini ghost" id="matchingInboxNudgeDismiss">Kapat</button>
            </div>
          </div>

          <section class="panel matching-panel matching-master-pool" id="tabMaster">
            <nav class="master-pool-tabs" id="masterPoolTabs" role="tablist" aria-label="Havuz durumu"></nav>

            <form id="masterFilterForm" class="master-pool-filters" onsubmit="return false">
              <input type="hidden" name="poolTab" id="masterPoolTab" value="all">
              <input type="hidden" name="mappingChannel" id="masterMappingChannel" value="">
              <input type="hidden" name="sort" id="masterSort" value="name">
              <input type="hidden" name="sortDir" id="masterSortDir" value="asc">
              <input type="hidden" name="limit" id="masterPageSize" value="50">
              <input type="hidden" name="actionFilter" id="masterActionFilter" value="">
              <input type="hidden" name="lowProfit" value="">
              <input type="hidden" name="missingChannelPrice" value="">

              <div class="master-pool-filter-row">
                <input type="search" name="q" id="masterSearch" placeholder="Barkod veya ürün adı… (/)" autocomplete="off" aria-label="Barkod">
                <input type="search" name="stockCode" id="masterStockCodeFilter" placeholder="BenimPOS stok kodu" aria-label="Stok kodu">
                <input type="search" name="channelCode" id="masterChannelCodeFilter" placeholder="Kanal ürün kodu" aria-label="Kanal ürün kodu">
                <select name="brand" id="masterBrandFilter" aria-label="Marka">
                  <option value="">Marka: Tümü</option>
                </select>
              </div>
              <div class="master-pool-filter-row">
                <select name="category" id="masterCategoryFilter" aria-label="Kategori">
                  <option value="">Kategori: Tümü</option>
                </select>
                <select name="mappingStatus" id="masterMappingStatus" aria-label="Eşleşme durumu">
                  <option value="">Eşleşme: Tümü</option>
                  <option value="needs_action">Aksiyon gerek</option>
                  <option value="unmapped">Eşleşmedi</option>
                  <option value="manual_confirmed">Onaylı</option>
                  <option value="auto_matched">Otomatik</option>
                  <option value="pending">Bekliyor</option>
                  <option value="review_required">Kontrol gerek</option>
                  <option value="mapped">Herhangi eşleşmiş</option>
                </select>
                <select name="stock" aria-label="Stok durumu">
                  <option value="">Stok: Tümü</option>
                  <option value="in">Stoklu</option>
                  <option value="out">Stoksuz</option>
                </select>
                <select name="cost" aria-label="Maliyet durumu">
                  <option value="">Maliyet: Tümü</option>
                  <option value="has">Maliyetli</option>
                  <option value="missing">Maliyetsiz</option>
                </select>
                <select name="dataQuality" id="masterDataQualityFilter" aria-label="Veri kalitesi">
                  <option value="">Veri kalitesi: Tümü</option>
                  <option value="clean">Sorun yok</option>
                  <option value="issues">Sorunlu</option>
                </select>
                <div class="master-pool-filter-actions">
                  <button type="button" class="btn-link" id="masterAdvancedToggle">Detaylı Filtreyi Aç</button>
                  <button type="button" class="btn btn-ghost btn-sm" id="masterFilterClear">Temizle</button>
                  <button type="button" class="btn btn-brown btn-sm" id="masterFilterApply">Filtrele</button>
                </div>
              </div>
              <div class="master-pool-advanced" id="masterAdvancedFilters" hidden>
                <div class="master-pool-filter-row master-pool-filter-row--advanced">
                  <input type="number" name="weightMin" placeholder="Min gramaj (g)" aria-label="Min gramaj">
                  <input type="number" name="weightMax" placeholder="Max gramaj (g)" aria-label="Max gramaj">
                  <input type="search" name="variant" placeholder="Varyant" aria-label="Varyant">
                  <label class="master-filter-check"><input type="checkbox" name="negativeStock" id="masterNegativeStock" value="1"> Negatif stok</label>
                  <input type="date" name="updatedSince" aria-label="Son güncelleme">
                  <select name="matchAggregate" aria-label="Eşleşme özeti">
                    <option value="">Eşleşme özeti</option>
                    <option value="manual_confirmed">Onaylı</option>
                    <option value="needs_action">Aksiyon gerek</option>
                    <option value="unmapped">Eşleşmemiş</option>
                  </select>
                  <select name="priceGap" aria-label="Fiyat farkı">
                    <option value="">Fiyat farkı: Tümü</option>
                    <option value="high">Kanal farkı ≥ %10</option>
                    <option value="markup25_miss">Uber +25% dışı</option>
                  </select>
                </div>
              </div>
            </form>

            <div class="matching-active-filters" id="masterActiveFilters" hidden></div>
            <div class="master-summary-strip master-summary-strip--compact" id="masterSummaryStrip" aria-live="polite">—</div>

            <div class="master-pool-toolbar">
              <div class="master-pool-toolbar-left">
                <select id="masterBulkMenu" class="master-toolbar-select" aria-label="Toplu işlemler">
                  <option value="">Toplu İşlemler</option>
                  <option value="confirm">Toplu eşleşmeyi onayla</option>
                  <option value="review">Toplu incelemeye gönder</option>
                  <option value="unmap">Toplu kanal bağlantısını kaldır</option>
                  <option value="passive">Toplu pasife al</option>
                  <option value="export">CSV/Excel indir</option>
                </select>
                <button type="button" class="btn btn-ghost btn-sm" id="masterOpenColumnModal">Tabloyu Özelleştir</button>
                <select id="masterColumnPreset" class="master-toolbar-select" aria-label="Hazır görünüm">
                  <option value="">Görünüm</option>
                  <option value="matching">Eşleştirme görünümü</option>
                  <option value="stock">Stok görünümü</option>
                  <option value="price">Fiyat görünümü</option>
                  <option value="quality">Veri kalitesi görünümü</option>
                </select>
              </div>
              <div class="master-pool-toolbar-right">
                <label class="master-page-size-label muted">Sayfa başına
                  <select id="masterPageSizeSelect" aria-label="Sayfa başına ürün">
                    <option value="20">20</option>
                    <option value="50" selected>50</option>
                    <option value="100">100</option>
                  </select>
                </label>
              </div>
            </div>
            <div class="master-bulk-bar" id="masterBulkBar" hidden>
              <span><strong id="masterBulkCount">0</strong> ürün seçildi</span>
            </div>

            <div class="matching-table-wrap matching-table-wrap--master master-pool-table-shell">
              <table class="matching-table matching-table--master matching-table--dense matching-table--ops">
                <thead>
                  <tr id="masterTableHeadRow"></tr>
                </thead>
                <tbody id="masterProductsBody">
                  <tr><td colspan="8" class="matching-loading">Yükleniyor…</td></tr>
                </tbody>
              </table>
              <div class="master-mobile-cards" id="masterMobileCards" aria-label="Mobil ürün kartları"></div>
            </div>

            <div class="matching-footer matching-footer--split" id="masterFooter">
              <span id="masterFooterMeta">—</span>
              <div class="matching-pagination" id="masterPagination">
                <button type="button" class="btn-mini ghost" id="masterPrevPage" disabled>Önceki</button>
                <label class="master-page-jump muted">
                  Sayfa
                  <input type="number" id="masterPageJump" min="1" value="1" aria-label="Sayfa numarası">
                  <span id="masterPageJumpTotal">/ 1</span>
                </label>
                <button type="button" class="btn-mini ghost" id="masterNextPage" disabled>Sonraki</button>
              </div>
            </div>
          </section>

          <div class="master-modal-backdrop" id="masterBulkModal" hidden role="dialog" aria-labelledby="masterBulkModalTitle">
            <div class="master-modal">
              <h3 id="masterBulkModalTitle">Toplu işlem</h3>
              <div id="masterBulkModalBody"></div>
              <div class="master-modal-actions">
                <button type="button" class="btn btn-ghost btn-sm" id="masterBulkModalClose">İptal</button>
                <button type="button" class="btn btn-brown btn-sm" id="masterBulkModalConfirm">Onayla ve uygula</button>
              </div>
            </div>
          </div>

          <div class="master-modal-backdrop" id="masterColumnModal" hidden role="dialog" aria-label="Kolon özelleştirme">
            <div class="master-modal">
              <h3>Tablo kolonları</h3>
              <div id="masterColumnList" class="master-column-list"></div>
              <div class="master-modal-actions">
                <button type="button" class="btn btn-ghost btn-sm" id="masterColumnModalClose">İptal</button>
                <button type="button" class="btn btn-brown btn-sm" id="masterColumnModalSave">Kaydet</button>
              </div>
            </div>
          </div>

          <section class="panel matching-panel" id="tabChannelPlanned" hidden>
            <div class="matching-panel-head channel-catalog-head">
              <div class="channel-catalog-head-main">
                <div class="channel-catalog-head-logo" id="plannedChannelLogo" aria-hidden="true"></div>
                <div>
                  <h2 id="plannedChannelTitle">Kanal eşleştirmesi</h2>
                  <p class="muted" id="plannedChannelDesc">Bu kanalın ürün eşleştirmesi yakında aktif olacak.</p>
                </div>
              </div>
              <div class="channel-catalog-head-actions">
                <div class="matching-planned-actions" id="plannedChannelActions"></div>
                <button type="button" class="btn btn-ghost btn-sm matching-back-master" data-tab-jump="master">← Ana havuz</button>
              </div>
            </div>
            <div id="plannedChannelBody" class="channel-catalog-body"></div>
          </section>

          <section class="panel matching-panel" id="tabUber" hidden>
            <div class="matching-panel-head channel-catalog-head">
              <div class="channel-catalog-head-main">
                <div class="channel-catalog-head-logo" id="uberChannelLogo" aria-hidden="true"></div>
                <div>
                  <h2>TGO Katalog</h2>
                  <p class="muted">Trendyol Go katalog ve fiyat karşılaştırması. Günlük onay için <strong>Gelen Kutusu</strong> sekmesini kullanın.</p>
                </div>
              </div>
              <button type="button" class="btn btn-ghost btn-sm matching-back-master" data-tab-jump="master">← Ana havuz</button>
            </div>
            <form id="uberFilterForm" class="matching-toolbar matching-toolbar--channel">
              <input type="search" name="q" id="uberSearch" placeholder="Ürün veya barkod ara…" autocomplete="off" aria-label="TGO katalog ara">
              <select name="status" aria-label="Eşleştirme">
                <option value="">Eşleştirme: Tümü</option>
                <option value="auto_matched">Onay bekliyor</option>
                <option value="manual_confirmed">Onaylı</option>
                <option value="review_required">Kontrol gerek</option>
                <option value="unmapped">Eşleşmedi</option>
              </select>
              <select name="match" aria-label="Liste">
                <option value="" selected>Tüm ürünler</option>
                <option value="mapped">Eşleştirilmiş</option>
                <option value="unmapped">Eşleşmemiş</option>
              </select>
              <details class="uber-advanced-filters" id="uberAdvancedFilters">
                <summary>Ek filtre</summary>
                <div class="uber-advanced-filters-body">
                  <div class="price-compare-summary" id="uberPriceSummary">—</div>
                  <select name="diff" aria-label="Fiyat farkı">
                    <option value="">Fark: Tümü</option>
                    <option value="high">Fark ≥ %10</option>
                    <option value="meaningful">Gerçek satış farkı ≥ %10</option>
                    <option value="suspicious_sale">BenimPOS satış şüpheli (≤₺1)</option>
                    <option value="missing_price">Fiyat eksik</option>
                    <option value="markup_25">Tam %25 fark</option>
                  </select>
                  <select name="onSale" aria-label="Satış">
                    <option value="">Satış: Tümü</option>
                    <option value="on">Satışta</option>
                    <option value="off">Satışta değil</option>
                    <option value="unknown">Bilinmiyor</option>
                  </select>
                  <select name="sort" aria-label="Sıralama">
                    <option value="sale_diff_desc">Fark (büyük)</option>
                    <option value="sale_diff_asc">Fark (küçük)</option>
                    <option value="margin_desc">Marj / alış</option>
                    <option value="uber_price">TGO fiyat</option>
                    <option value="name">Ada göre</option>
                  </select>
                  <button type="button" id="confirmAutoMatchedBulkBtn" class="btn-brown ghost" hidden>Otomatikleri toplu onayla</button>
                  <button type="button" id="confirmMarkup25BulkBtn" class="btn-brown ghost" hidden>%25 farklıları onayla</button>
                </div>
              </details>
            </form>
            <div class="matching-active-filters" id="uberActiveFilters" hidden></div>
            <div class="matching-table-wrap">
              <table class="matching-table matching-table--price">
                <colgroup>
                  <col class="col-uber-product">
                  <col class="col-master-product">
                  <col class="col-uber-sale">
                  <col class="col-master-sale">
                  <col class="col-master-buy">
                  <col class="col-diff">
                  <col class="col-status">
                  <col class="col-actions">
                </colgroup>
                <thead>
                  <tr>
                    <th>Uber ürün<br><small class="th-sub">Uber katalog adı</small></th>
                    <th>BenimPOS eşleşmesi<br><small class="th-sub">Ana havuz</small></th>
                    <th class="th-price-uber">UBER SATIŞ ₺<br><small class="th-sub">Uber fiyatı</small></th>
                    <th class="th-price-master">BenimPOS SATIŞ ₺<br><small class="th-sub">Ana havuz fiyatı</small></th>
                    <th class="th-price-buy">BenimPOS ALIŞ ₺<br><small class="th-sub">Maliyet</small></th>
                    <th>Fark %</th>
                    <th>Durum</th>
                    <th>İşlem</th>
                  </tr>
                </thead>
                <tbody id="uberProductsBody">
                  <tr><td colspan="8" class="matching-loading">Uber Katalog Çek ile başlayın.</td></tr>
                </tbody>
              </table>
            </div>
            <div class="matching-footer" id="uberFooter">—</div>
            <div class="matching-pagination" id="uberPagination" hidden>
              <button type="button" class="btn-mini ghost" id="uberPrevPage">← Önceki</button>
              <span id="uberPageLabel">Sayfa 1</span>
              <button type="button" class="btn-mini ghost" id="uberNextPage">Sonraki →</button>
            </div>
            <details class="price-compare-multi-panel" id="uberMultiPanel">
              <summary class="price-compare-multi-summary">
                <span id="uberMultiSummary">Çoklu Uber eşleşmeleri</span>
              </summary>
              <div class="price-compare-advice panel-inner">
                <strong>1 ana ürün → birden fazla Uber listesi</strong>
                <p>Aynı BenimPOS ürününe birden fazla Uber listesi bağlanabilir. <em>Birincil</em> yalnızca hangi Uber SKU'nun asıl olduğunu işaretler — <strong>eşleştirme yapmaz</strong>. Eşleştirme için <em>Öneriyi onayla</em> veya <em>Otomatik Eşleştir</em> kullanın.</p>
              </div>
              <div id="uberMultiGroups" class="price-compare-multi"></div>
            </details>
          </section>

          <section class="panel matching-panel" id="tabReports" hidden>
            <div class="matching-panel-head">
              <h2>Eksik / Fazla Ürün Raporu</h2>
              <p class="muted">Sol liste: stoklu BenimPOS ürünleri <strong>onaylı Uber eşleşmesi olmayan</strong> kayıtlar (Uber’da hiç yok ≠ eşleşme yok). Sağ liste: Uber katalogda görünen ama onaylı eşleştirmesi olmayan ürünler.</p>
            </div>
            <div class="matching-report-grid">
              <div class="matching-report-card">
                <h3>BenimPOS · Uber eşleşmesi onaylı değil <span id="reportMissingCount" class="matching-report-count">—</span></h3>
                <p class="muted matching-report-sub" id="reportMissingBreakdown">—</p>
                <div class="matching-table-wrap matching-table-wrap--short">
                  <table class="matching-table">
                    <thead><tr><th>Ürün</th><th>Barkod</th><th>Stok</th><th>Durum</th></tr></thead>
                    <tbody id="reportMissingBody"></tbody>
                  </table>
                </div>
              </div>
              <div class="matching-report-card">
                <h3>Uber katalog · Onaylı eşleşme yok <span id="reportExtraCount" class="matching-report-count">—</span></h3>
                <p class="muted matching-report-sub">Uber mağaza listesinde var; BenimPOS ile onaylı bağ yok.</p>
                <div class="matching-table-wrap matching-table-wrap--short">
                  <table class="matching-table">
                    <thead><tr><th>Uber ürün</th><th>Barkod</th><th>Durum</th></tr></thead>
                    <tbody id="reportExtraBody"></tbody>
                  </table>
                </div>
              </div>
            </div>
          </section>

          <section class="panel matching-panel" id="tabConflicts" hidden>
            <div class="matching-panel-head">
              <h2>Barkod Çakışmaları</h2>
              <p class="muted">Aynı barkoda birden fazla ana ürün veya eşleştirme riski — otomatik satış aktarımında engellenir.</p>
            </div>
            <div class="matching-table-wrap">
              <table class="matching-table">
                <thead><tr><th>Barkod</th><th>Sebep</th><th>Adaylar</th></tr></thead>
                <tbody id="conflictsBody"><tr><td colspan="3" class="matching-loading">—</td></tr></tbody>
              </table>
            </div>
          </section>

          <section class="panel matching-panel" id="tabMissingReview" hidden>
            <div class="matching-panel-head">
              <h2>BenimPOS'ta Yok — Uber Ürün İncelemesi</h2>
              <p class="muted">Otomatik eşleştirmede ana ürün bulunamayan Uber ürünleri. Sınıflandırma tamamlanmadan otomatik satış akışına geçilmez.</p>
            </div>
            <div class="matching-review-summary" id="missingReviewSummary">—</div>
            <div class="matching-review-actions">
              <button type="button" class="btn-brown" id="applyReviewSuggestionsBtn">Önerileri Uygula (≥70%)</button>
              <select id="missingReviewOnSaleFilter" aria-label="Uber satış durumu">
                <option value="">Tüm satış durumları</option>
                <option value="on">Uber'de satışta</option>
                <option value="off">Uber'de satışta değil</option>
                <option value="unknown">Satış durumu bilinmiyor</option>
              </select>
              <span class="muted" id="missingReviewSuggestionHint">Uber Katalog Çek sonrası satış durumu güncellenir.</span>
            </div>
            <div class="matching-table-wrap">
              <table class="matching-table">
                <thead>
                  <tr>
                    <th>Uber ürün</th>
                    <th>Barkod</th>
                    <th>Uber satış</th>
                    <th>Öneri</th>
                    <th>İnceleme sınıfı</th>
                    <th>Not</th>
                    <th>Kaydet</th>
                  </tr>
                </thead>
                <tbody id="missingReviewBody">
                  <tr><td colspan="7" class="matching-loading">Yükleniyor…</td></tr>
                </tbody>
              </table>
            </div>
          </section>

          <section class="panel matching-panel matching-compare-panel" id="tabCompare" hidden>
            <div class="matching-panel-head">
              <div>
                <h2>Karşılaştır ve Onayla</h2>
                <p class="muted">Kanal ürünü ile BenimPOS adayı alan bazlı karşılaştırılır. Güven skoru ve farklar net görünür.</p>
              </div>
            </div>
            <form id="compareFilterForm" class="matching-toolbar matching-toolbar--compare" onsubmit="return false">
              <select name="quality" id="compareQualityFilter" aria-label="Liste">
                <option value="confirmable">Toplu onaylanabilir</option>
                <option value="all">Tüm bekleyenler</option>
                <option value="suspicious">Şüpheli</option>
                <option value="recovered">Barkod kurtarılmış</option>
              </select>
              <input type="search" name="q" id="compareSearch" placeholder="Ürün veya barkod ara…" autocomplete="off">
              <input type="hidden" name="channelId" id="compareChannelFilter" value="">
              <button type="button" class="btn-brown btn-sm" id="compareReloadBtn">Yenile</button>
            </form>
            <div class="matching-bulk-bar matching-compare-bulk" id="compareBulkBar" hidden>
              <span id="compareBulkMeta" class="matching-bulk-meta">0 seçili</span>
              <button type="button" class="btn-brown" id="compareBulkConfirmBtn" disabled>Toplu onay</button>
              <button type="button" class="btn-mini ghost" id="compareBulkRejectBtn" disabled>Toplu reddet</button>
              <button type="button" class="btn-mini ghost" id="compareBulkClearBtn">Temizle</button>
            </div>
            <div class="matching-table-wrap matching-table-wrap--compare">
              <table class="matching-table matching-table--compare">
                <thead>
                  <tr>
                    <th class="col-compare-check"><input type="checkbox" id="compareSelectAll" aria-label="Sayfayı seç"></th>
                    <th>Kanal ürün</th>
                    <th>Önerilen BenimPOS</th>
                    <th>Güven</th>
                    <th>Alan karşılaştırması</th>
                    <th>Sorun / öneri</th>
                    <th>İşlem</th>
                  </tr>
                </thead>
                <tbody id="compareProductsBody">
                  <tr><td colspan="7" class="matching-loading">Yükleniyor…</td></tr>
                </tbody>
              </table>
            </div>
            <div class="matching-footer matching-footer--split" id="compareFooter">
              <span id="compareFooterMeta">—</span>
              <div class="matching-pagination" id="comparePagination">
                <button type="button" class="btn-mini ghost" id="comparePrevPage" disabled>Önceki</button>
                <span id="comparePageLabel" class="muted">Sayfa 1</span>
                <button type="button" class="btn-mini ghost" id="compareNextPage" disabled>Sonraki</button>
              </div>
            </div>
          </section>

          <section class="panel matching-panel matching-inbox-panel" id="tabWorkbench" hidden>
            <div class="inbox-top-summary" id="workbenchInboxSummary" aria-live="polite">
              <div class="inbox-readiness-bar" id="workbenchSummaryProgress" hidden>
                <div class="inbox-readiness-fill" id="workbenchSummaryProgressFill"></div>
              </div>
              <p class="inbox-summary-line inbox-summary-line--muted" id="workbenchSummaryReadiness" hidden>—</p>
              <p class="inbox-summary-line" id="workbenchSummaryPending">—</p>
              <p class="inbox-summary-line inbox-summary-line--ok" id="workbenchSummarySafe">—</p>
            </div>
            <div class="inbox-toolbar-compact">
              <div class="matching-channel-strip matching-channel-strip--inbox" id="workbenchChannelStrip" role="toolbar" aria-label="Kanal filtresi"></div>
              <div class="inbox-quick-filters" id="workbenchInboxQuickFilters" role="toolbar" aria-label="Hızlı kuyruk filtresi" hidden></div>
              <form id="workbenchFilterForm" class="matching-toolbar matching-toolbar--inbox-compact" onsubmit="return false">
                <select name="queueMode" id="workbenchQueueMode" aria-label="Kuyruk türü">
                  <option value="all">Tüm bekleyenler</option>
                  <option value="high_confidence">Yüksek güvenli öneriler</option>
                  <option value="manual_review">Manuel kontrol gerekenler</option>
                  <option value="missing_master">BenimPOS'ta bulunamayanlar</option>
                  <option value="multi_candidate">Birden fazla aday</option>
                  <option value="barcode_diff">Barkod farklı olanlar</option>
                  <option value="data_gap">Veri eksiği olanlar</option>
                  <option value="suspicious">Şüpheli onaylılar</option>
                </select>
                <input type="search" name="q" id="workbenchSearch" placeholder="Ürün veya barkod ara… (/)" autocomplete="off" aria-label="Ara">
                <input type="hidden" name="channelId" id="workbenchInboxChannel" value="">
                <button type="button" class="btn btn-ghost btn-sm" id="workbenchInboxReload" title="Yenile">↻</button>
                <button type="button" class="btn btn-brown btn-sm" id="workbenchInboxBulkSafe" hidden>Güvenli Toplu Onay</button>
                <button type="button" class="btn btn-ghost btn-sm" id="workbenchInboxBulkAuto" hidden>Otomatik Onayları Toplu Onayla</button>
              </form>
            </div>
            <div class="inbox-progress-simple" id="workbenchInboxProgress" role="status" aria-live="polite"></div>
            <div class="inbox-decision-shell" id="workbenchInboxDecision">
              <div class="inbox-skeleton" id="workbenchInboxSkeleton" hidden aria-hidden="true"></div>
              <div class="inbox-decision-grid" id="workbenchInboxGrid"></div>
            </div>
            <div class="inbox-commercial" id="workbenchInboxCommercial" hidden></div>
            <div class="inbox-compare-table-wrap" id="workbenchInboxCompareTable" hidden></div>
            <div class="inbox-action-bar inbox-action-bar--primary" id="workbenchInboxActions">
              <button type="button" class="btn-brown btn-inbox-primary" id="workbenchInboxConfirm" disabled>Onayla ve Sonraki</button>
              <button type="button" class="btn-mini ghost" id="workbenchInboxMap">Başka Ürün Seç</button>
              <button type="button" class="btn-mini ghost" id="workbenchInboxSkip">Atla</button>
              <button type="button" class="btn-mini ghost btn-inbox-reject" id="workbenchInboxReject">Reddet</button>
              <button type="button" class="btn-mini ghost" id="workbenchInboxPrev" disabled>← Önceki</button>
              <span class="inbox-kbd-hints muted">Enter onayla · ← → gezin · / ara · F eşleştir</span>
              <button type="button" class="btn-mini ghost" id="workbenchInboxUnmap" hidden>Eşleştirmeyi kaldır</button>
            </div>
            <p class="inbox-shortcuts-hint muted" id="workbenchShortcutsHint">
              <kbd>Enter</kbd> onayla · <kbd>F</kbd> başka ürün · <kbd>A</kbd> atla · <kbd>R</kbd> reddet · <kbd>/</kbd> ara · <kbd>←</kbd><kbd>→</kbd> gezin
            </p>
            <details class="inbox-list-fallback" id="workbenchListFallback">
              <summary>Gelişmiş liste görünümü</summary>
              <div class="workbench-bulk-bar" id="workbenchBulkBar" hidden>
                <span id="workbenchBulkMeta" class="workbench-bulk-meta">0 seçili</span>
                <button type="button" id="workbenchBulkConfirmBtn" class="btn-brown" disabled>Seçilenleri onayla</button>
                <button type="button" id="workbenchBulkUnmapBtn" class="btn-mini ghost" hidden>Seçilenleri kaldır</button>
                <button type="button" id="workbenchBulkClearBtn" class="btn-mini ghost">Temizle</button>
              </div>
              <div class="matching-table-wrap">
                <table class="matching-table matching-table--workbench">
                  <thead>
                    <tr>
                      <th class="col-wb-select" scope="col">
                        <input type="checkbox" id="workbenchSelectAll" class="workbench-select-all" aria-label="Sayfayı seç">
                      </th>
                      <th>Kanal ürünü</th>
                      <th>BenimPOS</th>
                      <th>Durum</th>
                      <th>İşlem</th>
                    </tr>
                  </thead>
                  <tbody id="workbenchBody">
                    <tr><td colspan="5" class="matching-loading">Liste yükleniyor…</td></tr>
                  </tbody>
                </table>
              </div>
              <div class="matching-footer matching-footer--split" id="workbenchFooter">
                <span id="workbenchFooterMeta">—</span>
                <div class="matching-pagination" id="workbenchPagination">
                  <button type="button" class="btn-mini ghost" id="workbenchPrevPage" disabled>Önceki</button>
                  <span id="workbenchPageLabel" class="muted">Sayfa 1</span>
                  <button type="button" class="btn-mini ghost" id="workbenchNextPage" disabled>Sonraki</button>
                </div>
              </div>
            </details>
          </section>

          <section class="panel matching-panel" id="tabDataQuality" hidden>
            <div class="matching-panel-head">
              <div>
                <h2>Veri Kalitesi</h2>
                <p class="muted">Kayıtlar otomatik düzeltilmez veya silinmez — yalnızca inceleme listesi.</p>
              </div>
            </div>
            <nav class="dq-category-tabs" id="dqCategoryTabs" aria-label="Veri kalitesi kategorileri"></nav>
            <div class="matching-table-wrap">
              <table class="matching-table matching-table--dq">
                <thead id="dqTableHead">
                  <tr><th>Ürün</th><th>Barkod</th><th>Stok</th><th>Maliyet</th><th>Detay</th></tr>
                </thead>
                <tbody id="dqBody">
                  <tr><td colspan="5" class="matching-loading">Yükleniyor…</td></tr>
                </tbody>
              </table>
            </div>
            <div class="matching-footer" id="dqFooter">—</div>
          </section>

          <section class="panel matching-panel" id="tabLogs" hidden>
            <div class="matching-panel-head">
              <h2>Eşleştirme Geçmişi</h2>
            </div>
            <div class="matching-table-wrap">
              <table class="matching-table">
                <thead><tr><th>Tarih</th><th>İşlem</th><th>Kanal ürün</th><th>Ana ürün</th></tr></thead>
                <tbody id="logsBody"><tr><td colspan="4" class="matching-loading">—</td></tr></tbody>
              </table>
            </div>
          </section>

        <aside class="master-detail-drawer pf-detail-drawer" id="masterDetailDrawer" hidden aria-label="Ürün detay paneli">
          <div class="master-detail-drawer-inner">
            <header class="master-detail-head">
              <div>
                <p class="matching-eyebrow">BenimPOS · Ana ürün</p>
                <h3 id="masterDetailTitle">—</h3>
                <div class="master-detail-logo-row" id="masterDetailChannelRow" aria-label="Kanal durumu"></div>
              </div>
              <button type="button" class="matching-modal-close" id="masterDetailClose" aria-label="Kapat">×</button>
            </header>
            <div class="master-detail-body" id="masterDetailBody">
              <p class="matching-loading">Yükleniyor…</p>
            </div>
            <footer class="master-detail-foot pf-detail-foot">
              <div class="master-detail-action-trio" id="masterDetailTrio">
                <p class="master-detail-trio-q"><span>Sorun:</span> <strong id="masterDetailIssue">—</strong></p>
                <p class="master-detail-trio-q"><span>Öneri:</span> <strong id="masterDetailSuggestion">—</strong></p>
                <p class="master-detail-trio-q"><span>Şimdi:</span> <strong id="masterDetailNextStep">—</strong></p>
              </div>
              <button type="button" class="pf-btn-primary" id="masterDetailConfirmBtn">Onayla</button>
              <button type="button" class="pf-btn-secondary" id="masterDetailRejectBtn">Reddet</button>
              <button type="button" class="pf-btn-secondary" id="masterDetailPickBtn">Başka ürün seç</button>
              <button type="button" class="pf-btn-secondary" id="masterDetailEditBtn">Düzenle</button>
              <button type="button" class="pf-btn-ghost" id="masterDetailRuleBtn">Kural oluştur</button>
              <button type="button" class="pf-btn-ghost" id="masterDetailCloseBtn">Kapat</button>
            </footer>
          </div>
        </aside>
        <div class="master-detail-backdrop" id="masterDetailBackdrop" hidden></div>

        <div class="matching-modal-backdrop" id="masterEditModalBackdrop" hidden>
          <div class="matching-modal matching-modal--wide" role="dialog" aria-modal="true" aria-labelledby="masterEditModalTitle">
            <div class="matching-modal-head">
              <h3 id="masterEditModalTitle">Ana ürün düzenle</h3>
              <button type="button" class="matching-modal-close" id="masterEditModalClose">×</button>
            </div>
            <div class="matching-modal-body">
              <p id="masterEditMeta" class="muted">—</p>
              <div class="master-edit-grid">
                <label>Gramaj (g)
                  <input type="number" id="masterEditWeight" min="0" step="1" placeholder="Örn. 2000">
                </label>
                <label>Varyant anahtarı
                  <input type="text" id="masterEditVariant" placeholder="Örn. tavuk, kedi_yavru">
                </label>
              </div>
              <label class="master-edit-notes">Not (eşleştirme ipucu)
                <textarea id="masterEditNotes" rows="3" placeholder="Manuel eşleştirme notu…"></textarea>
              </label>
              <section class="master-edit-mappings" aria-label="Kanal eşleştirmeleri">
                <h4>Kanal eşleştirmeleri</h4>
                <div id="masterEditMappings" class="master-edit-mapping-list">—</div>
              </section>
              <div class="master-edit-actions">
                <button type="button" class="btn-brown" id="masterEditSaveBtn">Kaydet</button>
                <button type="button" class="btn-brown ghost" id="masterEditCancelBtn">İptal</button>
              </div>
            </div>
          </div>
        </div>

        <div class="matching-modal-backdrop" id="inboxBulkPreviewBackdrop" hidden>
          <div class="matching-modal matching-modal--wide" role="dialog" aria-modal="true" aria-labelledby="inboxBulkPreviewTitle">
            <div class="matching-modal-head">
              <h3 id="inboxBulkPreviewTitle">Toplu onay önizlemesi</h3>
              <button type="button" class="matching-modal-close" id="inboxBulkPreviewClose">×</button>
            </div>
            <div class="matching-modal-body" id="inboxBulkPreviewBody"></div>
            <div class="master-edit-actions">
              <button type="button" class="btn-brown" id="inboxBulkPreviewConfirm">Toplu onayla</button>
              <button type="button" class="btn-brown ghost" id="inboxBulkPreviewCancel">İptal</button>
            </div>
          </div>
        </div>

        <div class="matching-modal-backdrop" id="mapModalBackdrop" hidden>
          <div class="matching-modal" role="dialog" aria-modal="true">
            <div class="matching-modal-head">
              <h3>Manuel Eşleştir</h3>
              <button type="button" class="matching-modal-close" id="mapModalClose">×</button>
            </div>
            <div class="matching-modal-body">
              <p id="mapModalChannelInfo" class="muted"></p>
              <div id="mapModalSuggestion" class="map-modal-suggestion" hidden></div>
              <label>Ana ürün ara (barkod veya ad)</label>
              <input type="search" id="mapMasterSearch" placeholder="Royal Canin, 318255…">
              <div id="mapMasterResults" class="map-master-results"></div>
            </div>
          </div>
        </div>

        <div class="matching-toast" id="matchingToast" role="status"></div>
        <script id="bootstrap" type="application/json">${bootstrap}</script>`;

    return renderPetfixShell({
      title: 'Ana Ürün Havuzu',
      activeModule: 'products',
      activeItem,
      auth,
      bodyHtml: innerHtml,
      bodyClass: 'matching-center-page pf-product-pool',
      bootstrapVar: '__PANEL__',
      bootstrapData: {
        authRequired: Boolean(auth.isEnabled()),
        salesChannels,
        defaultTab,
        focus
      },
      topbarActionsHtml: '<a href="/products/inbox" class="pf-btn pf-btn-ghost-sm">Gelen Kutusu</a><button type="button" class="pf-btn-primary" id="masterExportTopBtn">Dışa Aktar</button>',
      stylesheets: [
        '/assets/styles.css?v=corp1',
        '/assets/matching-center.css?v=82'
      ],
      scripts: [
        '/assets/matching-master-table.js?v=3',
        '/assets/matching-center.js?v=81',
        '/assets/matching-pool-ui.js?v=72',
        '/assets/matching-inbox-ui.js?v=73'
      ]
    });
  }

  return {
    renderGeneralDashboard,
    renderSettingsPage,
    renderGetirPage,
    renderUberEatsPage,
    renderYemeksepetiPage,
    renderWooCommercePage,
    renderMatchingCenterPage
  };
}
