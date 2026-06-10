export function renderCatalogPanelHtml() {
  return `
    <section class="catalog-page-panel" id="catalogPanel">
      <section class="ops-summary-strip ops-summary-strip--catalog" id="catalogSummaryStrip" aria-live="polite">
        <div class="ops-summary-item"><span>Takip edilen</span><strong id="catalogMetricTracked">—</strong></div>
        <div class="ops-summary-item ops-summary-item--ok"><span>Kârlı</span><strong id="catalogMetricProfitable">—</strong></div>
        <div class="ops-summary-item ops-summary-item--danger"><span>Zarar</span><strong id="catalogMetricLoss">—</strong></div>
        <div class="ops-summary-item ops-summary-item--warn"><span>Eksik veri</span><strong id="catalogMetricMissing">—</strong></div>
        <div class="ops-summary-item"><span>Toplam net kâr</span><strong id="catalogMetricTotalProfit">—</strong></div>
        <div class="ops-summary-item" id="catalogMetricLive"><span>Canlı BuyBox</span><strong id="catalogMetricLiveLabel">—</strong></div>
      </section>

      <div class="catalog-card">
        <div class="catalog-panel-head">
          <div class="catalog-tabs" role="tablist" aria-label="Katalog filtre">
            <button type="button" class="catalog-tab active" data-catalog-view="all">Tümü</button>
            <button type="button" class="catalog-tab" data-catalog-view="loss">Zarar</button>
            <button type="button" class="catalog-tab" data-catalog-view="missing">Eksik Veri</button>
            <button type="button" class="catalog-tab" data-catalog-view="profit">Kârlı</button>
          </div>
          <div class="catalog-toolbar">
            <input id="catalogSearch" type="search" placeholder="Barkod, marka veya ürün ara" aria-label="Ürün ara">
            <button type="button" class="tariff-btn-filter tariff-btn-filter--sm" id="catalogSyncBtn">Cache Senkron</button>
          </div>
        </div>

        <div class="catalog-filters" id="catalogFilters">
          <label class="catalog-filter">
            <span>Marka</span>
            <select id="catalogFilterBrand" aria-label="Marka filtresi">
              <option value="">Tüm markalar</option>
            </select>
          </label>
          <label class="catalog-filter">
            <span>BuyBox sırası</span>
            <select id="catalogFilterRank" aria-label="BuyBox sırası filtresi">
              <option value="">Tümü</option>
              <option value="1">1. sıra</option>
              <option value="2-3">2–3. sıra</option>
              <option value="4+">4+ sıra</option>
            </select>
          </label>
          <label class="catalog-filter">
            <span>Sırala</span>
            <select id="catalogSortBy" aria-label="Sıralama">
              <option value="netProfit">Net kâr (düşükten yükseğe)</option>
              <option value="netProfitDesc">Net kâr (yüksekten düşüğe)</option>
              <option value="buyboxOrder">BuyBox sırası</option>
              <option value="buyboxPrice">BuyBox fiyatı</option>
              <option value="updatedAt">Son veri</option>
              <option value="title">Ürün adı</option>
            </select>
          </label>
          <label class="catalog-filter catalog-filter--check">
            <input type="checkbox" id="catalogFilterMissingCost">
            <span>Maliyetsiz ürünler</span>
          </label>
          <label class="catalog-filter catalog-filter--check">
            <input type="checkbox" id="catalogFilterWithBuybox">
            <span>Yalnız BuyBox fiyatı olanlar</span>
          </label>
          <button type="button" class="tariff-btn-clear" id="catalogClearFilters">Filtreleri temizle</button>
        </div>

        <div class="catalog-list-meta" id="catalogListMeta">
          <div class="catalog-row-count" id="catalogRowCount"></div>
          <div class="catalog-pagination" id="catalogPagination">
            <label class="catalog-page-size">
              <span>Sayfa başına</span>
              <select id="catalogPageSize" aria-label="Sayfa başına kayıt">
                <option value="10" selected>10</option>
                <option value="25">25</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
            </label>
            <div class="catalog-page-nav" id="catalogPageNav" aria-label="Sayfa gezinme"></div>
          </div>
        </div>

        <div class="catalog-cards" id="catalogCards" aria-live="polite"></div>
        <div class="catalog-table-wrap" id="catalogTableWrap">
          <table class="catalog-table">
            <thead>
              <tr>
                <th class="col-product">Ürün</th>
                <th>BuyBox</th>
                <th>Maliyet</th>
                <th>Desi</th>
                <th>Komisyon</th>
                <th>Net Kâr</th>
                <th>Kâr %</th>
                <th>Durum</th>
                <th class="col-detail">Detay</th>
                <th class="col-actions">Aksiyon</th>
              </tr>
            </thead>
            <tbody id="catalogRows"></tbody>
          </table>
        </div>
      </div>
    </section>`;
}

