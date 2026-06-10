'use strict';

const TOKEN_KEY = 'platformApiToken';

let DATA = [];
let selectedBarcode = '';
let activeView = 'all';
let toastTimer;
let analyticsLoaded = false;
let tariffTabLoaded = false;
let tariffTabRows = [];
let tariffTabSummary = null;
let currentPage = 1;
let pageSize = 10;
let lastFilterFingerprint = '';
let commissionTariffMeta = { active: false };

const rowsEl = document.getElementById('rows');
const cardsEl = document.getElementById('cards');
const searchEl = document.getElementById('search');
const rowCountEl = document.getElementById('rowCount');
const pageSizeEl = document.getElementById('pageSize');
const pageNavEl = document.getElementById('pageNav');
const buyboxListMetaEl = document.getElementById('buyboxListMeta');
const autotrackPanelEl = document.getElementById('autotrackPanel');
const tariffBannerEl = document.getElementById('tariffBanner');
const productsTableWrap = document.getElementById('productsTableWrap');
const analyticsPanel = document.getElementById('analyticsPanel');
const buyboxFiltersEl = document.getElementById('buyboxFilters');
const filterBrandEl = document.getElementById('filterBrand');
const filterRankEl = document.getElementById('filterRank');
const sortByEl = document.getElementById('sortBy');
const filterMissingCostEl = document.getElementById('filterMissingCost');
const filterWithBuyboxEl = document.getElementById('filterWithBuybox');
const autoTrackListEl = document.getElementById('autoTrackList');
const tariffPanelEl = document.getElementById('tariffPanel');
const dashboardTariffRowsEl = document.getElementById('dashboardTariffRows');
const dashboardTariffSummaryEl = document.getElementById('dashboardTariffSummary');
const dashboardTariffCardsEl = document.getElementById('dashboardTariffCards');
const dashboardTariffTableWrapEl = () => document.querySelector('.dashboard-tariff-table-wrap');

function initDashboard(bootstrap) {
  if (bootstrap.authRequired && !getStoredToken()) {
    redirectToLogin();
    return;
  }

  bindUi();
  applyInitialViewFromQuery();

  if (bootstrap.authRequired) {
    refreshDashboard()
      .then(() => loadAutoTrack())
      .catch(() => redirectToLogin());
    return;
  }

  DATA = bootstrap.rows || [];
  applySummary(bootstrap);
  populateBrandFilter();
  renderRows();
  loadAutoTrack();
}

function applyInitialViewFromQuery() {
  const view = new URLSearchParams(window.location.search).get('view');
  if (!view) return;
  const tab = document.querySelector('.tab[data-view="' + view + '"]');
  if (!tab) return;
  activeView = view;
  document.querySelectorAll('.tab').forEach((item) => item.classList.remove('active'));
  tab.classList.add('active');
  updateViewDisplay();
}

function bindUi() {
  document.querySelectorAll('.tab').forEach((button) => {
    button.addEventListener('click', () => {
      activeView = button.dataset.view;
      document.querySelectorAll('.tab').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      updateViewDisplay();
    });
  });

  searchEl.addEventListener('input', () => {
    if (isTableView(activeView)) renderRows();
  });

  filterBrandEl?.addEventListener('change', () => renderRows());
  filterRankEl?.addEventListener('change', () => renderRows());
  sortByEl?.addEventListener('change', () => renderRows());
  filterMissingCostEl?.addEventListener('change', () => renderRows());
  filterWithBuyboxEl?.addEventListener('change', () => renderRows());
  document.getElementById('clearBuyboxFilters')?.addEventListener('click', clearBuyboxFilters);

  pageSizeEl?.addEventListener('change', () => {
    pageSize = parsePageSize(pageSizeEl.value);
    currentPage = 1;
    renderRows();
  });

  pageNavEl?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-page-action]');
    if (!button || button.disabled) return;
    if (button.dataset.pageAction === 'prev') currentPage -= 1;
    if (button.dataset.pageAction === 'next') currentPage += 1;
    renderRows();
    productsTableWrap?.scrollTo({ top: 0, behavior: 'smooth' });
  });

  document.getElementById('syncBtn').addEventListener('click', syncBuybox);
  document.getElementById('addTrackBtn').addEventListener('click', addAutoTrack);
  document.getElementById('removeTrackBtn')?.addEventListener('click', removeAutoTrack);
  document.getElementById('dashboardTariffRefreshBtn')?.addEventListener('click', refreshDashboardMissingBuybox);

  const refreshAnalyticsBtn = document.getElementById('refreshAnalyticsBtn');
  const analyticsDays = document.getElementById('analyticsDays');
  if (refreshAnalyticsBtn) {
    refreshAnalyticsBtn.addEventListener('click', () => loadAnalytics(true));
  }
  if (analyticsDays) {
    analyticsDays.addEventListener('change', () => loadAnalytics(true));
  }

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', logout);
  }

  window.BuyBoxCommon?.initPlatformNav?.();

  bindBuyboxTableEvents();

  window.matchMedia('(max-width: 768px)').addEventListener('change', () => {
    if (activeView === 'tariff') renderDashboardTariffRows();
    if (isTableView(activeView)) renderRows();
  });
}

function bindBuyboxTableEvents() {
  if (!document.body.dataset.buyboxActionsBound) {
    document.body.dataset.buyboxActionsBound = '1';
    document.body.addEventListener('click', (event) => {
      const refreshBtn = event.target.closest('[data-action="refresh"]');
      if (refreshBtn) {
        event.preventDefault();
        event.stopPropagation();
        refreshSingleBuybox(refreshBtn.dataset.barcode, refreshBtn);
        return;
      }
      const trackBtn = event.target.closest('[data-action="track"]');
      if (trackBtn) {
        event.preventDefault();
        event.stopPropagation();
        const row = DATA.find((item) => String(item.barcode) === String(trackBtn.dataset.barcode));
        fillTrackForm(trackBtn.dataset.barcode);
        if (row?.autoTracked) {
          removeAutoTrack(row.barcode);
        } else {
          addAutoTrack(row?.barcode || trackBtn.dataset.barcode);
        }
      }
    });
  }
}

