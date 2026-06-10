export function renderTariffPanelHtml() {
  return `
    <section class="tariff-page-panel" id="tariffPanel">
      <header class="tariff-hero">
        <div class="tariff-hero-copy">
          <span class="tariff-hero-label">Geçerli Tarih Aralığı</span>
          <p class="tariff-date-range" id="tariffDateRange">Henüz tarife yüklenmedi</p>
          <p class="tariff-hero-hint">Tarife kademeleri, BuyBox takibi ve Trendyol fiyat gönderimi bu ekrandan yönetilir.</p>
        </div>
        <button type="button" class="tariff-upload-btn" id="tariffToggleImportBtn">
          Komisyon Tarifesi Excel Dosyası Yükle
        </button>
      </header>

      <div id="tariffImportPanel" class="tariff-card tariff-import-panel" hidden>
        <p class="tariff-import-hint">Promosyon &amp; Fiyat → Ürün Komisyon Tarifeleri → Excel ile güncelle → Excel oluştur</p>
        <form id="tariffImportForm" class="tariff-form">
          <label class="tariff-field">
            <span>Geçerlilik başlangıcı</span>
            <input type="datetime-local" id="tariffValidFrom" required>
          </label>
          <label class="tariff-field">
            <span>Geçerlilik bitişi</span>
            <input type="datetime-local" id="tariffValidTo" required>
          </label>
          <label class="tariff-field tariff-field--file">
            <span>Excel dosyası</span>
            <input type="file" id="tariffFile" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required>
          </label>
          <div class="tariff-actions">
            <button type="submit" class="tariff-btn-filter" id="importTariffBtn">Tarifeyi Yükle</button>
          </div>
          <p class="tariff-form-status" id="tariffImportStatus"></p>
        </form>
      </div>

      <div id="tariffEmptyState" class="tariff-card tariff-empty">
        <div class="tariff-empty-icon" aria-hidden="true">📊</div>
        <h3>Komisyon tarifesi henüz yüklenmedi</h3>
        <p>Trendyol satıcı panelinden indirdiğiniz haftalık Excel dosyasını yükleyerek kârlılık analizine başlayın.</p>
        <button type="button" class="tariff-upload-btn" data-open-import="1">Excel Dosyası Yükle</button>
      </div>

      <div id="tariffAnalysisSection" class="tariff-analysis" hidden>
        <section class="ops-summary-strip ops-summary-strip--tariff" id="tariffSummaryStrip" aria-live="polite">
          <div class="ops-summary-item"><span>Tarife ürünü</span><strong id="tariffSummaryTotal">—</strong></div>
          <div class="ops-summary-item"><span>BuyBox olan</span><strong id="tariffSummaryWithBuybox">—</strong></div>
          <div class="ops-summary-item ops-summary-item--warn"><span>BuyBox eksik</span><strong id="tariffSummaryMissingBuybox">—</strong></div>
          <div class="ops-summary-item"><span>Kademe seçili</span><strong id="tariffSummarySelected">—</strong></div>
          <div class="ops-summary-item ops-summary-item--danger"><span>Zarar riski</span><strong id="tariffSummaryLossRisk">—</strong></div>
        </section>
        <div class="tariff-card tariff-filters-card">
          <form id="tariffFilters" class="tariff-filters-grid">
            <label class="tariff-filter-field">
              <span>Ürün adı</span>
              <input type="text" id="tariffFilterTitle" placeholder="Ürün adı">
            </label>
            <label class="tariff-filter-field">
              <span>Barkod</span>
              <input type="text" id="tariffFilterBarcode" placeholder="Barkod">
            </label>
            <label class="tariff-filter-field">
              <span>Model kodu</span>
              <input type="text" id="tariffFilterModel" placeholder="Model kodu">
            </label>
            <label class="tariff-filter-field">
              <span>Kategori</span>
              <select id="tariffFilterCategory"><option value="">Tümü</option></select>
            </label>
            <label class="tariff-filter-field">
              <span>Marka</span>
              <select id="tariffFilterBrand"><option value="">Tümü</option></select>
            </label>
            <label class="tariff-filter-field">
              <span>Kârlılık</span>
              <select id="tariffFilterProfit">
                <option value="all">Tümü</option>
                <option value="profit">Kârlı</option>
                <option value="loss">Zarar</option>
                <option value="missing">Eksik veri</option>
              </select>
            </label>
            <label class="tariff-filter-field">
              <span>BuyBox sırası</span>
              <select id="tariffFilterRank">
                <option value="">Tümü</option>
                <option value="1">1. sıra</option>
                <option value="2-3">2–3. sıra</option>
                <option value="4+">4+ sıra</option>
              </select>
            </label>
            <label class="tariff-filter-field">
              <span>Sırala</span>
              <select id="tariffSortBy">
                <option value="title">Ürün adı</option>
                <option value="stock">Stok</option>
                <option value="currentTsf">Güncel fiyat</option>
                <option value="buyboxOrder">BuyBox sırası</option>
                <option value="buyboxPrice">BuyBox fiyatı</option>
                <option value="buyboxNetProfit">Net kâr (BuyBox)</option>
                <option value="selectedTier">Seçili kademe</option>
              </select>
            </label>
            <label class="tariff-filter-field tariff-filter-field--narrow">
              <span>Sıra yönü</span>
              <select id="tariffSortDir">
                <option value="asc">Artan</option>
                <option value="desc">Azalan</option>
              </select>
            </label>
            <label class="tariff-filter-field tariff-filter-field--narrow">
              <span>Min stok</span>
              <input type="number" id="tariffFilterMinStock" min="0" step="1" placeholder="Min">
            </label>
            <label class="tariff-filter-field tariff-filter-field--narrow">
              <span>Max stok</span>
              <input type="number" id="tariffFilterMaxStock" min="0" step="1" placeholder="Max">
            </label>
            <label class="tariff-check-inline tariff-filter-field--check">
              <input type="checkbox" id="tariffFilterSelectedOnly">
              Yalnız seçilenler
            </label>
            <label class="tariff-check-inline tariff-filter-field--check">
              <input type="checkbox" id="tariffFilterMissingBuybox">
              Yalnız BuyBox eksik
            </label>
            <label class="tariff-check-inline tariff-filter-field--check">
              <input type="checkbox" id="tariffFilterWithBuybox">
              Yalnız BuyBox fiyatı olanlar
            </label>
            <label class="tariff-check-inline tariff-filter-field--check">
              <input type="checkbox" id="tariffFilterFetchableMissing">
              Çekilebilir BuyBox eksik
            </label>
            <label class="tariff-check-inline tariff-filter-field--check">
              <input type="checkbox" id="tariffFilterMissingUrl">
              Ürün linki eksik
            </label>
            <label class="tariff-check-inline tariff-filter-field--check">
              <input type="checkbox" id="tariffFilterMissingCost">
              Maliyetsiz ürünler
            </label>
            <label class="tariff-check-inline tariff-filter-field--check">
              <input type="checkbox" id="tariffFilterLossRisk">
              Zarar riski
            </label>
            <div class="tariff-filter-actions">
              <button type="button" class="tariff-btn-clear" id="tariffClearFiltersBtn">Filtreleri Temizle</button>
              <button type="submit" class="tariff-btn-filter">Filtrele</button>
            </div>
          </form>
        </div>

        <div class="tariff-card tariff-table-card">
          <div class="tariff-table-header">
            <h2 class="tariff-table-title">Ürün Komisyon Tarifesi Kârlılık Analizi</h2>
            <div class="tariff-table-header-tools tariff-desktop-only" id="tariffZoomControls">
              <button type="button" class="tariff-tool-btn" data-tariff-zoom="out" title="Küçült">A−</button>
              <span id="tariffZoomLabel">100%</span>
              <button type="button" class="tariff-tool-btn" data-tariff-zoom="in" title="Büyüt">A+</button>
            </div>
          </div>

          <div class="tariff-subtoolbar">
            <div class="tariff-subtoolbar-fields">
              <label class="tariff-inline-field">
                <span>Min. net kâr (₺)</span>
                <input type="number" id="tariffMinNetProfit" step="0.01" min="0" value="0">
              </label>
              <label class="tariff-inline-field">
                <span>Min. kâr (%)</span>
                <input type="number" id="tariffMinProfitRate" step="0.1" min="0" value="0">
              </label>
              <select id="tariffBulkPreset" class="tariff-bulk-select" aria-label="Toplu seçim">
                <option value="">Toplu Seçim</option>
                <option value="profitable">Kârlı olanları seç (4→3→2)</option>
                <option value="clear">Seçimleri temizle</option>
              </select>
              <button type="button" id="tariffBulkApplyBtn" class="tariff-btn-filter tariff-btn-filter--sm">Uygula</button>
              <button type="button" id="tariffRefreshMissingBtn" class="tariff-btn-filter tariff-btn-filter--sm">Eksik BuyBox Güncelle</button>
              <button type="button" id="tariffTrackMissingBtn" class="tariff-btn-filter tariff-btn-filter--sm">Eksikleri Takibe Al</button>
              <button type="button" id="tariffSyncCatalogBtn" class="tariff-btn-filter tariff-btn-filter--sm">Kataloğa Ekle</button>
            </div>
            <button type="button" id="tariffExportBtn" class="tariff-export-btn" hidden>Trendyol Excel İndir</button>
          </div>

          <div class="tariff-coverage-banner" id="tariffCoverageBanner" hidden></div>

          <p class="tariff-bulk-status" id="tariffBulkStatus"></p>

          <div class="tariff-desktop-only tariff-grid-wrap" id="tariffGridWrap">
            <table class="tariff-analysis-table" id="tariffAnalysisTable">
              <thead>
                <tr>
                  <th class="col-sticky col-variant">Varyantlar</th>
                  <th class="col-sticky col-product" data-sort="title">Ürün <span class="tariff-sort-icon">↕</span></th>
                  <th data-sort="stock">Stok <span class="tariff-sort-icon">↕</span></th>
                  <th data-sort="currentTsf">Güncel Fiyat (₺) <span class="tariff-sort-icon">↕</span></th>
                  <th class="col-buybox" data-sort="buyboxOrder">BuyBox <span class="tariff-sort-icon">↕</span></th>
                  <th class="col-buybox" data-sort="buyboxPrice">BuyBox Fiyat (₺) <span class="tariff-sort-icon">↕</span></th>
                  <th class="col-buybox" data-sort="buyboxNetProfit">Net Kâr (BuyBox) <span class="tariff-sort-icon">↕</span></th>
                  <th class="col-actions">Aksiyon</th>
                  <th>1. Fiyat Aralığı</th>
                  <th>2. Fiyat Aralığı</th>
                  <th>3. Fiyat Aralığı</th>
                  <th>4. Fiyat Aralığı</th>
                  <th>Manuel Fiyat Girişi</th>
                  <th>Trendyol</th>
                </tr>
              </thead>
              <tbody id="tariffAnalysisRows"></tbody>
            </table>
          </div>

          <div class="tariff-mobile-only tariff-mobile-list" id="tariffMobileList"></div>

          <footer class="tariff-table-footer">
            <span id="tariffRowCount" class="tariff-row-count">0 ürün</span>
            <div class="tariff-pagination" id="tariffPagination"></div>
          </footer>
        </div>
      </div>

      <div class="tariff-modal-backdrop" id="tariffProfitModalBackdrop" hidden>
        <div class="tariff-modal" role="dialog" aria-modal="true" aria-labelledby="tariffProfitModalTitle">
          <div class="tariff-modal-head">
            <h3 id="tariffProfitModalTitle">Kâr / Zarar Detayı</h3>
            <button type="button" class="tariff-modal-close" id="tariffProfitModalClose" aria-label="Kapat">×</button>
          </div>
          <div class="tariff-modal-body" id="tariffProfitModalBody"></div>
        </div>
      </div>
    </section>`;
}
