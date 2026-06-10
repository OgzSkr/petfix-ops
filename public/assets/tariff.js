'use strict';

const C = window.BuyBoxCommon;

let commissionTariffMeta = { active: false };
let TARIFF_ROWS = [];
let tariffCurrentPage = 1;
let tariffPageSize = 25;
let tariffZoomLevel = 100;
let tariffSortBy = 'title';
let tariffSortDir = 'asc';
let workspaceView = 'tariff';
let toastTimer;

const tariffAnalysisRowsEl = () => document.getElementById('tariffAnalysisRows');
const tariffMobileListEl = () => document.getElementById('tariffMobileList');
const tariffRowCountEl = () => document.getElementById('tariffRowCount');
const tariffPaginationEl = () => document.getElementById('tariffPagination');
const tariffBulkStatusEl = () => document.getElementById('tariffBulkStatus');
const tariffDateRangeEl = () => document.getElementById('tariffDateRange');
const tariffEmptyStateEl = () => document.getElementById('tariffEmptyState');
const tariffAnalysisSectionEl = () => document.getElementById('tariffAnalysisSection');
const tariffExportBtnEl = () => document.getElementById('tariffExportBtn');
const tariffImportStatusEl = () => document.getElementById('tariffImportStatus');

function initTariffPage(bootstrap) {
  if (bootstrap.authRequired && !C.getStoredToken()) {
    C.redirectToLogin();
    return;
  }

  tariffPageSize = window.matchMedia('(max-width: 768px)').matches ? 10 : 25;
  bindTariffUi();
  initTariffFormDefaults();
  applyTariffQueryParams();
  C.initPlatformNav?.();
  window.CatalogView?.init?.();
  window.TrackView?.init?.();
  applyWorkspaceViewFromQuery();
  bindWorkspaceViewSwitch();
  applyWorkspaceViewUi(false);

  document.getElementById('logoutBtn')?.addEventListener('click', () => C.logout());

  window.matchMedia('(max-width: 768px)').addEventListener('change', (event) => {
    tariffPageSize = event.matches ? 10 : 25;
    tariffCurrentPage = 1;
    if (workspaceView === 'tariff') renderTariffViews();
  });

  loadTariffMeta().then(() => {
    loadWorkspaceStatus();
    if (workspaceView === 'tariff') loadTariffAnalysis();
    else if (workspaceView === 'catalog') window.CatalogView?.ensureLoaded?.();
    else if (workspaceView === 'track') window.TrackView?.ensureLoaded?.();
  });

  setInterval(() => {
    loadWorkspaceStatus(true);
  }, 60000);
}

function applyWorkspaceViewFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const view = params.get('view');
  if (view === 'catalog' || view === 'track' || view === 'tariff') workspaceView = view;
}

function bindWorkspaceViewSwitch() {
  document.querySelectorAll('[data-workspace-view]').forEach((button) => {
    button.addEventListener('click', () => {
      setWorkspaceView(button.dataset.workspaceView || 'tariff');
    });
  });
}

function syncWorkspaceQueryParam() {
  const params = new URLSearchParams(window.location.search);
  if (workspaceView === 'tariff') {
    params.delete('view');
    params.delete('catalogTab');
  } else {
    params.set('view', workspaceView);
    if (workspaceView !== 'catalog') params.delete('catalogTab');
  }
  const qs = params.toString();
  history.replaceState(null, '', qs ? window.location.pathname + '?' + qs : window.location.pathname);
}

function applyWorkspaceViewUi(reload = true) {
  document.querySelectorAll('[data-workspace-view]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.workspaceView === workspaceView);
  });

  const tariffRoot = document.getElementById('tariffViewRoot');
  const catalogRoot = document.getElementById('catalogViewRoot');
  const trackRoot = document.getElementById('trackViewRoot');
  if (tariffRoot) tariffRoot.hidden = workspaceView !== 'tariff';
  if (catalogRoot) catalogRoot.hidden = workspaceView !== 'catalog';
  if (trackRoot) trackRoot.hidden = workspaceView !== 'track';

  syncWorkspaceQueryParam();

  if (!reload) return;
  if (workspaceView === 'catalog') window.CatalogView?.ensureLoaded?.();
  else if (workspaceView === 'track') window.TrackView?.ensureLoaded?.();
  else loadTariffAnalysis();
}

function setWorkspaceView(view) {
  workspaceView = view === 'catalog' ? 'catalog' : (view === 'track' ? 'track' : 'tariff');
  applyWorkspaceViewUi(true);
}

async function loadWorkspaceStatus(silent = false) {
  const liveEl = document.getElementById('workspaceStatusLive');
  const trackEl = document.getElementById('workspaceStatusTrack');
  const cacheEl = document.getElementById('workspaceStatusCache');
  if (!liveEl || !trackEl || !cacheEl) return;

  try {
    const [opsRes, trackRes] = await Promise.all([
      C.authFetch('/api/ops/status'),
      C.authFetch('/api/auto-track')
    ]);
    const ops = opsRes.ok ? await opsRes.json() : {};
    const trackPayload = trackRes.ok ? await trackRes.json() : {};

    const worker = ops.worker || {};
    const cache = ops.cache || {};
    let liveLabel = 'Canlı BuyBox: ';
    if (!worker.configured) {
      liveLabel += 'API eksik';
      liveEl.className = 'workspace-status-item is-danger';
    } else if (worker.live) {
      liveLabel += 'Aktif';
      liveEl.className = 'workspace-status-item is-ok';
    } else if (worker.running) {
      liveLabel += 'Worker çalışıyor, cache bekleniyor';
      liveEl.className = 'workspace-status-item is-warn';
    } else {
      liveLabel += 'Worker kapalı';
      liveEl.className = 'workspace-status-item is-warn';
    }
    liveEl.textContent = liveLabel;

    trackEl.textContent = 'Takip listesi: ' + String(trackPayload.total || 0) + ' ürün';
    trackEl.className = 'workspace-status-item';

    const cacheAge = cache.ageSeconds;
    cacheEl.textContent = cache.updatedAt
      ? 'Cache: ' + (cacheAge != null ? cacheAge + ' sn önce' : '—') + ' · ' + String(cache.itemCount || 0) + ' kayıt'
      : 'Cache: henüz yok';
    cacheEl.className = 'workspace-status-item' + (cache.live ? ' is-ok' : '');
  } catch {
    if (!silent) {
      liveEl.textContent = 'Canlı BuyBox: durum alınamadı';
      liveEl.className = 'workspace-status-item is-warn';
    }
  }
}

async function syncAfterTrackChange(message) {
  window.TrackView?.invalidate?.();
  window.CatalogView?.invalidate?.();
  await loadWorkspaceStatus(true);
  if (workspaceView === 'track') await window.TrackView?.ensureLoaded?.(true);
  if (workspaceView === 'catalog') await window.CatalogView?.ensureLoaded?.(true);
  if (message) showToast(message);
}