function fillTrackForm(barcode) {
  const row = DATA.find((item) => String(item.barcode) === String(barcode));
  if (!row) return;
  selectedBarcode = String(barcode);
  const trackBarcodeEl = document.getElementById('trackBarcode');
  const trackPriorityEl = document.getElementById('trackPriority');
  if (trackBarcodeEl) trackBarcodeEl.value = row.barcode || '';
  if (trackPriorityEl) trackPriorityEl.value = row.autoPriority || 'normal';
}

function isTableView(view) {
  return !['analytics', 'autotrack', 'tariff'].includes(view);
}

function isMobileBuyboxLayout() {
  return window.matchMedia('(max-width: 768px)').matches;
}

function updateViewDisplay() {
  const isAnalytics = activeView === 'analytics';
  const isAutotrack = activeView === 'autotrack';
  const isTariff = activeView === 'tariff';
  const isTable = isTableView(activeView);

  if (productsTableWrap) productsTableWrap.hidden = !isTable;
  if (cardsEl) cardsEl.hidden = !isTable;
  if (buyboxListMetaEl) buyboxListMetaEl.hidden = !isTable;
  if (searchEl) searchEl.hidden = !isTable;
  if (buyboxFiltersEl) buyboxFiltersEl.hidden = !isTable;
  if (analyticsPanel) analyticsPanel.hidden = !isAnalytics;
  if (autotrackPanelEl) autotrackPanelEl.hidden = !isAutotrack;
  if (tariffPanelEl) tariffPanelEl.hidden = !isTariff;

  if (isAnalytics && !analyticsLoaded) {
    loadAnalytics(false);
  }
  if (isAutotrack) {
    loadAutoTrack();
  }
  if (isTariff) {
    loadTariffTab(false);
  }
  if (isTable) {
    renderRows();
  }
}

function formatTariffRange(from, to) {
  if (!from || !to) return '—';
  return formatDate(from) + ' → ' + formatDate(to);
}


function clearBuyboxFilters() {
  if (searchEl) searchEl.value = '';
  if (filterBrandEl) filterBrandEl.value = '';
  if (filterRankEl) filterRankEl.value = '';
  if (sortByEl) sortByEl.value = 'netProfit';
  if (filterMissingCostEl) filterMissingCostEl.checked = false;
  if (filterWithBuyboxEl) filterWithBuyboxEl.checked = false;
  currentPage = 1;
  renderRows();
}

function parsePageSize(value) {
  const size = Number(value);
  if ([10, 25, 50, 100].includes(size)) return size;
  return 10;
}

function filterFingerprint() {
  return [
    activeView,
    searchEl?.value || '',
    filterBrandEl?.value || '',
    filterRankEl?.value || '',
    sortByEl?.value || '',
    filterMissingCostEl?.checked ? '1' : '0',
    filterWithBuyboxEl?.checked ? '1' : '0'
  ].join('|');
}

function paginateRows(rows) {
  const fingerprint = filterFingerprint();
  if (fingerprint !== lastFilterFingerprint) {
    currentPage = 1;
    lastFilterFingerprint = fingerprint;
  }

  const totalFiltered = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize) || 1);
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  const start = (currentPage - 1) * pageSize;
  const end = Math.min(start + pageSize, totalFiltered);

  return {
    pageRows: rows.slice(start, end),
    totalFiltered,
    totalPages,
    start,
    end
  };
}

function renderPaginationMeta(meta, dataTotal) {
  const { totalFiltered, totalPages, start, end } = meta;

  if (!rowCountEl) return;

  if (!totalFiltered) {
    rowCountEl.textContent = dataTotal
      ? 'Filtreye uygun kayıt yok'
      : 'Kayıt bulunamadı';
  } else if (totalFiltered <= pageSize) {
    rowCountEl.textContent = totalFiltered === dataTotal
      ? totalFiltered + ' kayıt gösteriliyor'
      : totalFiltered + ' / ' + dataTotal + ' kayıt gösteriliyor';
  } else {
    const range = (start + 1) + '–' + end;
    rowCountEl.textContent = totalFiltered === dataTotal
      ? range + ' / ' + totalFiltered + ' kayıt'
      : range + ' / ' + totalFiltered + ' kayıt (toplam ' + dataTotal + ')';
  }

  if (!pageNavEl) return;

  if (totalFiltered <= pageSize) {
    pageNavEl.innerHTML = totalFiltered
      ? '<span class="page-status">Sayfa 1 / 1</span>'
      : '';
    return;
  }

  pageNavEl.innerHTML =
    '<button type="button" data-page-action="prev"' + (currentPage <= 1 ? ' disabled' : '') + '>Önceki</button>' +
    '<span class="page-status">Sayfa ' + currentPage + ' / ' + totalPages + '</span>' +
    '<button type="button" data-page-action="next"' + (currentPage >= totalPages ? ' disabled' : '') + '>Sonraki</button>';
}

