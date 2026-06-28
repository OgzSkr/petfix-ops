import { jsonForHtml } from './format.js';
import { renderPetfixShell } from '../../panel/shell/petfix-shell.js';
import { wrapPanelPage } from '../../panel/shell/wrap-panel-page.js';
import { renderChannelLogo } from '../../panel/components/channel-logos.js';
import { renderOpsInfoDisclosure } from '../../ops-hub/views/info-disclosure.js';
import { renderOpsCompactBar } from '../../ops-hub/views/compact-page-bar.js';

export function createPlatformPages(auth, runtimeConfig = {}) {
  function renderSettingsPage() {
    const bootstrap = jsonForHtml({ authRequired: Boolean(auth.isEnabled()) });

    const innerHtml = `
        <header class="pf-page-header">
          <div>
            <p class="pf-page-eyebrow">Yönetim</p>
            <h1>Sistem Ayarları</h1>
            <p class="pf-page-lead">Günlük operasyon tercihleri ve BenimPOS bağlantısı. Kanal API bilgileri için <a href="/hzlmrktops/integrations">Kanal Entegrasyonları</a> sayfasını kullanın.</p>
          </div>
        </header>
        <main class="platform-main settings-main pf-admin-settings">
          <details class="settings-accordion panel" open>
            <summary class="settings-accordion-summary">
              <span class="settings-accordion-title">Operasyon</span>
              <span class="settings-accordion-hint">Kasa, sipariş ve yazma davranışları</span>
            </summary>
            <div class="settings-accordion-body">
              <p class="platform-lead">Günlük iş akışınızı belirleyen anahtarlar. Canlı ortamda tüm kanal ve kasa yazmaları gerçektir.</p>
              <p class="settings-group-label">Kasa (BenimPOS)</p>
              <div class="settings-toggle-list">
                <label class="settings-toggle-row">
                  <span class="settings-toggle-copy">
                    <strong>Toplama bitince otomatik BenimPOS satışı</strong>
                    <span class="muted">Sipariş toplandığında kasa fişini sizin yerinize oluşturur. Kapalıyken toplama ekranından elle gönderirsiniz. Eşleşmeyen ürün varsa fiş atlanır.</span>
                  </span>
                  <input type="checkbox" id="prefBenimposAutoSale">
                </label>
              </div>
              <p class="settings-group-label">Stok (BenimPOS → kanallar)</p>
              <div class="settings-toggle-list">
                <label class="settings-toggle-row">
                  <span class="settings-toggle-copy">
                    <strong>BenimPOS stokunu kanallara otomatik gönder</strong>
                    <span class="muted">BenimPOS'taki stok değişince eşleşmiş ürünlerin stokları Getir, Yemeksepeti ve Trendyol GO menüsüne otomatik yansır. Hariç tutmak istediğiniz ürünleri Ürünler sayfasındaki sütundan kapatabilirsiniz.</span>
                  </span>
                  <input type="checkbox" id="prefStockAutoSync">
                </label>
                <label class="settings-toggle-row">
                  <span class="settings-toggle-copy">
                    <strong>Kanallara stok yazmaya izin ver</strong>
                    <span class="muted">Kapalıyken stok gönderimi yalnızca simüle edilir — kanallarda değişiklik olmaz. Otomatik gönderim için bunun da açık olması gerekir.</span>
                  </span>
                  <input type="checkbox" id="prefStockPush">
                </label>
              </div>
              <p class="settings-group-label">Kanallar — siparişler</p>
              <div class="settings-toggle-list">
                <label class="settings-toggle-row">
                  <span class="settings-toggle-copy">
                    <strong>Kanallara sipariş durumu bildir</strong>
                    <span class="muted">Siparişi <em>kabul ettiğinizde</em> veya <em>hazır</em> dediğinizde ilgili uygulamaya bildirim gider. Kapalıyken durum yalnızca panelde güncellenir.</span>
                  </span>
                  <input type="checkbox" id="prefChannelStatusWrite">
                </label>
                <label class="settings-toggle-row">
                  <span class="settings-toggle-copy">
                    <strong>Otomatik sipariş çekme</strong>
                    <span class="muted">Yeni siparişleri arka planda periyodik olarak panelde listeler.</span>
                  </span>
                  <input type="checkbox" id="prefPollEnabled">
                </label>
              </div>
              <p class="settings-effective muted" id="prefEffectiveHint" hidden></p>
              <div class="settings-actions">
                <button type="button" id="saveOpsPreferences">Operasyon ayarlarını kaydet</button>
              </div>
              <p class="muted" id="opsPreferencesStatus"></p>
            </div>
          </details>

          <details class="settings-accordion panel">
            <summary class="settings-accordion-summary">
              <span class="settings-accordion-title">BenimPOS Bağlantısı</span>
              <span class="settings-accordion-hint">API anahtarları ve maliyet senkronu</span>
            </summary>
            <div class="settings-accordion-body">
              <p class="platform-lead">Stok ve alış fiyatı kaynağı. Panel yalnızca <strong>veri okur</strong>; BenimPOS'ta ürün, stok veya fiyat değiştirilmez.</p>
              <p class="muted">Secret alanları boş görünür — değiştirmek için yeni değer girip Kaydet'e basın.</p>
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
              <p class="muted">Alış fiyatları yalnızca panelde boş kalan maliyet alanlarına yazılır. Manuel girilmiş maliyetler korunur.</p>
              <p class="muted" id="benimposSettingsStatus"></p>
            </div>
          </details>

          <details class="settings-accordion panel">
            <summary class="settings-accordion-summary">
              <span class="settings-accordion-title">Kanallar</span>
              <span class="settings-accordion-hint">Getir, Yemeksepeti, Trendyol GO</span>
            </summary>
            <div class="settings-accordion-body">
              <p class="platform-lead">Kanal API anahtarları, webhook adresleri ve bağlantı testleri artık tek yerde yönetiliyor.</p>
              <div class="settings-actions">
                <a class="button secondary" href="/hzlmrktops/integrations">Kanal Entegrasyonlarına git</a>
                <a class="button ghost" href="/hzlmrktops/sistem">Sistem Nabzı</a>
              </div>
              <ul class="settings-channel-list">
                <li>Getir, Yemeksepeti ve Trendyol GO bağlantı bilgileri</li>
                <li>Otomatik sipariş çekme aralığı ve manuel tetikleme</li>
                <li>Ürün eşleştirme senkronu</li>
              </ul>
            </div>
          </details>
        </main>
        <script id="bootstrap" type="application/json">${bootstrap}</script>`;

    return wrapPanelPage({
      title: 'Sistem Ayarları',
      activeModule: 'admin',
      activeItem: 'settings',
      auth,
      bodyClass: 'pf-admin-page',
      bodyHtml: innerHtml,
      stylesheets: ['/assets/ops-components.css', '/assets/styles.css?v=corp3'],
      scripts: ['/assets/settings.js?v=8']
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

    const productsInfoBlocks = [
      renderOpsInfoDisclosure({
        id: 'bpInfoPurpose',
        title: 'Bu sayfada ne yaparsınız?',
        paragraphs: [
          'BenimPOS ürünlerinizi kanallardaki menülerle eşleştirir, fiyat ve stok farklarını görürsünüz.',
          '<strong>Alış (maliyet)</strong> sütunu BenimPOS sync ile gelir; sipariş kârlılık raporu bu değeri kullanır (canlı API çağrısı yok).',
          'Kanallara fiyat ve stok gönderimi <strong>yalnızca siz butona bastığınızda</strong> çalışır; otomatik gönderim yapılmaz.'
        ]
      }),
      renderOpsInfoDisclosure({
        id: 'bpInfoSync',
        title: 'Otomatik katalog yenileme',
        paragraphs: [
          '<span id="bpSyncScheduleLine">Zamanlanmış senkron bilgisi yükleniyor…</span>',
          'Üstteki «Ürün listesini yenile» ve kanal menü butonları anında manuel indirme yapar. Otomatik döngü ayrıca arka planda çalışabilir.'
        ]
      })
    ].join('');

    const productsBar = renderOpsCompactBar({
      mainHtml: `
          <nav class="bp-view-tabs bp-view-tabs--bar" aria-label="Liste görünümü">
            <button type="button" class="bp-view-tab is-active" data-view="masters" id="bpViewMasters">Ana ürün listesi</button>
            <button type="button" class="bp-view-tab" data-view="matching" id="bpViewMatching">Kanal eşleştirme</button>
          </nav>`,
      sideHtml: `
          <div class="bp-top-actions">
            <span class="bp-top-actions-label">Listeleri güncelle</span>
            <button type="button" class="bp-btn" id="bpSyncMasterBtn" title="BenimPOS kasasındaki ürün listesini indirir">Ürün listesini yenile</button>
            <button type="button" class="bp-btn" id="bpSyncYsBtn" title="Yemeksepeti mağaza menüsünü indirir">Yemeksepeti menüsü</button>
            <button type="button" class="bp-btn" id="bpSyncTgoBtn" title="Trendyol GO mağaza menüsünü indirir">Trendyol GO menüsü</button>
            <button type="button" class="bp-btn" id="bpSyncGetirBtn" title="Getir mağaza menüsünü indirir">Getir menüsü</button>
          </div>
          <div class="bp-info-stack">${productsInfoBlocks}</div>`,
      className: 'bp-topbar'
    });

    const innerHtml = `
        <div class="bp-shell ops-compact-page">
          <section class="ops-panel ops-compact-page-panel bp-main-panel">
            ${productsBar}

          <section class="bp-cleanup-banner" id="bpCleanupBanner" hidden aria-live="polite">
            <div class="bp-cleanup-banner-head">
              <div>
                <strong class="bp-cleanup-banner-title">Temizlik önerileri</strong>
                <p class="bp-cleanup-banner-lead" id="bpCleanupLead">Kasa veya kanal menüsünden silinen ürünler için geçersiz eşleştirmeler.</p>
              </div>
              <div class="bp-cleanup-banner-actions">
                <button type="button" class="bp-btn bp-btn-ghost" id="bpCleanupDismissAllBtn">Tümünü yoksay</button>
                <button type="button" class="bp-btn bp-btn-danger" id="bpCleanupApplyAllBtn">Tüm eşleştirmeleri kaldır</button>
              </div>
            </div>
            <ul class="bp-cleanup-list" id="bpCleanupList"></ul>
          </section>

          <div class="bp-matching-toolbar" id="bpMatchingToolbar" hidden>
            <p class="bp-matching-toolbar-hint" id="bpMatchingToolbarHint">Barkod eşleşmesi yapar; güven skoru <strong>%95+</strong> (barkod eşleşmesinde isim farkı tolere edilir) ürünleri otomatik onaylar.</p>
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
              <option value="action">Onay bekleyenler</option>
              <option value="confirmed">Onaylı eşleşmeler</option>
              <option value="unmapped">Eşleşmemiş</option>
              <option value="missing_master">Ana listede yok</option>
              <option value="auto_matched">Otomatik öneri</option>
              <option value="pending">Onay bekliyor</option>
              <option value="review_required">İnceleme gerekli</option>
              <option value="barcode_conflict">Çoklu aday</option>
            </select>
            <select id="bpFilterConfirmable" class="bp-select" aria-label="Onaylanabilir filtre" hidden>
              <option value="">Tüm kayıtlar</option>
              <option value="1">Yalnızca onaylanabilir</option>
            </select>
            <select id="bpFilterStatus" class="bp-select" aria-label="Güncelleme durumu filtresi">
              <option value="">Güncelleme: Tümü</option>
              <option value="ready">Hazır</option>
              <option value="diff">Fark Var</option>
              <option value="no-stock">Stok Yok</option>
              <option value="waiting">Bekliyor</option>
            </select>
            <select id="bpFilterStock" class="bp-select" aria-label="Kasa stok filtresi">
              <option value="">Kasa stoku</option>
              <option value="in">Stokta</option>
              <option value="out">Stok yok</option>
            </select>
            <select id="bpFilterSort" class="bp-select" aria-label="Sıralama">
              <option value="name:asc">Ada göre (A→Z)</option>
              <option value="name:desc">Ada göre (Z→A)</option>
              <option value="priceDiff:desc">Fiyat farkı (yüksek→düşük)</option>
              <option value="priceDiff:asc">Fiyat farkı (düşük→yüksek)</option>
              <option value="maxPriceDiff:desc">En büyük kanal farkı</option>
              <option value="stock:desc">Stok (çok→az)</option>
              <option value="stock:asc">Stok (az→çok)</option>
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
                    <th class="bp-col-product" scope="col">
                      <div class="bp-product-head">
                        <input type="checkbox" class="pf-checkbox" id="bpSelectAll" aria-label="Tümünü seç" disabled>
                        <span>Ürün Bilgisi</span>
                      </div>
                    </th>
                    <th scope="col">Kasa satış</th>
                    ${channelHeadCells}
                  </tr>
                </thead>
                <tbody id="bpBody">
                  <tr><td colspan="5" class="bp-loading">Yükleniyor…</td></tr>
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

          <div class="bp-sync-progress" id="bpSyncProgress" hidden aria-live="polite">
            <div class="bp-sync-progress-head">
              <span class="bp-sync-progress-label" id="bpSyncProgressLabel">Güncelleniyor</span>
              <span class="bp-sync-progress-pct" id="bpSyncProgressPct">0%</span>
            </div>
            <div class="bp-sync-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" id="bpSyncProgressTrack">
              <div class="bp-sync-progress-bar" id="bpSyncProgressBar" style="width:0%"></div>
            </div>
            <p class="bp-sync-progress-detail" id="bpSyncProgressDetail"></p>
          </div>

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
          </section>
        </div>
        <script id="bootstrap" type="application/json">${bootstrap}</script>`;

    return renderPetfixShell({
      title: 'Ürünler',
      activeModule: 'hzlmrktops',
      activeItem,
      auth,
      bodyHtml: innerHtml,
      bodyClass: 'benimpos-products-page pf-unified-page',
      bootstrapVar: '__PANEL__',
      bootstrapData: {
        authRequired: Boolean(auth.isEnabled()),
        productLine: 'hzlmrktops'
      },
      stylesheets: [
        '/assets/styles.css?v=corp2',
        '/assets/panel-components.css?v=corp2',
        '/assets/ops-components.css?v=corp2',
        '/assets/benimpos-products.css?v=23'
      ],
      scripts: [
        '/assets/channel-logos.js?v=2',
        '/assets/benimpos-products.js?v=38'
      ]
    });
  }

  return {
    renderSettingsPage,
    renderBenimposProductsPage
  };
}