export function renderWorkspaceStatusHtml() {
  return `
    <div class="workspace-status-strip" id="workspaceStatusStrip" aria-live="polite">
      <span class="workspace-status-item" id="workspaceStatusLive">Canlı BuyBox: …</span>
      <span class="workspace-status-item" id="workspaceStatusTrack">Takip listesi: …</span>
      <span class="workspace-status-item" id="workspaceStatusCache">Cache: …</span>
      <a href="/admin/settings" class="workspace-status-link">API / Worker ayarları →</a>
    </div>`;
}

export function renderTrackPanelHtml() {
  return `
    <section class="track-page-panel" id="trackPanel">
      <div class="track-worker-bar" id="trackWorkerBar">
        <div class="track-worker-copy">
          <strong id="trackWorkerTitle">Worker durumu yükleniyor…</strong>
          <p id="trackWorkerHint" class="track-worker-hint"></p>
        </div>
        <div class="track-worker-actions">
          <button type="button" class="tariff-btn-filter tariff-btn-filter--sm" id="trackStartWorkerBtn" hidden>Worker Başlat</button>
          <button type="button" class="tariff-btn-clear" id="trackRefreshStatusBtn">Durumu Yenile</button>
        </div>
      </div>
      <div class="track-card-shell">
        <div class="track-intro">
          <p>Worker yalnızca bu listedeki barkodları canlı sorgular. Tarife ve katalog tablolarındaki <strong>Takibe Al</strong> ile de ekleyebilirsiniz.</p>
          <p class="track-intro-hint">Canlı BuyBox API kurulumu için <a href="/admin/settings">Ayarlar / API Bilgileri</a> sayfasını kullanın.</p>
        </div>
        <form class="track-form" id="trackForm">
          <label class="track-field">
            <span>Barkod</span>
            <input id="trackBarcodeInput" autocomplete="off" placeholder="Barkod">
          </label>
          <label class="track-field">
            <span>Öncelik</span>
            <select id="trackPriorityInput">
              <option value="critical">Kritik</option>
              <option value="normal" selected>Normal</option>
              <option value="low">Düşük</option>
            </select>
          </label>
          <div class="track-form-actions">
            <button type="submit" class="tariff-btn-filter">Takibe Al</button>
            <button type="button" class="tariff-btn-clear" id="trackRemoveBtn">Çıkar</button>
          </div>
          <p class="track-form-status" id="trackFormStatus"></p>
        </form>
        <div class="track-list" id="trackList">
          <p class="track-loading">Takip listesi yükleniyor…</p>
        </div>
      </div>
    </section>`;
}

export function renderTariffViewSwitchHtml() {
  return `
    <nav class="tariff-view-switch" aria-label="Çalışma alanı">
      <button type="button" class="tariff-view-btn is-active" data-workspace-view="tariff">Tarife Ürünleri</button>
      <button type="button" class="tariff-view-btn" data-workspace-view="catalog">Tüm Katalog</button>
      <button type="button" class="tariff-view-btn" data-workspace-view="track">Takip Listesi</button>
    </nav>`;
}