function populateBrandFilter() {
  if (!filterBrandEl) return;
  const current = filterBrandEl.value;
  const brands = [...new Set(DATA.map((row) => String(row.brand || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'tr'));
  filterBrandEl.innerHTML = '<option value="">Tüm markalar</option>' +
    brands.map((brand) => '<option value="' + escAttr(brand) + '">' + esc(brand) + '</option>').join('');
  if (current && brands.includes(current)) {
    filterBrandEl.value = current;
  }
}

function rankMatchesFilter(order, filter) {
  const rank = Number(order);
  if (!filter) return true;
  if (!Number.isFinite(rank) || rank <= 0) return filter === '4+';
  if (filter === '1') return rank === 1;
  if (filter === '2-3') return rank >= 2 && rank <= 3;
  if (filter === '4+') return rank >= 4;
  return true;
}

function sortRows(rows) {
  const sortKey = sortByEl?.value || 'netProfit';
  const sorted = rows.slice();

  sorted.sort((a, b) => {
    if (sortKey === 'title') {
      return String(a.title || '').localeCompare(String(b.title || ''), 'tr');
    }
    if (sortKey === 'updatedAt') {
      return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    }
    if (sortKey === 'buyboxOrder') {
      const av = Number(a.buyboxOrder);
      const bv = Number(b.buyboxOrder);
      const safeA = Number.isFinite(av) && av > 0 ? av : 9999;
      const safeB = Number.isFinite(bv) && bv > 0 ? bv : 9999;
      return safeA - safeB;
    }
    if (sortKey === 'buyboxPrice') {
      return (Number(b.buyboxPrice) || 0) - (Number(a.buyboxPrice) || 0);
    }
    if (sortKey === 'netProfitDesc') {
      return (Number(b.netProfit) || -Infinity) - (Number(a.netProfit) || -Infinity);
    }
    return (Number(a.netProfit) || -Infinity) - (Number(b.netProfit) || -Infinity);
  });

  return sorted;
}

async function loadAnalytics(force = false) {
  const summaryEl = document.getElementById('analyticsSummary');
  const dailyEl = document.getElementById('analyticsDailyPrices');
  const lossEl = document.getElementById('analyticsLossProducts');
  const declineEl = document.getElementById('analyticsProfitDecline');
  const days = document.getElementById('analyticsDays')?.value || '14';

  if (!summaryEl || !dailyEl || !lossEl || !declineEl) return;

  summaryEl.innerHTML = '<p class="analytics-loading">Analitik yükleniyor…</p>';
  dailyEl.innerHTML = '';
  lossEl.innerHTML = '';
  declineEl.innerHTML = '';

  try {
    const response = await authFetch('/api/buybox/analytics?days=' + encodeURIComponent(days));
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      summaryEl.innerHTML = '<p class="analytics-empty">' + esc(data.error || 'Analitik yüklenemedi.') + '</p>';
      return;
    }

    analyticsLoaded = true;
    renderAnalyticsSummary(data, summaryEl);
    renderAnalyticsDailyPrices(data.dailyPriceChanges || [], dailyEl);
    renderAnalyticsLossProducts(data.topLossProducts || [], lossEl);
    renderAnalyticsProfitDecline(data.profitDeclineTrend || [], declineEl);
  } catch (error) {
    summaryEl.innerHTML = '<p class="analytics-empty">' + esc(error.message || 'Bağlantı hatası.') + '</p>';
  }
}

async function loadTariffTab(force = false) {
  if (!dashboardTariffRowsEl || !dashboardTariffSummaryEl) return;
  if (tariffTabLoaded && !force) {
    renderDashboardTariffRows();
    return;
  }

  dashboardTariffSummaryEl.textContent = 'Komisyon tarifesi yükleniyor…';
  dashboardTariffRowsEl.innerHTML = '';

  try {
    const response = await authFetch('/api/commission-tariff/analysis');
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      dashboardTariffSummaryEl.textContent = payload.error || 'Tarife verisi alınamadı.';
      return;
    }

    tariffTabLoaded = true;
    tariffTabRows = payload.rows || [];
    tariffTabSummary = payload.summary || null;
    commissionTariffMeta = payload.meta || commissionTariffMeta;
    renderDashboardTariffRows();
    updateDashboardTariffSummary();
  } catch (error) {
    dashboardTariffSummaryEl.textContent = error.message || 'Bağlantı hatası.';
  }
}

function updateDashboardTariffSummary() {
  if (!dashboardTariffSummaryEl) return;

  if (!commissionTariffMeta?.active) {
    dashboardTariffSummaryEl.innerHTML =
      'Komisyon tarifesi yüklenmedi — <a href="/marketplace/trendyol">Excel yükleyin</a>.';
    return;
  }

  const summary = tariffTabSummary || {};
  dashboardTariffSummaryEl.innerHTML =
    '<strong>' + esc(formatTariffRange(commissionTariffMeta.validFrom, commissionTariffMeta.validTo)) + '</strong>' +
    ' · ' + esc(String(commissionTariffMeta.itemCount || 0)) + ' ürün' +
    ' · BuyBox: <strong>' + esc(String(summary.withBuybox || 0)) + '/' + esc(String(summary.total || 0)) + '</strong>' +
    (summary.missingBuybox ? ' · <span class="dashboard-tariff-missing">' + esc(String(summary.missingBuybox)) + ' eksik</span>' : '') +
    (commissionTariffMeta.selectedCount ? ' · ' + esc(String(commissionTariffMeta.selectedCount)) + ' kademe seçili' : '');
}