function bindTariffUi() {
  document.getElementById('tariffImportForm')?.addEventListener('submit', importCommissionTariff);
  document.getElementById('tariffToggleImportBtn')?.addEventListener('click', toggleTariffImportPanel);
  document.getElementById('tariffFilters')?.addEventListener('submit', (event) => {
    event.preventDefault();
    tariffCurrentPage = 1;
    syncTariffQueryParams();
    loadTariffAnalysis();
  });
  document.getElementById('tariffClearFiltersBtn')?.addEventListener('click', clearTariffFilters);
  document.getElementById('tariffSortBy')?.addEventListener('change', () => {
    tariffSortBy = document.getElementById('tariffSortBy')?.value || 'title';
    tariffCurrentPage = 1;
    loadTariffAnalysis();
  });
  document.getElementById('tariffSortDir')?.addEventListener('change', () => {
    tariffSortDir = document.getElementById('tariffSortDir')?.value || 'asc';
    tariffCurrentPage = 1;
    loadTariffAnalysis();
  });
  document.getElementById('tariffAnalysisTable')?.addEventListener('click', handleTariffHeaderSort);
  document.getElementById('tariffBulkApplyBtn')?.addEventListener('click', applyTariffBulkPreset);
  document.getElementById('tariffExportBtn')?.addEventListener('click', exportCommissionTariff);
  document.getElementById('tariffRefreshMissingBtn')?.addEventListener('click', refreshMissingBuyboxBatch);
  document.getElementById('tariffTrackMissingBtn')?.addEventListener('click', trackMissingTariffProducts);
  document.getElementById('tariffSyncCatalogBtn')?.addEventListener('click', syncTariffCatalog);
  document.getElementById('tariffAnalysisRows')?.addEventListener('change', handleTariffTierSelect);
  document.getElementById('tariffMobileList')?.addEventListener('change', handleTariffTierSelect);
  document.getElementById('tariffAnalysisRows')?.addEventListener('click', handleTariffManualCalc);
  document.getElementById('tariffMobileList')?.addEventListener('click', handleTariffManualCalc);
  document.getElementById('tariffPagination')?.addEventListener('click', handleTariffPagination);
  document.getElementById('tariffZoomControls')?.addEventListener('click', handleTariffZoom);
  document.getElementById('tariffPanel')?.addEventListener('click', (event) => {
    const refreshBtn = event.target.closest('[data-action="refresh"]');
    if (refreshBtn) {
      event.preventDefault();
      refreshTariffBuybox(refreshBtn.dataset.barcode, refreshBtn);
      return;
    }
    const trackBtn = event.target.closest('[data-action="track"]');
    if (trackBtn) {
      event.preventDefault();
      const barcode = trackBtn.dataset.barcode;
      const row = TARIFF_ROWS.find((item) => String(item.barcode) === String(barcode));
      toggleTariffAutoTrack(barcode, trackBtn, row);
      return;
    }
    const profitBtn = event.target.closest('[data-action="profit-detail"]');
    if (profitBtn) {
      event.preventDefault();
      openTariffProfitDetail(profitBtn);
      return;
    }
    const pushBtn = event.target.closest('[data-action="push-price"]');
    if (pushBtn) {
      event.preventDefault();
      pushProductPriceToTrendyol(pushBtn);
      return;
    }
    if (event.target.closest('[data-open-import]')) toggleTariffImportPanel(true);
  });
  document.getElementById('tariffProfitModalClose')?.addEventListener('click', closeTariffProfitModal);
  document.getElementById('tariffProfitModalBackdrop')?.addEventListener('click', (event) => {
    if (event.target.id === 'tariffProfitModalBackdrop') closeTariffProfitModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeTariffProfitModal();
  });
}

async function loadTariffMeta() {
  try {
    const response = await C.authFetch('/api/commission-tariff');
    if (!response.ok) return;
    commissionTariffMeta = await response.json();
    updateTariffPanel();
  } catch {
    // optional
  }
}

function initTariffFormDefaults() {
  const fromEl = document.getElementById('tariffValidFrom');
  const toEl = document.getElementById('tariffValidTo');
  if (fromEl && !fromEl.value) fromEl.value = '2026-05-19T08:00';
  if (toEl && !toEl.value) toEl.value = '2026-05-26T07:59';
}

function applyTariffQueryParams() {
  applyWorkspaceViewFromQuery();
  const params = new URLSearchParams(window.location.search);
  if (params.get('missingBuybox') === '1') {
    const el = document.getElementById('tariffFilterMissingBuybox');
    if (el) el.checked = true;
  }
  if (params.get('fetchableMissing') === '1') {
    const el = document.getElementById('tariffFilterFetchableMissing');
    if (el) el.checked = true;
  }
  if (params.get('missingUrl') === '1') {
    const el = document.getElementById('tariffFilterMissingUrl');
    if (el) el.checked = true;
  }
  if (params.get('missingCost') === '1') {
    const el = document.getElementById('tariffFilterMissingCost');
    if (el) el.checked = true;
  }
  if (params.get('lossRisk') === '1') {
    const el = document.getElementById('tariffFilterLossRisk');
    if (el) el.checked = true;
  }
  const profit = params.get('profit');
  if (profit && ['all', 'profit', 'loss', 'missing'].includes(profit)) {
    const el = document.getElementById('tariffFilterProfit');
    if (el) el.value = profit;
  }
  const rank = params.get('buyboxRank');
  if (rank && ['1', '2-3', '4+'].includes(rank)) {
    const el = document.getElementById('tariffFilterRank');
    if (el) el.value = rank;
  }
  const sortBy = params.get('sortBy');
  if (sortBy) {
    tariffSortBy = sortBy;
    const el = document.getElementById('tariffSortBy');
    if (el) el.value = sortBy;
  }
  const sortDir = params.get('sortDir');
  if (sortDir === 'asc' || sortDir === 'desc') {
    tariffSortDir = sortDir;
    const el = document.getElementById('tariffSortDir');
    if (el) el.value = sortDir;
  }
  const barcode = params.get('barcode');
  if (barcode) {
    workspaceView = 'tariff';
    const el = document.getElementById('tariffFilterBarcode');
    if (el) el.value = barcode;
  }
}

function syncTariffQueryParams() {
  const params = new URLSearchParams();
  const setIf = (key, value) => { if (value) params.set(key, value); };

  setIf('title', document.getElementById('tariffFilterTitle')?.value?.trim());
  setIf('barcode', document.getElementById('tariffFilterBarcode')?.value?.trim());
  setIf('modelCode', document.getElementById('tariffFilterModel')?.value?.trim());
  setIf('category', document.getElementById('tariffFilterCategory')?.value || '');
  setIf('brand', document.getElementById('tariffFilterBrand')?.value || '');

  const profit = document.getElementById('tariffFilterProfit')?.value || 'all';
  if (profit !== 'all') params.set('profit', profit);
  setIf('buyboxRank', document.getElementById('tariffFilterRank')?.value || '');

  if (document.getElementById('tariffFilterSelectedOnly')?.checked) params.set('selectedOnly', '1');
  if (document.getElementById('tariffFilterMissingBuybox')?.checked) params.set('missingBuybox', '1');
  if (document.getElementById('tariffFilterWithBuybox')?.checked) params.set('withBuybox', '1');
  if (document.getElementById('tariffFilterFetchableMissing')?.checked) params.set('fetchableMissing', '1');
  if (document.getElementById('tariffFilterMissingUrl')?.checked) params.set('missingUrl', '1');
  if (document.getElementById('tariffFilterMissingCost')?.checked) params.set('missingCost', '1');
  if (document.getElementById('tariffFilterLossRisk')?.checked) params.set('lossRisk', '1');
  if (tariffSortBy && tariffSortBy !== 'title') params.set('sortBy', tariffSortBy);
  if (tariffSortDir && tariffSortDir !== 'asc') params.set('sortDir', tariffSortDir);

  const qs = params.toString();
  history.replaceState(null, '', qs ? window.location.pathname + '?' + qs : window.location.pathname);
}

function handleTariffHeaderSort(event) {
  const th = event.target.closest('th[data-sort]');
  if (!th) return;

  const key = th.dataset.sort;
  if (tariffSortBy === key) {
    tariffSortDir = tariffSortDir === 'asc' ? 'desc' : 'asc';
  } else {
    tariffSortBy = key;
    tariffSortDir = key === 'title' ? 'asc' : 'desc';
  }

  const sortByEl = document.getElementById('tariffSortBy');
  const sortDirEl = document.getElementById('tariffSortDir');
  if (sortByEl) sortByEl.value = tariffSortBy;
  if (sortDirEl) sortDirEl.value = tariffSortDir;

  tariffCurrentPage = 1;
  loadTariffAnalysis();
}

function updateTariffSortHeaders() {
  document.querySelectorAll('#tariffAnalysisTable th[data-sort]').forEach((th) => {
    const active = th.dataset.sort === tariffSortBy;
    th.classList.toggle('sorted', active);
    const icon = th.querySelector('.tariff-sort-icon');
    if (icon) icon.textContent = active ? (tariffSortDir === 'asc' ? '▲' : '▼') : '↕';
  });
}

