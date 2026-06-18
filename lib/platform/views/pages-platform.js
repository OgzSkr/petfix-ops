import { jsonForHtml } from './format.js';
import { renderChannelOrdersPage } from './nav.js';
import { renderPetfixShell } from '../../panel/shell/petfix-shell.js';
import { wrapPanelPage } from '../../panel/shell/wrap-panel-page.js';
import { renderChannelLogo } from '../../panel/components/channel-logos.js';
import { resolveMatchingModeForChannel } from '../../product-matching/resolve.js';

export function createPlatformPages(auth, runtimeConfig = {}) {
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
        <p class="pf-module-banner">Hızlı teslimat kanalları (Getir, Yemeksepeti, Trendyol Go) için <a href="/hzlmrktops/integrations">Kanal Entegrasyonları</a> sayfasını kullanın. Bu ekran Trendyol Pazaryeri, WooCommerce ve worker ayarları içindir.</p>
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
            <p class="muted">OAuth token otomatik alınır (~2 saat). Katalog: <a href="/hzlmrktops/urunler">Ürünler</a> · Siparişler: <a href="/hzlmrktops/siparisler">Siparişler</a>.</p>
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
                <p class="muted">Değerleri <code>buybox-platform/.env</code> dosyasına ekleyin. Ürün maliyetleri BenimPOS master havuzundan ve eşleştirmeden gelir.</p>
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
  function renderBenimposProductsPage() {
    const activeItem = 'products';
    const bootstrap = jsonForHtml({
      authRequired: Boolean(auth.isEnabled()),
      productLine: 'hzlmrktops'
    });

    const channelHeadCells = ['getir', 'uber-eats', 'yemeksepeti'].map((channelId) => {
      const logo = renderChannelLogo(channelId, { size: 'sm' });
      return `<th class="bp-col-channel" scope="col"><div class="bp-channel-head">${logo}</div></th>`;
    }).join('');

    const innerHtml = `
        <div class="bp-shell">
          <div class="bp-topbar">
            <div>
              <h1>Kanal Fiyat &amp; Stok Yönetimi</h1>
              <p class="bp-topbar-lead">BenimPOS ana ürün listesi ve kanal eşleştirme merkezi. Fiyat/stok gönderimi yalnızca siz onayladığınızda çalışır; «Ürün Eşleştirme» sekmesinden kanal ürünlerini BenimPOS havuzuna bağlayın.</p>
            </div>
            <div class="bp-top-actions">
              <button type="button" class="bp-btn" id="bpSyncMasterBtn">BenimPOS Sync</button>
              <button type="button" class="bp-btn" id="bpSyncYsBtn">YS Katalog</button>
              <button type="button" class="bp-btn" id="bpSyncTgoBtn">TGO Katalog</button>
              <button type="button" class="bp-btn" id="bpSyncGetirBtn">Getir Katalog</button>
            </div>
          </div>

          <nav class="bp-view-tabs" aria-label="Liste görünümü">
            <button type="button" class="bp-view-tab is-active" data-view="masters" id="bpViewMasters">BenimPOS ürünleri</button>
            <button type="button" class="bp-view-tab" data-view="matching" id="bpViewMatching">Ürün Eşleştirme</button>
          </nav>

          <div class="bp-matching-toolbar" id="bpMatchingToolbar" hidden>
            <p class="bp-matching-toolbar-hint">Barkod eşleşmesi yapar; güven skoru <strong>%95+</strong> (barkod eşleşmesinde isim farkı tolere edilir) ürünleri otomatik onaylar.</p>
            <button type="button" class="bp-btn bp-btn-primary" id="bpAutoMatchBtn">Otomatik Eşleştir</button>
          </div>

          <section class="bp-filter-card">
            <div class="bp-search-wrap">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3-3"/></svg>
              <input type="search" id="bpSearch" class="bp-search" placeholder="Ürün adı, barkod ara" autocomplete="off" aria-label="Ara">
            </div>
            <select id="bpFilterBrand" class="bp-select" aria-label="Marka filtresi">
              <option value="">Marka: Tümü</option>
            </select>
            <select id="bpFilterChannel" class="bp-select" aria-label="Kanal filtresi">
              <option value="">Kanal: Tümü</option>
              <option value="uber-eats">Trendyol GO</option>
              <option value="yemeksepeti">Yemeksepeti</option>
              <option value="getir">Getir</option>
            </select>
            <select id="bpFilterChannelSale" class="bp-select" aria-label="Kanal satış filtresi" disabled>
              <option value="">Kanal durumu</option>
              <option value="on">Satışta</option>
              <option value="off">Satışta değil</option>
              <option value="missing">Kanalda yok</option>
            </select>
            <select id="bpFilterMatchStatus" class="bp-select" aria-label="Eşleşme durumu filtresi" hidden>
              <option value="">Durum: Tümü</option>
              <option value="unmapped">Eşleşmemiş</option>
              <option value="missing_master">BenimPOS&apos;ta yok</option>
              <option value="auto_matched">Otomatik öneri</option>
              <option value="pending">Onay bekliyor</option>
              <option value="review_required">İnceleme gerekli</option>
              <option value="barcode_conflict">Çoklu aday</option>
            </select>
            <select id="bpFilterConfirmable" class="bp-select" aria-label="Onaylanabilir filtre" hidden>
              <option value="">Tüm kayıtlar</option>
              <option value="1">Yalnızca onaylanabilir</option>
            </select>
            <select id="bpFilterStatus" class="bp-select" aria-label="Senkron durumu filtresi">
              <option value="">Senkron: Tümü</option>
              <option value="ready">Hazır</option>
              <option value="diff">Fark Var</option>
              <option value="no-stock">Stok Yok</option>
              <option value="waiting">Bekliyor</option>
            </select>
            <select id="bpFilterStock" class="bp-select" aria-label="POS stok filtresi">
              <option value="">POS stok</option>
              <option value="in">Stokta</option>
              <option value="out">Stok yok</option>
            </select>
            <div class="bp-filter-actions">
              <button type="button" class="bp-btn bp-btn-ghost" id="bpClearFilters">Temizle</button>
              <button type="button" class="bp-btn bp-btn-primary" id="bpApplyFilters">Filtrele</button>
              <button type="button" class="bp-btn" id="bpExportBtn">Excel Al</button>
            </div>
          </section>
          <p class="bp-filter-summary" id="bpFilterSummary" aria-live="polite"></p>

          <section class="bp-table-card">
            <div class="bp-table-scroll">
              <table class="bp-table">
                <thead>
                  <tr>
                    <th class="bp-col-check" scope="col"><input type="checkbox" id="bpSelectAll" aria-label="Tümünü seç"></th>
                    <th class="bp-col-product" scope="col">Ürün</th>
                    <th scope="col">Barkod</th>
                    <th scope="col">BenimPOS Stok</th>
                    <th scope="col">POS Satış</th>
                    ${channelHeadCells}
                    <th class="bp-col-status" scope="col">Durum</th>
                  </tr>
                </thead>
                <tbody id="bpBody">
                  <tr><td colspan="9" class="bp-loading">Yükleniyor…</td></tr>
                </tbody>
              </table>
            </div>
            <footer class="bp-footer">
              <span class="bp-footer-meta" id="bpTotalMeta">—</span>
              <div class="bp-pagination" id="bpPagination"></div>
              <select id="bpPageSize" class="bp-select" aria-label="Sayfa boyutu">
                <option value="20" selected>20 / sayfa</option>
                <option value="50">50 / sayfa</option>
                <option value="100">100 / sayfa</option>
              </select>
            </footer>
          </section>

          <p class="bp-status-line" id="bpStatus" aria-live="polite"></p>

          <div class="bp-modal-overlay" id="bpModalOverlay" hidden aria-hidden="true">
            <div class="bp-modal" role="dialog" aria-modal="true" aria-labelledby="bpModalTitle">
              <h2 class="bp-modal-title" id="bpModalTitle"></h2>
              <p class="bp-modal-lead" id="bpModalLead"></p>
              <div class="bp-modal-body" id="bpModalBody"></div>
              <div class="bp-modal-actions">
                <button type="button" class="bp-btn bp-btn-ghost" id="bpModalCancel">İptal</button>
                <button type="button" class="bp-btn bp-btn-primary" id="bpModalConfirm">Gönder</button>
              </div>
            </div>
          </div>
        </div>
        <script id="bootstrap" type="application/json">${bootstrap}</script>`;

    return renderPetfixShell({
      title: 'HzlMrktOps — Kanal Fiyat & Stok',
      activeModule: 'hzlmrktops',
      activeItem,
      auth,
      bodyHtml: innerHtml,
      bodyClass: 'benimpos-products-page',
      bootstrapVar: '__PANEL__',
      bootstrapData: {
        authRequired: Boolean(auth.isEnabled()),
        productLine: 'hzlmrktops'
      },
      stylesheets: [
        '/assets/styles.css?v=corp2',
        '/assets/panel-components.css?v=corp2',
        '/assets/benimpos-products.css?v=12'
      ],
      scripts: [
        '/assets/channel-logos.js?v=2',
        '/assets/benimpos-products.js?v=21'
      ]
    });
  }

  return {
    renderSettingsPage,
    renderWooCommercePage,
    renderBenimposProductsPage
  };
}