function renderDashboardTariffRows() {
  const tableWrap = dashboardTariffTableWrapEl();
  const isMobile = isMobileBuyboxLayout();
  if (tableWrap) tableWrap.hidden = isMobile;
  if (dashboardTariffCardsEl) dashboardTariffCardsEl.hidden = !isMobile;

  if (!commissionTariffMeta?.active) {
    if (dashboardTariffRowsEl) {
      dashboardTariffRowsEl.innerHTML =
        '<tr><td colspan="6" class="muted">Henüz tarife yüklenmedi.</td></tr>';
    }
    if (dashboardTariffCardsEl) {
      dashboardTariffCardsEl.innerHTML = '<div class="empty compact">Henüz tarife yüklenmedi.</div>';
    }
    return;
  }

  if (!tariffTabRows.length) {
    if (dashboardTariffRowsEl) {
      dashboardTariffRowsEl.innerHTML =
        '<tr><td colspan="6" class="muted">Tarife ürünü bulunamadı.</td></tr>';
    }
    if (dashboardTariffCardsEl) {
      dashboardTariffCardsEl.innerHTML = '<div class="empty compact">Tarife ürünü bulunamadı.</div>';
    }
    return;
  }

  if (isMobile && dashboardTariffCardsEl) {
    dashboardTariffCardsEl.innerHTML = tariffTabRows.map(renderDashboardTariffCard).join('');
    return;
  }

  if (!dashboardTariffRowsEl) return;

  dashboardTariffRowsEl.innerHTML = tariffTabRows.map((row) => {
    const buyboxProfit = row.buyboxProfitStatus === 'EKSIK_VERI'
      ? '<span class="badge missing">Eksik veri</span>'
      : row.buyboxPrice
        ? money(row.buyboxNetProfit)
        : '<span class="muted">BuyBox yok</span>';
    const tierLabel = row.selectedTier
      ? esc(String(row.selectedTier)) + '. kademe'
      : '—';
    const status = row.buyboxPrice
      ? (row.buyboxProfitStatus === 'KAR' ? '<span class="badge profit">Karlı</span>'
        : row.buyboxProfitStatus === 'ZARAR' ? '<span class="badge loss">Zarar</span>'
        : '<span class="badge missing">Eksik</span>')
      : '<span class="badge missing">BuyBox yok</span>';

    return '<tr>' +
      '<td class="col-product">' + productCellHtml({
        barcode: row.barcode,
        title: row.title,
        brand: row.brand,
        productUrl: row.productUrl,
        imageUrl: row.imageUrl
      }) + '</td>' +
      '<td>' + money(row.currentTsf) + '</td>' +
      '<td>' + (row.buyboxPrice ? money(row.buyboxPrice) + ' · ' + esc(String(row.buyboxOrder || '—')) + '. sıra' : '—') + '</td>' +
      '<td>' + buyboxProfit + '</td>' +
      '<td>' + tierLabel + '</td>' +
      '<td>' + status + '</td>' +
    '</tr>';
  }).join('');
}

function renderDashboardTariffCard(row) {
  const buyboxProfit = row.buyboxProfitStatus === 'EKSIK_VERI'
    ? '<span class="badge missing">Eksik veri</span>'
    : row.buyboxPrice
      ? money(row.buyboxNetProfit)
      : '<span class="muted">BuyBox yok</span>';

  return '<article class="buybox-card dashboard-tariff-card">' +
    '<div class="card-head">' +
      '<div class="buybox-card-product">' + productThumbHtml(row) +
        '<div><p class="card-title">' + esc(row.title || '—') + '</p>' +
        '<p class="card-brand">' + esc(row.brand || '—') + ' · ' + esc(row.barcode) + '</p></div>' +
      '</div>' +
      (row.selectedTier ? '<span class="buybox-stat-chip">Kademe ' + esc(String(row.selectedTier)) + '</span>' : '') +
    '</div>' +
    '<div class="buybox-card-metrics buybox-card-metrics--chips">' +
      '<span class="buybox-stat-chip">TSF <strong>' + money(row.currentTsf) + '</strong></span>' +
      '<span class="buybox-stat-chip">BB <strong>' + money(row.buyboxPrice) + '</strong></span>' +
      '<span class="buybox-stat-chip">Kâr ' + buyboxProfit + '</span>' +
    '</div>' +
  '</article>';
}