function toggleTariffImportPanel(forceOpen) {
  const panel = document.getElementById('tariffImportPanel');
  if (!panel) return;
  panel.hidden = forceOpen === true ? false : !panel.hidden;
}

function updateTariffPanel() {
  const active = commissionTariffMeta?.active;
  if (tariffEmptyStateEl()) tariffEmptyStateEl().hidden = Boolean(active);
  if (tariffAnalysisSectionEl()) tariffAnalysisSectionEl().hidden = !active;
  if (tariffExportBtnEl()) tariffExportBtnEl().hidden = !active;
  if (tariffDateRangeEl()) {
    tariffDateRangeEl().textContent = active
      ? formatTariffRangeHuman(commissionTariffMeta.validFrom, commissionTariffMeta.validTo) +
        ' · ' + (commissionTariffMeta.itemCount || 0) + ' ürün' +
        (commissionTariffMeta.selectedCount ? ' · ' + commissionTariffMeta.selectedCount + ' seçili' : '')
      : 'Tarife yüklenmedi — Excel dosyası yükleyin';
  }
}

function formatTariffRangeHuman(from, to) {
  if (!from || !to) return '—';
  const opts = { day: 'numeric', month: 'short', year: 'numeric' };
  return new Date(from).toLocaleDateString('tr-TR', opts) + ' - ' + new Date(to).toLocaleDateString('tr-TR', opts);
}

function tariffProfitPercent(value) {
  const n = Number(value) || 0;
  const pct = (Math.abs(n) * 100).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (n < 0 ? '-' : '') + '(' + pct + '%)';
}

function applyTariffZoom() {
  const wrap = document.getElementById('tariffGridWrap');
  const label = document.getElementById('tariffZoomLabel');
  if (wrap) wrap.style.setProperty('--tariff-zoom', String(tariffZoomLevel / 100));
  if (label) label.textContent = tariffZoomLevel + '%';
}

function handleTariffZoom(event) {
  const button = event.target.closest('[data-tariff-zoom]');
  if (!button) return;
  if (button.dataset.tariffZoom === 'in' && tariffZoomLevel < 120) tariffZoomLevel += 10;
  if (button.dataset.tariffZoom === 'out' && tariffZoomLevel > 80) tariffZoomLevel -= 10;
  applyTariffZoom();
}

function tariffFilterParams() {
  tariffSortBy = document.getElementById('tariffSortBy')?.value || tariffSortBy || 'title';
  tariffSortDir = document.getElementById('tariffSortDir')?.value || tariffSortDir || 'asc';

  const params = new URLSearchParams();
  const fields = [
    ['title', document.getElementById('tariffFilterTitle')?.value?.trim()],
    ['barcode', document.getElementById('tariffFilterBarcode')?.value?.trim()],
    ['modelCode', document.getElementById('tariffFilterModel')?.value?.trim()],
    ['category', document.getElementById('tariffFilterCategory')?.value || ''],
    ['brand', document.getElementById('tariffFilterBrand')?.value || ''],
    ['buyboxRank', document.getElementById('tariffFilterRank')?.value || '']
  ];
  fields.forEach(([key, value]) => { if (value) params.set(key, value); });

  const profit = document.getElementById('tariffFilterProfit')?.value || 'all';
  if (profit !== 'all') params.set('profit', profit);

  const minStock = document.getElementById('tariffFilterMinStock')?.value;
  const maxStock = document.getElementById('tariffFilterMaxStock')?.value;
  if (minStock !== '' && minStock !== undefined) params.set('minStock', minStock);
  if (maxStock !== '' && maxStock !== undefined) params.set('maxStock', maxStock);
  if (document.getElementById('tariffFilterSelectedOnly')?.checked) params.set('selectedOnly', '1');
  if (document.getElementById('tariffFilterMissingBuybox')?.checked) params.set('missingBuybox', '1');
  if (document.getElementById('tariffFilterWithBuybox')?.checked) params.set('withBuybox', '1');
  if (document.getElementById('tariffFilterFetchableMissing')?.checked) params.set('fetchableMissing', '1');
  if (document.getElementById('tariffFilterMissingUrl')?.checked) params.set('missingUrl', '1');
  if (document.getElementById('tariffFilterMissingCost')?.checked) params.set('missingCost', '1');
  if (document.getElementById('tariffFilterLossRisk')?.checked) params.set('lossRisk', '1');
  params.set('sortBy', tariffSortBy);
  params.set('sortDir', tariffSortDir);
  return params;
}

function populateTariffFilterOptions(filterOptions) {
  const brandEl = document.getElementById('tariffFilterBrand');
  const categoryEl = document.getElementById('tariffFilterCategory');
  if (brandEl) {
    const current = brandEl.value;
    brandEl.innerHTML = '<option value="">Tümü</option>' +
      (filterOptions?.brands || []).map((brand) => '<option value="' + escAttr(brand) + '">' + esc(brand) + '</option>').join('');
    brandEl.value = current;
  }
  if (categoryEl) {
    const current = categoryEl.value;
    categoryEl.innerHTML = '<option value="">Tümü</option>' +
      (filterOptions?.categories || []).map((cat) => '<option value="' + escAttr(cat) + '">' + esc(cat) + '</option>').join('');
    categoryEl.value = current;
  }
}

function clearTariffFilters() {
  document.getElementById('tariffFilterTitle').value = '';
  document.getElementById('tariffFilterBarcode').value = '';
  document.getElementById('tariffFilterModel').value = '';
  document.getElementById('tariffFilterCategory').value = '';
  document.getElementById('tariffFilterBrand').value = '';
  document.getElementById('tariffFilterProfit').value = 'all';
  document.getElementById('tariffFilterRank').value = '';
  document.getElementById('tariffFilterMinStock').value = '';
  document.getElementById('tariffFilterMaxStock').value = '';
  document.getElementById('tariffFilterSelectedOnly').checked = false;
  document.getElementById('tariffFilterMissingBuybox').checked = false;
  document.getElementById('tariffFilterWithBuybox').checked = false;
  document.getElementById('tariffFilterFetchableMissing').checked = false;
  document.getElementById('tariffFilterMissingUrl').checked = false;
  document.getElementById('tariffFilterMissingCost').checked = false;
  document.getElementById('tariffFilterLossRisk').checked = false;
  document.getElementById('tariffSortBy').value = 'title';
  document.getElementById('tariffSortDir').value = 'asc';
  tariffSortBy = 'title';
  tariffSortDir = 'asc';
  tariffCurrentPage = 1;
  syncTariffQueryParams();
  loadTariffAnalysis();
}

function renderTariffProfitPill(tierCell, detailMeta = null) {
  if (!tierCell || tierCell.status === 'EKSIK_VERI') {
    return '<span class="tariff-pill tariff-pill--muted">Eksik veri</span>';
  }
  if (tierCell.status === 'YOK') {
    return '<span class="tariff-pill tariff-pill--muted">—</span>';
  }

  const profit = Number(tierCell.netProfit);
  const word = profit >= 0 ? 'Kâr' : 'Zarar';
  const cls = profit >= 0 ? 'tariff-pill--profit' : 'tariff-pill--loss';
  const label = money(tierCell.netProfit) + ' ' + word + ' ' + esc(tariffProfitPercent(tierCell.profitRate));

  if (!detailMeta?.barcode) {
    return '<span class="tariff-pill ' + cls + '">' + label + '</span>';
  }

  const attrs =
    ' type="button" class="tariff-pill tariff-pill--clickable ' + cls + '"' +
    ' data-action="profit-detail"' +
    ' data-barcode="' + escAttr(detailMeta.barcode) + '"' +
    ' data-source="' + escAttr(detailMeta.source || 'tier') + '"' +
    (detailMeta.price !== undefined && detailMeta.price !== '' ? ' data-price="' + escAttr(detailMeta.price) + '"' : '') +
    (detailMeta.tier ? ' data-tier="' + escAttr(detailMeta.tier) + '"' : '') +
    ' title="Kâr/zarar detayı"';

  return '<button' + attrs + '>' + label + '</button>';
}