async function refreshDashboardMissingBuybox() {
  const button = document.getElementById('dashboardTariffRefreshBtn');
  if (button) button.disabled = true;
  showToast('Eksik BuyBox verileri sorgulanıyor...');

  try {
    const response = await authFetch('/api/buybox/refresh-batch', {
      method: 'POST',
      body: JSON.stringify({ missingFromTariff: true, maxCount: 30 })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) {
      showToast(result.error || result.message || 'Toplu güncelleme başarısız');
      return;
    }

    await loadTariffTab(true);
    await refreshDashboard();
    showToast(result.message || 'Toplu güncelleme tamamlandı');
  } catch (error) {
    showToast(error.message || 'Toplu güncelleme bağlantı hatası');
  } finally {
    if (button) button.disabled = false;
  }
}

function renderAnalyticsSummary(data, container) {
  const winPct = percent(data.winRate || 0);
  container.innerHTML =
    '<div class="analytics-stat"><span>BuyBox kazanma oranı</span><strong>' + winPct + '</strong></div>' +
    '<div class="analytics-stat"><span>Kazanma olayı</span><strong>' + esc(data.winCount || 0) + '</strong></div>' +
    '<div class="analytics-stat"><span>Kaybetme olayı</span><strong>' + esc(data.lossCount || 0) + '</strong></div>' +
    '<div class="analytics-stat"><span>Toplam olay</span><strong>' + esc(data.totalEvents || 0) + '</strong></div>' +
    '<div class="analytics-stat"><span>Dönem</span><strong>' + esc(data.rangeDays || 14) + ' gün</strong></div>';
}

function renderAnalyticsDailyPrices(rows, container) {
  if (!rows.length) {
    container.innerHTML = '<p class="analytics-empty">Bu dönemde fiyat değişimi yok.</p>';
    return;
  }

  const maxChanges = Math.max(...rows.map((row) => row.priceChanges || 0), 1);
  container.innerHTML = rows.map((row) => {
    const width = Math.round(((row.priceChanges || 0) / maxChanges) * 100);
    return '<div class="analytics-bar-row">' +
      '<span>' + esc(row.date) + '</span>' +
      '<div class="analytics-bar-track"><div class="analytics-bar-fill" style="width:' + width + '%"></div></div>' +
      '<span>' + esc(row.priceChanges) + ' · ' + money(row.avgDelta) + '</span>' +
    '</div>';
  }).join('');
}

function renderAnalyticsLossProducts(rows, container) {
  if (!rows.length) {
    container.innerHTML = '<p class="analytics-empty">Kaybedilen ürün kaydı yok.</p>';
    return;
  }

  container.innerHTML = '<table class="analytics-table"><thead><tr>' +
    '<th>Ürün</th><th>Kayıp</th><th>Oran</th><th>Sıra</th><th>Fiyat</th>' +
    '</tr></thead><tbody>' +
    rows.map((row) => '<tr>' +
      '<td><strong>' + esc(row.brand) + '</strong><br><span class="muted">' + esc(row.barcode) + '</span></td>' +
      '<td>' + esc(row.lossEvents) + '/' + esc(row.totalEvents) + '</td>' +
      '<td>' + percent(row.lossRate || 0) + '</td>' +
      '<td>' + esc(row.latestBuyboxOrder || '—') + '</td>' +
      '<td>' + money(row.latestBuyboxPrice) + '</td>' +
    '</tr>').join('') +
    '</tbody></table>';
}

function renderAnalyticsProfitDecline(rows, container) {
  if (!rows.length) {
    container.innerHTML = '<p class="analytics-empty">Kâr düşüş trendi tespit edilmedi.</p>';
    return;
  }

  container.innerHTML = '<table class="analytics-table"><thead><tr>' +
    '<th>Ürün</th><th>Net kâr Δ</th><th>İlk</th><th>Son</th><th>Fiyat Δ</th>' +
    '</tr></thead><tbody>' +
    rows.map((row) => '<tr>' +
      '<td><strong>' + esc(row.brand) + '</strong><br><span class="muted">' + esc(row.barcode) + '</span></td>' +
      '<td class="num-loss">' + money(row.profitDelta) + '</td>' +
      '<td>' + money(row.firstNetProfit) + '</td>' +
      '<td>' + money(row.lastNetProfit) + '</td>' +
      '<td>' + money(row.firstPrice) + ' → ' + money(row.lastPrice) + '</td>' +
    '</tr>').join('') +
    '</tbody></table>';
}

function filteredRows() {
  const query = searchEl.value.trim().toLocaleLowerCase('tr-TR');
  const brand = filterBrandEl?.value || '';
  const rankFilter = filterRankEl?.value || '';
  const missingCostOnly = Boolean(filterMissingCostEl?.checked);
  const withBuyboxOnly = Boolean(filterWithBuyboxEl?.checked);

  const rows = DATA.filter((row) => {
    const viewMatch =
      activeView === 'all' ||
      (activeView === 'loss' && row.status === 'ZARAR') ||
      (activeView === 'missing' && row.status === 'EKSIK_VERI') ||
      (activeView === 'profit' && row.status === 'KARLI');
    const queryMatch = !query || [row.barcode, row.brand, row.title]
      .join(' ')
      .toLocaleLowerCase('tr-TR')
      .includes(query);
    const brandMatch = !brand || String(row.brand || '') === brand;
    const rankMatch = rankMatchesFilter(row.buyboxOrder, rankFilter);
    const missingCostMatch = !missingCostOnly || !Number(row.productCost);
    const buyboxMatch = !withBuyboxOnly || Boolean(row.buyboxPrice);
    return viewMatch && queryMatch && brandMatch && rankMatch && missingCostMatch && buyboxMatch;
  });

  return sortRows(rows);
}

function missingSummary(row) {
  const warnings = row.dataWarnings?.length
    ? row.dataWarnings
    : (row.missing || []);
  return warnings.length ? warnings.join(' · ') : '';
}

function hrefAttr(value) {
  return String(value ?? '').replace(/"/g, '&quot;');
}

function productUrlFor(row) {
  return String(row.productUrl || '').trim();
}

function productThumbHtml(row) {
  const src = row.imageUrl
    ? row.imageUrl
    : '/api/product-thumb-img?barcode=' + encodeURIComponent(row.barcode);
  const img = '<img class="buybox-product-thumb" src="' + escAttr(src) + '" alt="" loading="lazy" onerror="this.classList.add(\'is-broken\')">';
  const url = productUrlFor(row);
  if (url) {
    return '<a class="buybox-thumb-link" href="' + hrefAttr(url) + '" target="_blank" rel="noopener noreferrer" title="Trendyol\'da aç">' + img + '</a>';
  }
  return img;
}

function productCellHtml(row) {
  const url = productUrlFor(row);
  const title = url
    ? '<a class="buybox-product-link" href="' + hrefAttr(url) + '" target="_blank" rel="noopener noreferrer" title="Trendyol\'da aç">' + esc(row.title || 'Ürün') + '</a>'
    : '<span class="buybox-product-link is-static">' + esc(row.title || 'Ürün') + '</span>';

  return '<div class="buybox-product-cell">' +
    productThumbHtml(row) +
    '<div class="buybox-product-body">' +
      title +
      '<span class="buybox-product-meta">' + esc(row.brand || '—') + ' · ' + esc(row.barcode) + '</span>' +
    '</div>' +
  '</div>';
}

function commissionCellHtml(row) {
  if (!row.commissionRate) return '<strong>—</strong>';
  const tier = row.commissionTier
    ? '<span class="buybox-tier-tag">' + esc(String(row.commissionTier)) + '. aralık</span>'
    : '';
  const source = row.commissionSource === 'tariff'
    ? '<span class="buybox-tier-source">BuyBox tarife</span>'
    : '';
  return '<div class="buybox-commission-cell"><strong>' + esc(formatRate(row.commissionRate)) + '</strong>' + tier + source + '</div>';
}

function formatRate(value) {
  return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(value) || 0) + '%';
}

function detailHtml(row) {
  const missing = missingSummary(row);
  const commissionDetail = row.commissionRate
    ? esc(formatRate(row.commissionRate)) +
      (row.commissionTier ? ' · ' + esc(String(row.commissionTier)) + '. aralık' : '') +
      (row.commissionSource === 'tariff' ? ' · BuyBox tarifesi' : '')
    : '—';
  return '<details class="buybox-detail">' +
    '<summary>Detay</summary>' +
    '<ul class="buybox-detail-list">' +
      '<li><span>Sıra</span><strong>' + esc(row.buyboxOrder || '—') + '</strong></li>' +
      '<li><span>Satıcı</span><strong>' + esc(row.buyboxSeller || '—') + '</strong></li>' +
      '<li><span>Son veri</span><strong>' + shortDate(row.updatedAt) + '</strong></li>' +
      '<li><span>Komisyon</span><strong>' + commissionDetail + '</strong></li>' +
      (row.currentTsf ? '<li><span>TSF</span><strong>' + money(row.currentTsf) + '</strong></li>' : '') +
      (missing ? '<li class="buybox-detail-warn"><span>Eksik</span><strong>' + esc(missing) + '</strong></li>' : '') +
      (row.recommendedAction ? '<li><span>Öneri</span><strong>' + esc(row.recommendedAction) + '</strong></li>' : '') +
    '</ul>' +
  '</details>';
}

function buyboxRankBadge(order) {
  const rank = Number(order);
  if (!Number.isFinite(rank) || rank <= 0) return '';
  let tone = 'mid';
  if (rank === 1) tone = 'win';
  else if (rank <= 3) tone = 'good';
  else if (rank >= 4) tone = 'low';
  return '<span class="buybox-rank buybox-rank--' + tone + '">' + esc(String(rank)) + '. sıra</span>';
}

function formatDesi(value) {
  if (value === '' || value === null || value === undefined) return '—';
  return esc(String(value));
}

function renderRows() {
  const allFiltered = filteredRows();
  const meta = paginateRows(allFiltered);
  const rows = meta.pageRows;
  const total = DATA.length;

  renderPaginationMeta(meta, total);

  rowsEl.innerHTML = rows.length
    ? rows.map(renderRow).join('')
    : '<tr><td colspan="10" class="empty">Kayıt bulunamadı.</td></tr>';
  cardsEl.innerHTML = rows.length
    ? rows.map(renderCard).join('')
    : '<div class="empty">Kayıt bulunamadı.</div>';
}

function statusBadge(status) {
  if (status === 'KARLI') return '<span class="badge profit">Karlı</span>';
  if (status === 'ZARAR') return '<span class="badge loss">Zarar</span>';
  return '<span class="badge missing">Eksik</span>';
}

function numClass(status) {
  if (status === 'KARLI') return 'num-profit';
  if (status === 'ZARAR') return 'num-loss';
  return 'num-missing';
}

function renderRow(row) {
  const nc = numClass(row.status);
  return '<tr data-barcode="' + escAttr(row.barcode) + '">' +
    '<td class="col-product">' + productCellHtml(row) + '</td>' +
    '<td class="col-metric buybox-metric buybox-metric--price"><strong>' + money(row.buyboxPrice) + '</strong>' + buyboxRankBadge(row.buyboxOrder) + '</td>' +
    '<td class="col-metric buybox-metric"><strong>' + money(row.productCost) + '</strong></td>' +
    '<td class="col-metric buybox-metric"><strong>' + formatDesi(row.desi) + '</strong></td>' +
    '<td class="col-metric buybox-metric">' + commissionCellHtml(row) + '</td>' +
    '<td class="col-metric buybox-metric ' + nc + '"><strong class="buybox-profit-value">' + money(row.netProfit) + '</strong></td>' +
    '<td class="col-metric buybox-metric ' + nc + '"><strong>' + percent(row.profitRate) + '</strong></td>' +
    '<td class="col-metric">' + statusBadge(row.status) + '</td>' +
    '<td class="col-detail">' + detailHtml(row) + '</td>' +
    '<td class="col-actions row-actions">' +
      '<button type="button" class="tiny-btn" data-action="refresh" data-barcode="' + escAttr(row.barcode) + '">Canlı Güncelle</button>' +
      '<button type="button" class="tiny-btn ghost" data-action="track" data-barcode="' + escAttr(row.barcode) + '">' + (row.autoTracked ? 'Takipte' : 'Takibe Al') + '</button>' +
    '</td>' +
  '</tr>';
}

function renderCard(row) {
  const nc = numClass(row.status);
  const url = productUrlFor(row);
  const title = url
    ? '<a class="card-title-link" href="' + hrefAttr(url) + '" target="_blank" rel="noopener noreferrer">' + esc(row.title) + '</a>'
    : '<p class="card-title">' + esc(row.title) + '</p>';
  return '<article class="buybox-card" data-barcode="' + escAttr(row.barcode) + '">' +
    '<div class="card-head">' +
      '<div class="buybox-card-product">' + productThumbHtml(row) +
        '<div>' + title + '<p class="card-brand">' + esc(row.brand) + ' · ' + esc(row.barcode) + '</p></div>' +
      '</div>' +
      statusBadge(row.status) +
    '</div>' +
    '<div class="buybox-card-metrics buybox-card-metrics--chips">' +
      '<span class="buybox-stat-chip">BuyBox <strong>' + money(row.buyboxPrice) + '</strong></span>' +
      '<span class="buybox-stat-chip">Sıra <strong>' + esc(String(row.buyboxOrder || '—')) + '</strong></span>' +
      '<span class="buybox-stat-chip">Maliyet <strong>' + money(row.productCost) + '</strong></span>' +
      '<span class="buybox-stat-chip">Desi <strong>' + formatDesi(row.desi) + '</strong></span>' +
      '<span class="buybox-stat-chip">Komisyon <strong>' + (row.commissionRate ? formatRate(row.commissionRate) : '—') + '</strong></span>' +
      '<span class="buybox-stat-chip ' + nc + '">Net <strong>' + money(row.netProfit) + '</strong></span>' +
      '<span class="buybox-stat-chip ' + nc + '">Kâr % <strong>' + percent(row.profitRate) + '</strong></span>' +
    '</div>' +
    detailHtml(row) +
    '<div class="card-actions">' +
      '<button type="button" class="tiny-btn" data-action="refresh" data-barcode="' + escAttr(row.barcode) + '">Canlı Güncelle</button>' +
      '<button type="button" class="tiny-btn ghost" data-action="track" data-barcode="' + escAttr(row.barcode) + '">' + (row.autoTracked ? 'Takipte' : 'Takibe Al') + '</button>' +
    '</div>' +
  '</article>';
}

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}

function setBusy(button, busy) {
  if (!button) return;
  button.disabled = busy;
}

function getStoredToken() {
  return sessionStorage.getItem(TOKEN_KEY) || '';
}

function redirectToLogin() {
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.href = '/login?next=' + next;
}

function logout() {
  sessionStorage.removeItem(TOKEN_KEY);
  redirectToLogin();
}

function apiHeaders(includeJson = true) {
  const headers = {};
  if (includeJson) headers['Content-Type'] = 'application/json';
  const token = getStoredToken();
  if (token) headers.Authorization = 'Bearer ' + token;
  return headers;
}

async function authFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...apiHeaders(options.body !== undefined), ...options.headers }
  });
  if (response.status === 401) {
    sessionStorage.removeItem(TOKEN_KEY);
    redirectToLogin();
    throw new Error('Yetkisiz');
  }
  return response;
}

async function refreshDashboard() {
  const response = await authFetch('/api/dashboard');
  if (!response.ok) throw new Error('Veri alınamadı');
  const payload = await response.json();
  DATA = payload.rows || [];
  applySummary(payload);
  populateBrandFilter();
  renderRows();
  return payload;
}

function applySummary(payload) {
  const summary = payload.summary || {};
  const map = {
    tracked: summary.trackedProducts,
    profitable: summary.profitable,
    loss: summary.loss,
    missing: summary.missingData
  };

  document.querySelectorAll('[data-metric]').forEach((el) => {
    const key = el.dataset.metric;
    if (key === 'totalProfit') {
      el.querySelector('strong').textContent = money(summary.totalNetProfit);
      return;
    }
    if (map[key] !== undefined) {
      el.querySelector('strong').textContent = map[key];
    }
  });

  const liveEl = document.querySelector('[data-metric="live"]');
  if (liveEl && payload.liveStatus) {
    liveEl.className = 'metric ' + liveMetricClass(payload.liveStatus);
    liveEl.querySelector('strong').textContent = liveLabel(payload.liveStatus);
    liveEl.querySelector('small').textContent = liveDetail(payload.liveStatus);
  }

  document.getElementById('headerUpdated').textContent =
    'Son güncelleme: ' + formatDate(payload.updatedAt);

  const banner = document.getElementById('dataQualityBanner');
  const dq = payload.dataQuality;
  if (banner && dq) {
    if (dq.withWarnings > 0) {
      banner.hidden = false;
      banner.textContent = dq.withWarnings + ' üründe veri uyarısı var (maliyet, desi, komisyon veya eski BuyBox). Eksik Veri sekmesini kontrol edin.';
    } else {
      banner.hidden = true;
      banner.textContent = '';
    }
  }

  commissionTariffMeta = payload.commissionTariff || { active: false };
  if (tariffBannerEl) {
    if (commissionTariffMeta.active) {
      tariffBannerEl.hidden = false;
      tariffBannerEl.innerHTML =
        'Aktif komisyon tarifesi: ' + esc(formatTariffRange(commissionTariffMeta.validFrom, commissionTariffMeta.validTo)) +
        ' · ' + (commissionTariffMeta.itemCount || 0) + ' ürün' +
        (commissionTariffMeta.selectedCount ? ' · ' + commissionTariffMeta.selectedCount + ' kademe seçili' : '') +
        ' · <a href="/marketplace/trendyol">Fiyat &amp; Kâr →</a>';
    } else {
      tariffBannerEl.hidden = false;
      tariffBannerEl.innerHTML =
        'Komisyon tarifesi yüklenmedi — ' +
        '<a href="/marketplace/trendyol">Fiyat &amp; Kâr</a> sayfasından Excel yükleyin.';
    }
  }
}