function buyboxRankBadge(order) {
  const rank = Number(order);
  if (!Number.isFinite(rank) || rank <= 0) return '<span class="tariff-buybox-empty">—</span>';
  let tone = 'mid';
  if (rank === 1) tone = 'win';
  else if (rank <= 3) tone = 'good';
  else if (rank >= 4) tone = 'low';
  return '<span class="buybox-rank buybox-rank--' + tone + '">' + esc(String(rank)) + '. sıra</span>';
}

function renderBuyboxRankCell(row) {
  const seller = row.buyboxSeller
    ? '<small class="tariff-buybox-seller" title="BuyBox satıcısı">' + esc(row.buyboxSeller) + '</small>'
    : '';
  const updated = row.updatedAt
    ? '<small class="tariff-buybox-updated" title="Son veri">' + esc(C.formatLocalTime(row.updatedAt)) + '</small>'
    : '';
  const trackBadge = row.autoTracked
    ? '<span class="tariff-track-badge" title="Otomatik takip listesinde">Takipte</span>'
    : '';
  return '<div class="tariff-buybox-rank-box">' +
    buyboxRankBadge(row.buyboxOrder) +
    seller +
    updated +
    trackBadge +
  '</div>';
}

function renderTariffActionsCell(row) {
  const trackLabel = row.autoTracked ? 'Takipten Çıkar' : 'Takibe Al';
  const trackClass = row.autoTracked ? ' tariff-action-btn--tracked' : '';
  return '<div class="tariff-actions-cell">' +
    renderBuyboxRefreshBtn(row.barcode) +
    '<button type="button" class="tariff-action-btn tariff-action-btn--ghost' + trackClass + '"' +
      ' data-action="track" data-barcode="' + escAttr(row.barcode) + '">' +
      esc(trackLabel) +
    '</button>' +
  '</div>';
}

function renderBuyboxRefreshBtn(barcode, label = '') {
  const text = label || 'Canlı Güncelle';
  return '<button type="button" class="tariff-live-refresh-btn" data-action="refresh" data-barcode="' + escAttr(barcode) + '">' + esc(text) + '</button>';
}

function buyboxUnavailableLabel(reason) {
  if (reason === 'off_sale') return 'Satışta değil — sayfadan BuyBox çekilebilir';
  if (reason === 'no_stock') return 'Stok 0 — sayfadan BuyBox çekilebilir';
  if (reason === 'no_buybox') return 'BuyBox yok — API veri döndürmedi';
  return 'BuyBox yok';
}