function liveMetricClass(status) {
  if (status.live) return 'ok';
  return status.configured ? 'warn' : 'bad';
}

function liveLabel(status) {
  if (status.live) return 'Canlı';
  return status.configured ? 'Bekliyor' : 'Eksik';
}

function liveDetail(status) {
  if (!status.configured) {
    return 'Eksik: ' + (status.missingCredentials || []).join(', ');
  }
  if (!status.updatedAt) return 'Cache henüz oluşmadı';
  return 'Son veri: ' + status.ageSeconds + ' sn önce';
}

function formatDate(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('tr-TR', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: 'Europe/Istanbul'
  }).format(new Date(value));
}

function shortDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Istanbul'
  }).format(new Date(value));
}

function priorityLabel(value) {
  return {
    critical: 'Kritik',
    normal: 'Normal',
    low: 'Düşük'
  }[value] || 'Normal';
}

async function syncBuybox() {
  const btn = document.getElementById('syncBtn');
  setBusy(btn, true);
  try {
    const response = await authFetch('/api/sync-buybox-cache', { method: 'POST' });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || result.message || 'Senkron başarısız');
    if (result.skipped) {
      showToast(result.message + ' (' + result.cooldownSeconds + ' sn)');
      return;
    }
    await refreshDashboard();
    showToast(result.message || 'BuyBox cache senkronize edildi');
  } catch (error) {
    showToast(error.message || 'Senkron başarısız');
  } finally {
    setBusy(btn, false);
  }
}