function resolveBuyboxDetailPrice(row) {
  if (toNumber(row.buyboxPrice)) return row.buyboxPrice;
  if (row.priceSource === 'tsf' && toNumber(row.currentTsf)) return row.currentTsf;
  return '';
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function renderBuyboxProfitCell(row) {
  const detailMeta = {
    barcode: row.barcode,
    source: 'buybox',
    price: resolveBuyboxDetailPrice(row),
    tier: row.buyboxCommissionTier || ''
  };

  if (!row.buyboxPrice) {
    if (row.priceSource === 'tsf' && row.buyboxProfitStatus && row.buyboxProfitStatus !== 'YOK') {
      return '<div class="tariff-buybox-box tariff-buybox-box--tsf">' +
        '<span class="tariff-buybox-empty">' + esc(buyboxUnavailableLabel(row.buyboxUnavailableReason)) + '</span>' +
        '<small class="tariff-buybox-tier">TSF ile tahmini kâr</small>' +
        renderTariffProfitPill({
          netProfit: row.buyboxNetProfit,
          profitRate: row.buyboxProfitRate,
          status: row.buyboxProfitStatus
        }, detailMeta) +
      '</div>';
    }
    return '<div class="tariff-buybox-box tariff-buybox-box--empty">' +
      '<span class="tariff-buybox-empty">' + esc(buyboxUnavailableLabel(row.buyboxUnavailableReason)) + '</span>' +
      (row.productUrl
        ? renderBuyboxRefreshBtn(row.barcode, 'Sayfadan BuyBox çek')
        : '') +
    '</div>';
  }
  if (row.buyboxProfitStatus === 'EKSIK_VERI') {
    return '<div class="tariff-buybox-box"><span class="tariff-pill tariff-pill--muted">Eksik veri</span></div>';
  }
  return '<div class="tariff-buybox-box">' +
    renderTariffProfitPill({
      netProfit: row.buyboxNetProfit,
      profitRate: row.buyboxProfitRate,
      status: row.buyboxProfitStatus
    }, detailMeta) +
    (row.buyboxCommissionTier
      ? '<small class="tariff-buybox-tier">Kademe ' + esc(String(row.buyboxCommissionTier)) + ' · %' + esc(String(row.buyboxCommissionRate || '—')) + '</small>'
      : '') +
  '</div>';
}

function renderBuyboxPriceCell(row) {
  if (row.buyboxPrice) {
    return '<strong class="tariff-buybox-price">' + money(row.buyboxPrice) + '</strong>' +
      (row.buyboxSource === 'product-page'
        ? '<small class="tariff-buybox-source" title="Pazar BuyBox fiyatı — Trendyol ürün sayfasından">pazar</small>'
        : '');
  }
  if (row.priceSource === 'tsf' && row.currentTsf) {
    return '<span class="tariff-buybox-tsf" title="Canlı BuyBox yok, tarife TSF kullanıldı">' +
      money(row.currentTsf) + ' <small>TSF</small></span>';
  }
  return '<span class="tariff-buybox-empty">—</span>';
}

function renderTierReferenceNote(tierCell) {
  if (!tierCell?.referencePrice) return '';
  if (tierCell.priceBasis === 'buybox') {
    return '<small class="tariff-tier-ref">@ BuyBox ' + money(tierCell.referencePrice) + '</small>';
  }
  if (tierCell.priceBasis === 'selected') {
    return '<small class="tariff-tier-ref">@ Seçili ' + money(tierCell.referencePrice) + '</small>';
  }
  return '<small class="tariff-tier-ref">@ ' + money(tierCell.referencePrice) + '</small>';
}

function renderTariffTierCell(row, tierCell) {
  const tier = tierCell.tier;
  const checked = row.selectedTier === tier ? ' checked' : '';
  const disabled = tierCell.status === 'EKSIK_VERI' || tierCell.status === 'YOK' ? ' disabled' : '';
  const selectedClass = row.selectedTier === tier ? ' is-selected' : '';
  return '<div class="tariff-tier-box' + selectedClass + '">' +
    '<div class="tariff-tier-range">' + esc(tierCell.rangeLabel) + '</div>' +
    '<div class="tariff-tier-rate">Komisyon ' + esc(String(tierCell.rate || '—')) + '</div>' +
    renderTariffProfitPill(tierCell, {
      barcode: row.barcode,
      tier: tierCell.tier,
      source: 'tier'
    }) +
    renderTierReferenceNote(tierCell) +
    '<label class="tariff-tier-select">' +
      '<input type="radio" name="tier-' + escAttr(row.barcode) + '" value="' + tier + '"' + checked + disabled +
      ' data-barcode="' + escAttr(row.barcode) + '" data-tier="' + tier + '"> Seç' +
    '</label>' +
  '</div>';
}

function renderTariffProductCell(row) {
  const src = row.imageUrl
    ? escAttr(row.imageUrl)
    : '/api/product-thumb-img?barcode=' + encodeURIComponent(row.barcode);
  const img = '<img class="tariff-product-thumb" src="' + src + '" alt="" loading="lazy" onerror="this.classList.add(\'is-broken\')">';
  const thumb = row.productUrl
    ? '<a href="' + hrefAttr(row.productUrl) + '" target="_blank" rel="noopener noreferrer">' + img + '</a>'
    : img;
  const titleHtml = row.productUrl
    ? '<a href="' + hrefAttr(row.productUrl) + '" target="_blank" rel="noopener noreferrer" class="tariff-product-title">' + esc(row.title || '—') + '</a>'
    : '<strong class="tariff-product-title">' + esc(row.title || '—') + '</strong>';
  return '<div class="tariff-product-cell">' + thumb +
    '<div class="tariff-product-meta">' +
      titleHtml +
      '<span>' + esc(row.category || '') + '</span>' +
      '<span>Model: ' + esc(row.modelCode || '—') + ' · ' + esc(row.size || '') + '</span>' +
      '<small>' + esc(row.barcode) + '</small>' +
    '</div>' +
  '</div>';
}

function renderTariffManualCell(row) {
  return '<div class="tariff-manual-cell">' +
    '<input type="number" step="0.01" min="0" class="tariff-manual-input" data-barcode="' + escAttr(row.barcode) + '" placeholder="Manuel Fiyat">' +
    '<div class="tariff-manual-actions">' +
      '<button type="button" class="tariff-btn-calc" data-manual-calc="' + escAttr(row.barcode) + '">Hesapla</button>' +
      '<button type="button" class="tariff-send-price-btn tariff-send-price-btn--inline" data-action="push-price" data-price-source="manual" data-barcode="' + escAttr(row.barcode) + '" title="Manuel fiyatı Trendyol\'a gönder">Gönder</button>' +
    '</div>' +
    '<div class="tariff-manual-result" id="tariff-manual-' + escAttr(row.barcode) + '"></div>' +
  '</div>';
}

function isSameTariffPrice(current, target) {
  return Math.abs(toNumber(current) - toNumber(target)) < 0.005;
}

function renderTariffTrendyolCell(row) {
  const selectedPrice = toNumber(row.selectedPrice);
  const hasSelection = row.selectedTier && selectedPrice > 0;
  const unchanged = hasSelection && isSameTariffPrice(row.currentTsf, selectedPrice);

  if (!hasSelection) {
    return '<div class="tariff-trendyol-cell">' +
      '<span class="tariff-send-hint">Önce kademe seçin</span>' +
    '</div>';
  }

  const loss = toNumber(row.selectionProfit) < 0;
  return '<div class="tariff-trendyol-cell">' +
    '<button type="button" class="tariff-send-price-btn"' +
      ' data-action="push-price"' +
      ' data-price-source="selected"' +
      ' data-barcode="' + escAttr(row.barcode) + '"' +
      ' data-price="' + escAttr(selectedPrice) + '"' +
      (unchanged ? ' disabled' : '') +
      ' title="' + escAttr(unchanged ? 'Fiyat zaten güncel' : 'Seçili fiyatı Trendyol\'a gönder') + '">' +
      'Trendyol\'a Gönder' +
    '</button>' +
    '<small class="tariff-send-target">→ ' + money(selectedPrice) + '</small>' +
    (loss ? '<small class="tariff-send-warn">Zarar riski</small>' : '') +
  '</div>';
}

function pageRows() {
  const totalPages = Math.max(1, Math.ceil(TARIFF_ROWS.length / tariffPageSize));
  if (tariffCurrentPage > totalPages) tariffCurrentPage = totalPages;
  const start = (tariffCurrentPage - 1) * tariffPageSize;
  return { rows: TARIFF_ROWS.slice(start, start + tariffPageSize), totalPages };
}

function renderTariffPagination(totalPages) {
  if (tariffRowCountEl()) {
    tariffRowCountEl().textContent = TARIFF_ROWS.length + ' ürün · sayfa ' + tariffCurrentPage + '/' + totalPages;
  }
  if (tariffPaginationEl()) {
    tariffPaginationEl().innerHTML =
      '<button type="button" data-tariff-page="prev"' + (tariffCurrentPage <= 1 ? ' disabled' : '') + '>Önceki</button>' +
      '<span>' + tariffCurrentPage + ' / ' + totalPages + '</span>' +
      '<button type="button" data-tariff-page="next"' + (tariffCurrentPage >= totalPages ? ' disabled' : '') + '>Sonraki</button>';
  }
}

function renderTariffAnalysisTable() {
  const rowsEl = tariffAnalysisRowsEl();
  if (!rowsEl) return;
  if (!TARIFF_ROWS.length) {
    rowsEl.innerHTML = '<tr><td colspan="14" class="muted">Filtreye uygun ürün yok.</td></tr>';
    if (tariffRowCountEl()) tariffRowCountEl().textContent = '0 ürün';
    if (tariffPaginationEl()) tariffPaginationEl().innerHTML = '';
    return;
  }

  const { rows, totalPages } = pageRows();
  rowsEl.innerHTML = rows.map((row) => {
    const tiers = row.tiers || [];
    return '<tr data-barcode="' + escAttr(row.barcode) + '"' + (row.selectedTier ? ' class="is-selected"' : '') + '>' +
      '<td class="col-sticky col-variant"><span class="tariff-variant-tag">Tek Varyantlı Ürün</span></td>' +
      '<td class="col-sticky col-product">' + renderTariffProductCell(row) + '</td>' +
      '<td class="col-metric">' + esc(String(row.stock ?? '—')) + '</td>' +
      '<td class="col-metric"><strong class="tariff-current-price">' + money(row.currentTsf) + '</strong></td>' +
      '<td class="col-buybox tariff-buybox-rank-cell">' + renderBuyboxRankCell(row) + '</td>' +
      '<td class="col-buybox">' + renderBuyboxPriceCell(row) + '</td>' +
      '<td class="col-buybox tariff-buybox-profit-cell">' + renderBuyboxProfitCell(row) + '</td>' +
      '<td class="col-actions">' + renderTariffActionsCell(row) + '</td>' +
      tiers.map((tierCell) => '<td>' + renderTariffTierCell(row, tierCell) + '</td>').join('') +
      '<td>' + renderTariffManualCell(row) + '</td>' +
      '<td>' + renderTariffTrendyolCell(row) + '</td>' +
    '</tr>';
  }).join('');

  renderTariffPagination(totalPages);
}

function renderTariffMobileCards() {
  const listEl = tariffMobileListEl();
  if (!listEl) return;

  if (!TARIFF_ROWS.length) {
    listEl.innerHTML = '<p class="muted tariff-empty">Filtreye uygun ürün yok.</p>';
    if (tariffRowCountEl()) tariffRowCountEl().textContent = '0 ürün';
    if (tariffPaginationEl()) tariffPaginationEl().innerHTML = '';
    return;
  }

  const { rows, totalPages } = pageRows();
  listEl.innerHTML = rows.map((row) => {
    const tiers = row.tiers || [];
    return '<article class="tariff-mobile-card' + (row.selectedTier ? ' is-selected' : '') + '" data-barcode="' + escAttr(row.barcode) + '">' +
      '<div class="tariff-mobile-head">' + renderTariffProductCell(row) + '</div>' +
      '<div class="tariff-mobile-stats">' +
        '<span class="tariff-stat-chip">Stok <strong>' + esc(String(row.stock ?? '—')) + '</strong></span>' +
        '<span class="tariff-stat-chip">TSF <strong class="tariff-current-price">' + money(row.currentTsf) + '</strong></span>' +
        '<span class="tariff-stat-chip">BB <strong class="tariff-buybox-price">' + money(row.buyboxPrice) + '</strong></span>' +
      '</div>' +
      '<div class="tariff-mobile-buybox">' +
        '<span class="tariff-mobile-buybox-label">BuyBox</span>' +
        renderBuyboxRankCell(row) +
        renderBuyboxPriceCell(row) +
      '</div>' +
      '<div class="tariff-mobile-buybox">' +
        '<span class="tariff-mobile-buybox-label">Net kâr (BuyBox)</span>' +
        renderBuyboxProfitCell(row) +
      '</div>' +
      '<div class="tariff-mobile-actions">' + renderTariffActionsCell(row) + '</div>' +
      tiers.map((tierCell) =>
        '<div class="tariff-mobile-tier' + (row.selectedTier === tierCell.tier ? ' is-selected' : '') + '">' +
          '<div class="tariff-mobile-tier-head"><span>' + esc(tierCell.tier) + '. Kademe</span><span>' + esc(tierCell.rangeLabel) + '</span></div>' +
          '<div class="tariff-tier-rate">Komisyon ' + esc(String(tierCell.rate || '—')) + '</div>' +
          renderTariffProfitPill(tierCell, {
      barcode: row.barcode,
      tier: tierCell.tier,
      source: 'tier'
    }) +
          renderTierReferenceNote(tierCell) +
          '<label class="tariff-tier-select">' +
            '<input type="radio" name="tier-' + escAttr(row.barcode) + '" value="' + tierCell.tier + '"' +
            (row.selectedTier === tierCell.tier ? ' checked' : '') +
            (tierCell.status === 'EKSIK_VERI' || tierCell.status === 'YOK' ? ' disabled' : '') +
            ' data-barcode="' + escAttr(row.barcode) + '" data-tier="' + tierCell.tier + '"> Seç' +
          '</label>' +
        '</div>'
      ).join('') +
      renderTariffManualCell(row) +
      '<div class="tariff-mobile-trendyol">' + renderTariffTrendyolCell(row) + '</div>' +
    '</article>';
  }).join('');

  renderTariffPagination(totalPages);
}

function renderTariffViews() {
  updateTariffSortHeaders();
  if (window.matchMedia('(max-width: 768px)').matches) {
    renderTariffMobileCards();
  } else {
    renderTariffAnalysisTable();
    applyTariffZoom();
  }
}

async function refreshTariffBuybox(barcode, button) {
  if (!barcode) return;
  C.setBusy(button, true);
  showToast('Canlı BuyBox sorgulanıyor...');

  try {
    const response = await C.authFetch('/api/buybox/refresh', {
      method: 'POST',
      body: JSON.stringify({ barcode })
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok || result.ok === false) {
      showToast(result.error || result.message || 'Canlı güncelleme başarısız');
      return;
    }

    await loadTariffAnalysis();
    showToast(result.skipped
      ? result.message + ' ' + result.cooldownSeconds + ' sn sonra tekrar deneyin.'
      : 'Ürün canlı güncellendi');
  } catch (error) {
    showToast(error.message || 'Canlı güncelleme bağlantı hatası');
  } finally {
    C.setBusy(button, false);
  }
}

async function addTariffAutoTrack(barcode, button) {
  if (!barcode) return;
  C.setBusy(button, true);

  try {
    const response = await C.authFetch('/api/auto-track', {
      method: 'POST',
      body: JSON.stringify({ barcode, priority: 'normal' })
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok || result.ok === false) {
      showToast(result.error || result.message || 'Takibe alınamadı');
      return;
    }

    await loadTariffAnalysis();
    await syncAfterTrackChange('Takip listesine eklendi — worker bu barkodu otomatik sorgular');
  } catch (error) {
    showToast(error.message || 'Takip bağlantı hatası');
  } finally {
    C.setBusy(button, false);
  }
}

async function removeTariffAutoTrack(barcode, button) {
  if (!barcode) return;
  C.setBusy(button, true);

  try {
    const response = await C.authFetch('/api/auto-track/remove', {
      method: 'POST',
      body: JSON.stringify({ barcode })
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok || result.ok === false) {
      showToast(result.error || result.message || 'Takipten çıkarılamadı');
      return;
    }

    await loadTariffAnalysis();
    await syncAfterTrackChange('Takip listesinden çıkarıldı');
  } catch (error) {
    showToast(error.message || 'Takip bağlantı hatası');
  } finally {
    C.setBusy(button, false);
  }
}

async function toggleTariffAutoTrack(barcode, button, row) {
  if (row?.autoTracked) {
    await removeTariffAutoTrack(barcode, button);
  } else {
    await addTariffAutoTrack(barcode, button);
  }
}

function updateTariffCoverageBanner(summary) {
  const banner = document.getElementById('tariffCoverageBanner');
  const refreshBtn = document.getElementById('tariffRefreshMissingBtn');
  const trackBtn = document.getElementById('tariffTrackMissingBtn');
  if (!banner || !summary) return;

  const missing = Number(summary.missingBuybox) || 0;
  banner.hidden = !summary.total;
  banner.classList.toggle('is-warning', missing > 0);
  banner.innerHTML =
    '<strong>' + esc(String(summary.withBuybox || 0)) + '/' + esc(String(summary.total || 0)) + '</strong> üründe canlı BuyBox var' +
    (missing > 0
      ? ' · <span class="tariff-coverage-missing">' + esc(String(missing)) + ' canlı BuyBox yok</span>' +
        (summary.missingOffSale
          ? ' · ' + esc(String(summary.missingOffSale)) + ' satışta değil/stok 0'
          : '') +
        (summary.missingFetchable
          ? ' · ' + esc(String(summary.missingFetchable)) + ' çekilebilir'
          : '') +
        (summary.missingUrl
          ? ' · ' + esc(String(summary.missingUrl)) + ' link eksik'
          : '')
      : '') +
    (summary.selected ? ' · ' + esc(String(summary.selected)) + ' kademe seçili' : '');

  if (refreshBtn) refreshBtn.disabled = (summary.missingFetchable || 0) <= 0;
  if (trackBtn) trackBtn.disabled = (summary.missingFetchable || 0) <= 0;

  const lossRisk = TARIFF_ROWS.filter((row) => {
    const status = String(row.buyboxProfitStatus || row.selectedProfitStatus || '').toUpperCase();
    return status.includes('ZARAR');
  }).length;

  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value ?? '—');
  };
  set('tariffSummaryTotal', summary.total || 0);
  set('tariffSummaryWithBuybox', summary.withBuybox || 0);
  set('tariffSummaryMissingBuybox', summary.missingBuybox || 0);
  set('tariffSummarySelected', summary.selected || 0);
  set('tariffSummaryLossRisk', lossRisk);
}

async function refreshMissingBuyboxBatch() {
  const button = document.getElementById('tariffRefreshMissingBtn');
  C.setBusy(button, true);
  showToast('Eksik BuyBox verileri sorgulanıyor...');

  try {
    const response = await C.authFetch('/api/buybox/refresh-batch', {
      method: 'POST',
      body: JSON.stringify({ missingFromTariff: true, maxCount: 30 })
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok || result.ok === false) {
      showToast(result.error || result.message || 'Toplu güncelleme başarısız');
      return;
    }

    await loadTariffAnalysis();
    showToast(result.message || 'Toplu güncelleme tamamlandı');
  } catch (error) {
    showToast(error.message || 'Toplu güncelleme bağlantı hatası');
  } finally {
    C.setBusy(button, false);
  }
}

async function trackMissingTariffProducts() {
  const button = document.getElementById('tariffTrackMissingBtn');
  C.setBusy(button, true);

  try {
    const response = await C.authFetch('/api/auto-track/bulk', {
      method: 'POST',
      body: JSON.stringify({ missingFromTariff: true })
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok || result.ok === false) {
      showToast(result.error || result.message || 'Takibe alma başarısız');
      return;
    }

    showToast(result.message || 'Ürünler takibe alındı');
  } catch (error) {
    showToast(error.message || 'Takibe alma bağlantı hatası');
  } finally {
    C.setBusy(button, false);
  }
}

async function syncTariffCatalog() {
  const button = document.getElementById('tariffSyncCatalogBtn');
  C.setBusy(button, true);

  try {
    const response = await C.authFetch('/api/commission-tariff/sync-catalog', { method: 'POST' });
    const result = await response.json().catch(() => ({}));

    if (!response.ok || result.ok === false) {
      showToast(result.error || result.message || 'Katalog senkronu başarısız');
      return;
    }

    showToast(result.message || 'Katalog güncellendi');
  } catch (error) {
    showToast(error.message || 'Katalog senkronu bağlantı hatası');
  } finally {
    C.setBusy(button, false);
  }
}

async function pushProductPriceToTrendyol(button) {
  const barcode = button.dataset.barcode;
  const source = button.dataset.priceSource || 'selected';
  const row = TARIFF_ROWS.find((item) => String(item.barcode) === String(barcode)) || {};
  let price = toNumber(button.dataset.price);

  if (source === 'manual') {
    const container = button.closest('[data-barcode]');
    const input = container?.querySelector('.tariff-manual-input[data-barcode="' + barcode + '"]');
    price = toNumber(input?.value);
    if (!price) {
      showToast('Manuel fiyat girin.');
      return;
    }
  } else if (!price) {
    price = toNumber(row.selectedPrice);
  }

  if (!price) {
    showToast('Gönderilecek fiyat yok. Önce kademe seçin veya manuel fiyat girin.');
    return;
  }

  if (isSameTariffPrice(row.currentTsf, price)) {
    showToast('Bu fiyat zaten güncel TSF ile aynı.');
    return;
  }

  const title = row.title || barcode;
  const confirmed = window.confirm(
    `"${title.slice(0, 60)}"\n\n` +
    `Güncel: ${money(row.currentTsf)}\n` +
    `Yeni: ${money(price)}\n\n` +
    'Bu ürünün fiyatı Trendyol\'a gönderilsin mi?'
  );
  if (!confirmed) return;

  C.setBusy(button, true);
  if (tariffBulkStatusEl()) tariffBulkStatusEl().textContent = `${barcode} Trendyol'a gönderiliyor…`;
  showToast('Trendyol\'a gönderiliyor…');

  try {
    const body = {
      barcodes: [barcode],
      profitableOnly: false
    };
    if (source === 'manual') body.price = price;

    const response = await C.authFetch('/api/commission-tariff/push-prices', {
      method: 'POST',
      body: JSON.stringify(body)
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok || result.ok === false) {
      const message = result.error || result.message || 'Trendyol fiyat gönderimi başarısız';
      showToast(message);
      if (tariffBulkStatusEl()) tariffBulkStatusEl().textContent = message;
      return;
    }

    const message = result.message || `${money(price)} Trendyol'a gönderildi.`;
    showToast(message);
    if (tariffBulkStatusEl()) tariffBulkStatusEl().textContent = message;
    await loadTariffAnalysis();
  } catch (error) {
    const message = error.message || 'Trendyol fiyat gönderimi bağlantı hatası';
    showToast(message);
    if (tariffBulkStatusEl()) tariffBulkStatusEl().textContent = message;
  } finally {
    C.setBusy(button, false);
  }
}

async function loadTariffAnalysis() {
  if (!commissionTariffMeta?.active) {
    updateTariffPanel();
    return;
  }

  try {
    const response = await C.authFetch('/api/commission-tariff/analysis?' + tariffFilterParams().toString());
    if (!response.ok) return;
    const payload = await response.json();
    commissionTariffMeta = payload.meta || commissionTariffMeta;
    TARIFF_ROWS = payload.rows || [];
    populateTariffFilterOptions(payload.filterOptions);
    updateTariffCoverageBanner(payload.summary);
    updateTariffPanel();
    syncTariffQueryParams();
    renderTariffViews();
  } catch {
    // optional
  }
}

function handleTariffPagination(event) {
  const button = event.target.closest('[data-tariff-page]');
  if (!button || button.disabled) return;
  if (button.dataset.tariffPage === 'prev') tariffCurrentPage -= 1;
  if (button.dataset.tariffPage === 'next') tariffCurrentPage += 1;
  renderTariffViews();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function handleTariffTierSelect(event) {
  const input = event.target.closest('input[type="radio"][data-barcode]');
  if (!input) return;

  const barcode = input.dataset.barcode;
  const tier = Number(input.dataset.tier);
  try {
    const response = await C.authFetch('/api/commission-tariff/select-tier', {
      method: 'POST',
      body: JSON.stringify({ barcode, tier, applyUntilEnd: true })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      showToast(result.error || 'Seçim kaydedilemedi');
      loadTariffAnalysis();
      return;
    }
    commissionTariffMeta = { ...commissionTariffMeta, selectedCount: result.selectedCount || commissionTariffMeta.selectedCount };
    const row = TARIFF_ROWS.find((item) => String(item.barcode) === String(barcode));
    if (row) {
      row.selectedTier = tier;
      const tierCell = (row.tiers || []).find((item) => Number(item.tier) === tier);
      if (tierCell) {
        row.selectedPrice = tierCell.referencePrice;
        row.selectionProfit = tierCell.netProfit;
        row.selectionProfitRate = tierCell.profitRate;
      }
    }
    updateTariffPanel();
    renderTariffViews();
  } catch (error) {
    showToast(error.message || 'Bağlantı hatası');
  }
}

async function handleTariffManualCalc(event) {
  const button = event.target.closest('[data-manual-calc]');
  if (!button) return;

  const barcode = button.dataset.manualCalc;
  const card = button.closest('[data-barcode]');
  const input = card?.querySelector('.tariff-manual-input[data-barcode="' + barcode + '"]')
    || document.querySelector('.tariff-manual-input[data-barcode="' + barcode + '"]');
  const resultEl = document.getElementById('tariff-manual-' + barcode);
  const price = Number(input?.value || 0);

  if (!price) {
    if (resultEl) resultEl.textContent = 'Fiyat girin.';
    return;
  }

  button.disabled = true;
  try {
    const response = await C.authFetch('/api/commission-tariff/manual-calc', {
      method: 'POST',
      body: JSON.stringify({ barcode, price })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (resultEl) resultEl.textContent = result.error || 'Hesaplanamadı';
      return;
    }
    const profit = result.profit;
    if (!profit || profit.status === 'EKSIK_VERI') {
      if (resultEl) resultEl.innerHTML = '<span class="tariff-pill tariff-pill--muted">Eksik veri</span>';
      return;
    }
    const tierInfo = result.tier ? ' · Kademe ' + result.tier : '';
    if (resultEl) {
      resultEl.innerHTML = renderTariffProfitPill({
        netProfit: profit.netProfit,
        profitRate: profit.profitRate,
        status: Number(profit.netProfit) >= 0 ? 'KAR' : 'ZARAR'
      }, {
        barcode,
        price,
        tier: result.tier || '',
        source: 'manual'
      }) + '<small>Komisyon ' + esc(String(result.rate || '—')) + tierInfo + '</small>';
    }
  } finally {
    button.disabled = false;
  }
}

async function applyTariffBulkPreset() {
  const preset = document.getElementById('tariffBulkPreset')?.value || '';
  const button = document.getElementById('tariffBulkApplyBtn');
  if (!preset) {
    if (tariffBulkStatusEl()) tariffBulkStatusEl().textContent = 'Toplu seçim türü seçin.';
    return;
  }

  if (tariffBulkStatusEl()) tariffBulkStatusEl().textContent = 'Uygulanıyor...';
  C.setBusy(button, true);

  try {
    if (preset === 'clear') {
      const response = await C.authFetch('/api/commission-tariff/clear-selections', { method: 'POST' });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        if (tariffBulkStatusEl()) tariffBulkStatusEl().textContent = result.error || 'Temizlenemedi.';
        return;
      }
      if (tariffBulkStatusEl()) tariffBulkStatusEl().textContent = 'Seçimler temizlendi.';
      showToast('Tarife seçimleri temizlendi');
      await loadTariffAnalysis();
      return;
    }

    if (preset === 'profitable') {
      const response = await C.authFetch('/api/commission-tariff/bulk-select', {
        method: 'POST',
        body: JSON.stringify({
          minNetProfit: Number(document.getElementById('tariffMinNetProfit')?.value || 0),
          minProfitRate: Number(document.getElementById('tariffMinProfitRate')?.value || 0),
          tiers: [4, 3, 2],
          applyUntilEnd: true
        })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (tariffBulkStatusEl()) tariffBulkStatusEl().textContent = result.error || 'Toplu seçim başarısız.';
        return;
      }
      commissionTariffMeta = { ...commissionTariffMeta, selectedCount: result.selectedCount || result.summary?.total || 0 };
      if (tariffBulkStatusEl()) tariffBulkStatusEl().textContent = (result.summary?.total || 0) + ' ürün seçildi.';
      showToast((result.summary?.total || 0) + ' ürün seçildi');
      await loadTariffAnalysis();
    }
  } catch (error) {
    if (tariffBulkStatusEl()) tariffBulkStatusEl().textContent = error.message || 'Bağlantı hatası.';
  } finally {
    C.setBusy(button, false);
    document.getElementById('tariffBulkPreset').value = '';
  }
}

async function exportCommissionTariff() {
  const button = document.getElementById('tariffExportBtn');
  if (tariffBulkStatusEl()) tariffBulkStatusEl().textContent = 'Excel hazırlanıyor...';
  C.setBusy(button, true);

  try {
    const response = await C.authFetch('/api/commission-tariff/export');
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      if (tariffBulkStatusEl()) tariffBulkStatusEl().textContent = result.error || 'Export başarısız.';
      return;
    }

    const blob = await response.blob();
    const disposition = response.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="([^"]+)"/);
    const filename = match?.[1] || 'komisyon-tarifesi-secim.xlsx';
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    if (tariffBulkStatusEl()) tariffBulkStatusEl().textContent = 'Excel indirildi.';
    showToast('Trendyol Excel indirildi');
  } catch (error) {
    if (tariffBulkStatusEl()) tariffBulkStatusEl().textContent = error.message || 'Bağlantı hatası.';
  } finally {
    C.setBusy(button, false);
  }
}

async function importCommissionTariff(event) {
  event.preventDefault();
  const fileInput = document.getElementById('tariffFile');
  const validFrom = document.getElementById('tariffValidFrom')?.value || '';
  const validTo = document.getElementById('tariffValidTo')?.value || '';
  const button = document.getElementById('importTariffBtn');
  const file = fileInput?.files?.[0];

  if (!file) {
    if (tariffImportStatusEl()) tariffImportStatusEl().textContent = 'Excel dosyası seçin.';
    return;
  }

  if (tariffImportStatusEl()) tariffImportStatusEl().textContent = 'Yükleniyor...';
  C.setBusy(button, true);

  try {
    const contentBase64 = await readFileAsBase64(file);
    const response = await C.authFetch('/api/commission-tariff/import', {
      method: 'POST',
      body: JSON.stringify({
        filename: file.name,
        validFrom: new Date(validFrom).toISOString(),
        validTo: new Date(validTo).toISOString(),
        contentBase64
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (tariffImportStatusEl()) tariffImportStatusEl().textContent = result.error || 'Yükleme başarısız.';
      return;
    }

    if (tariffImportStatusEl()) tariffImportStatusEl().textContent = result.message || 'Tarife yüklendi.';
    showToast(result.message || 'Komisyon tarifesi yüklendi');
    commissionTariffMeta = result;
    document.getElementById('tariffImportPanel').hidden = true;
    tariffCurrentPage = 1;
    await loadTariffAnalysis();
  } catch (error) {
    if (tariffImportStatusEl()) tariffImportStatusEl().textContent = error.message || 'Bağlantı hatası.';
  } finally {
    C.setBusy(button, false);
  }
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = () => reject(new Error('Dosya okunamadı.'));
    reader.readAsDataURL(file);
  });
}

function showToast(message) {
  const el = document.getElementById('tariffToast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

function closeTariffProfitModal() {
  const backdrop = document.getElementById('tariffProfitModalBackdrop');
  if (backdrop) backdrop.hidden = true;
}

function renderProfitBreakdownHtml(payload) {
  if (!payload?.breakdown) {
    const missing = (payload?.missing || []).join(', ') || 'Eksik veri';
    return '<p class="tariff-profit-missing">Hesaplanamadı: ' + esc(missing) + '</p>';
  }

  const b = payload.breakdown;
  const netPositive = Number(payload.netProfit) >= 0;
  const rows = [
    [b.priceLabel || 'Satış fiyatı', b.salePrice, false],
    ['Ürün maliyeti', b.productCost, true],
    ['Komisyon (%' + esc(String(b.commissionRate)) + (b.commissionTier ? ', kademe ' + esc(String(b.commissionTier)) : '') + ')', b.commission, true],
    ['Kargo (' + esc(String(b.desi)) + ' desi)', b.shippingFee, true],
    ['Hizmet bedeli', b.serviceFee, true],
    ['Stopaj (%1)', b.withholding, true],
    ['Ödenecek KDV (KDV %' + esc(String(b.vatRatePercent)) + ')', b.payableVat, true]
  ];

  return '<div class="tariff-profit-meta">' +
    '<strong>' + esc(payload.title || payload.barcode) + '</strong>' +
    '<span>' + esc(payload.barcode) + '</span>' +
    (payload.tier ? '<span>' + esc(String(payload.tier)) + '. kademe · %' + esc(String(payload.rate || '—')) + ' komisyon</span>' : '') +
  '</div>' +
  '<table class="tariff-profit-table">' +
    '<tbody>' +
      rows.map(([label, value, deduct]) =>
        '<tr><th>' + label + '</th><td class="' + (deduct ? 'is-deduct' : 'is-income') + '">' +
          (deduct ? '− ' : '') + money(value) +
        '</td></tr>'
      ).join('') +
      '<tr class="tariff-profit-total ' + (netPositive ? 'is-profit' : 'is-loss') + '">' +
        '<th>Net ' + (netPositive ? 'kâr' : 'zarar') + '</th>' +
        '<td>' + money(payload.netProfit) + ' · ' + esc(tariffProfitPercent(payload.profitRate)) + '</td>' +
      '</tr>' +
    '</tbody>' +
  '</table>' +
  '<details class="tariff-profit-vat-details">' +
    '<summary>KDV detayı</summary>' +
    '<table class="tariff-profit-table tariff-profit-table--compact">' +
      '<tbody>' +
        '<tr><th>Satış KDV</th><td>' + money(b.salesVat) + '</td></tr>' +
        '<tr><th>Alış KDV</th><td>− ' + money(b.purchaseVat) + '</td></tr>' +
        '<tr><th>Komisyon KDV</th><td>− ' + money(b.commissionVat) + '</td></tr>' +
        '<tr><th>Kargo KDV</th><td>− ' + money(b.shippingVat) + '</td></tr>' +
        '<tr><th>Hizmet KDV</th><td>− ' + money(b.serviceVat) + '</td></tr>' +
      '</tbody>' +
    '</table>' +
  '</details>';
}

async function openTariffProfitDetail(button) {
  const barcode = button.dataset.barcode;
  const source = button.dataset.source || 'tier';
  const tier = button.dataset.tier || '';
  const price = button.dataset.price || '';
  const backdrop = document.getElementById('tariffProfitModalBackdrop');
  const body = document.getElementById('tariffProfitModalBody');
  const title = document.getElementById('tariffProfitModalTitle');
  if (!backdrop || !body) return;

  backdrop.hidden = false;
  if (title) title.textContent = 'Kâr / Zarar Detayı';
  body.innerHTML = '<p class="muted">Hesaplanıyor…</p>';

  try {
    const response = await C.authFetch('/api/commission-tariff/profit-breakdown', {
      method: 'POST',
      body: JSON.stringify({
        barcode,
        source,
        tier: tier ? Number(tier) : undefined,
        price: price ? Number(price) : undefined
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      body.innerHTML = '<p class="tariff-profit-missing">' + esc(payload.error || 'Detay alınamadı') + '</p>';
      return;
    }
    body.innerHTML = renderProfitBreakdownHtml(payload);
  } catch (error) {
    body.innerHTML = '<p class="tariff-profit-missing">' + esc(error.message || 'Bağlantı hatası') + '</p>';
  }
}

function money(value) {
  if (value === '' || value === null || value === undefined) return '—';
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(Number(value) || 0);
}

function esc(value) { return C.esc(value); }
function escAttr(value) { return C.escAttr(value); }
function hrefAttr(url) { return escAttr(url).replace(/&amp;/g, '&'); }


const bootstrapEl = document.getElementById('bootstrap');
window.loadWorkspaceStatus = loadWorkspaceStatus;
if (bootstrapEl) {
  initTariffPage(JSON.parse(bootstrapEl.textContent));
}