async function refreshSingleBuybox(barcode, button) {
  if (!barcode) return;
  setBusy(button, true);
  showToast('Canlı BuyBox sorgulanıyor...');

  try {
    const response = await authFetch('/api/buybox/refresh', {
      method: 'POST',
      body: JSON.stringify({ barcode })
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok || result.ok === false) {
      showToast(result.error || result.message || 'Canlı güncelleme başarısız');
      return;
    }

    await refreshDashboard();
    showToast(result.message || (result.skipped ? 'Az önce güncellendi.' : 'Ürün güncellendi'));
  } catch {
    showToast('Canlı güncelleme bağlantı hatası');
  } finally {
    setBusy(button, false);
  }
}

async function loadAutoTrack() {
  if (!autoTrackListEl) return;
  const response = await authFetch('/api/auto-track');
  if (!response.ok) return;
  const payload = await response.json();
  renderAutoTrack(payload.rows || []);
}

function renderAutoTrack(rows) {
  if (!autoTrackListEl) return;
  autoTrackListEl.innerHTML = rows.length
    ? rows.map((row) => '<article class="track-card">' +
        '<div class="track-card-head">' +
          '<div class="track-card-product">' +
            '<strong>' + esc(row.brand || '—') + '</strong>' +
            '<span>' + esc(row.title || row.barcode) + '</span>' +
            '<small>' + esc(row.barcode) + '</small>' +
          '</div>' +
          '<span class="track-priority-badge track-priority-badge--' + esc(row.priority || 'normal') + '">' + priorityLabel(row.priority) + '</span>' +
        '</div>' +
        '<div class="track-card-metrics">' +
          '<span class="buybox-stat-chip">BuyBox <strong>' + money(row.buyboxPrice) + '</strong></span>' +
          '<span class="buybox-stat-chip">Sıra <strong>' + esc(String(row.buyboxOrder || '—')) + '</strong></span>' +
          '<span class="buybox-stat-chip">Güncelleme <strong>' + shortDate(row.updatedAt) + '</strong></span>' +
        '</div>' +
        (row.lastError ? '<p class="track-error">' + esc(row.lastError) + '</p>' : '') +
        '<div class="track-card-actions">' +
          '<button type="button" class="tiny-btn" data-action="refresh" data-barcode="' + escAttr(row.barcode) + '">Canlı Güncelle</button>' +
          '<button type="button" class="tiny-btn ghost" data-remove-track="' + escAttr(row.barcode) + '">Çıkar</button>' +
        '</div>' +
      '</article>').join('')
    : '<div class="empty compact">Henüz otomatik takip ürünü yok.</div>';
  autoTrackListEl.querySelectorAll('[data-remove-track]').forEach((button) => {
    button.addEventListener('click', () => removeAutoTrack(button.dataset.removeTrack));
  });
}

async function addAutoTrack(barcodeArg) {
  const barcode = String(barcodeArg || document.getElementById('trackBarcode').value || selectedBarcode || '').trim();
  const status = document.getElementById('trackStatus');

  if (!barcode) {
    status.textContent = 'Barkod gerekli.';
    return;
  }

  status.textContent = 'Takip listesine ekleniyor...';
  const response = await authFetch('/api/auto-track', {
    method: 'POST',
    body: JSON.stringify({
      barcode,
      priority: document.getElementById('trackPriority').value
    })
  });
  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    status.textContent = result.error || 'Eklenemedi.';
    return;
  }

  await refreshDashboard();
  await loadAutoTrack();
  fillTrackForm(barcode);
  status.textContent = 'Otomatik takibe alındı.';
  showToast('Ürün otomatik takibe alındı');
}

async function removeAutoTrack(barcodeArg) {
  const barcode = String(barcodeArg || document.getElementById('trackBarcode').value || selectedBarcode || '').trim();
  const status = document.getElementById('trackStatus');

  if (!barcode) {
    status.textContent = 'Barkod gerekli.';
    return;
  }

  status.textContent = 'Takip listesinden çıkarılıyor...';
  const response = await authFetch('/api/auto-track/remove', {
    method: 'POST',
    body: JSON.stringify({ barcode })
  });
  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    status.textContent = result.error || 'Çıkarılamadı.';
    return;
  }

  await refreshDashboard();
  await loadAutoTrack();
  fillTrackForm(barcode);
  status.textContent = 'Otomatik takipten çıkarıldı.';
  showToast('Ürün otomatik takipten çıkarıldı');
}

function money(value) {
  if (value === '' || value === null || value === undefined) return '—';
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(Number(value) || 0);
}

function percent(value) {
  if (value === '' || value === null || value === undefined) return '—';
  return new Intl.NumberFormat('tr-TR', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) || 0);
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
}

function escAttr(value) {
  return esc(value).replace(/"/g, '&quot;');
}

const bootstrapEl = document.getElementById('bootstrap');
if (bootstrapEl) {
  initDashboard(JSON.parse(bootstrapEl.textContent));
}
