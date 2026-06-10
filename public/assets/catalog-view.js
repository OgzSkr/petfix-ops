'use strict';

window.CatalogView = (function catalogViewModule() {
  const C = window.BuyBoxCommon;

  let DATA = [];
  let activeView = 'all';
  let currentPage = 1;
  let pageSize = 10;
  let lastFilterFingerprint = '';
  let loaded = false;
  let toastTimer;

  const el = (id) => document.getElementById(id);

  function invalidate() {
    loaded = false;
  }

  function init() {
    applyCatalogTabFromQuery();
    bindUi();
  }

  function applyCatalogTabFromQuery() {
    const tab = new URLSearchParams(window.location.search).get('catalogTab');
    if (!tab || !['all', 'loss', 'missing', 'profit'].includes(tab)) return;
    activeView = tab;
    document.querySelectorAll('.catalog-tab').forEach((button) => {
      button.classList.toggle('active', button.dataset.catalogView === tab);
    });
  }

  function syncCatalogTabQueryParam() {
    const params = new URLSearchParams(window.location.search);
    if (activeView && activeView !== 'all') params.set('catalogTab', activeView);
    else params.delete('catalogTab');
    const qs = params.toString();
    history.replaceState(null, '', qs ? window.location.pathname + '?' + qs : window.location.pathname);
  }

  function bindUi() {
    document.querySelectorAll('.catalog-tab').forEach((button) => {
      button.addEventListener('click', () => {
        activeView = button.dataset.catalogView || 'all';
        document.querySelectorAll('.catalog-tab').forEach((item) => item.classList.remove('active'));
        button.classList.add('active');
        syncCatalogTabQueryParam();
        renderRows();
      });
    });

    el('catalogSearch')?.addEventListener('input', renderRows);
    el('catalogFilterBrand')?.addEventListener('change', renderRows);
    el('catalogFilterRank')?.addEventListener('change', renderRows);
    el('catalogSortBy')?.addEventListener('change', renderRows);
    el('catalogFilterMissingCost')?.addEventListener('change', renderRows);
    el('catalogFilterWithBuybox')?.addEventListener('change', renderRows);
    el('catalogClearFilters')?.addEventListener('click', clearFilters);
    el('catalogPageSize')?.addEventListener('change', () => {
      pageSize = parsePageSize(el('catalogPageSize')?.value);
      currentPage = 1;
      renderRows();
    });
    el('catalogPageNav')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-page-action]');
      if (!button || button.disabled) return;
      if (button.dataset.pageAction === 'prev') currentPage -= 1;
      if (button.dataset.pageAction === 'next') currentPage += 1;
      renderRows();
      el('catalogTableWrap')?.scrollTo({ top: 0, behavior: 'smooth' });
    });
    el('catalogSyncBtn')?.addEventListener('click', syncBuyboxCache);
    el('catalogPanel')?.addEventListener('click', handlePanelClick);

    window.matchMedia('(max-width: 768px)').addEventListener('change', renderRows);
  }

  function handlePanelClick(event) {
    const refreshBtn = event.target.closest('[data-catalog-action="refresh"]');
    if (refreshBtn) {
      event.preventDefault();
      refreshSingleBuybox(refreshBtn.dataset.barcode, refreshBtn);
      return;
    }
    const trackBtn = event.target.closest('[data-catalog-action="track"]');
    if (trackBtn) {
      event.preventDefault();
      const row = DATA.find((item) => String(item.barcode) === String(trackBtn.dataset.barcode));
      if (row?.autoTracked) removeAutoTrack(row.barcode, trackBtn);
      else addAutoTrack(trackBtn.dataset.barcode, trackBtn);
    }
  }

  async function ensureLoaded(force = false) {
    if (loaded && !force) {
      renderRows();
      return;
    }
    await refreshData();
  }

  async function refreshData() {
    const response = await C.authFetch('/api/dashboard');
    if (!response.ok) throw new Error('Katalog verisi alınamadı');
    const payload = await response.json();
    DATA = payload.rows || [];
    loaded = true;
    applySummary(payload);
    populateBrandFilter();
    renderRows();
    return payload;
  }

  function applySummary(payload) {
    const summary = payload.summary || {};
    setText('catalogMetricTracked', summary.trackedProducts);
    setText('catalogMetricProfitable', summary.profitable);
    setText('catalogMetricLoss', summary.loss);
    setText('catalogMetricMissing', summary.missingData);
    setText('catalogMetricTotalProfit', money(summary.totalNetProfit));

    const liveEl = el('catalogMetricLive');
    const liveLabel = el('catalogMetricLiveLabel');
    if (liveEl && liveLabel && payload.liveStatus) {
      liveEl.className = 'ops-summary-item ' + liveMetricClass(payload.liveStatus);
      liveLabel.textContent = liveLabelText(payload.liveStatus);
    }
  }

  function setText(id, value) {
    const node = el(id);
    if (node) node.textContent = String(value ?? '—');
  }

  function liveMetricClass(status) {
    if (status.live) return 'ops-summary-item--ok';
    return status.configured ? 'ops-summary-item--warn' : 'ops-summary-item--danger';
  }

  function liveLabelText(status) {
    if (status.live) return 'Canlı';
    if (!status.configured) return 'Eksik';
    return 'Bekliyor';
  }

  function populateBrandFilter() {
    const select = el('catalogFilterBrand');
    if (!select) return;
    const current = select.value;
    const brands = [...new Set(DATA.map((row) => String(row.brand || '').trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'tr'));
    select.innerHTML = '<option value="">Tüm markalar</option>' +
      brands.map((brand) => '<option value="' + escAttr(brand) + '">' + esc(brand) + '</option>').join('');
    if (current && brands.includes(current)) select.value = current;
  }

  function clearFilters() {
    if (el('catalogSearch')) el('catalogSearch').value = '';
    if (el('catalogFilterBrand')) el('catalogFilterBrand').value = '';
    if (el('catalogFilterRank')) el('catalogFilterRank').value = '';
    if (el('catalogSortBy')) el('catalogSortBy').value = 'netProfit';
    if (el('catalogFilterMissingCost')) el('catalogFilterMissingCost').checked = false;
    if (el('catalogFilterWithBuybox')) el('catalogFilterWithBuybox').checked = false;
    currentPage = 1;
    renderRows();
  }

  function parsePageSize(value) {
    const size = Number(value);
    return [10, 25, 50, 100].includes(size) ? size : 10;
  }

  function filterFingerprint() {
    return [
      activeView,
      el('catalogSearch')?.value || '',
      el('catalogFilterBrand')?.value || '',
      el('catalogFilterRank')?.value || '',
      el('catalogSortBy')?.value || '',
      el('catalogFilterMissingCost')?.checked ? '1' : '0',
      el('catalogFilterWithBuybox')?.checked ? '1' : '0'
    ].join('|');
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
    const sortKey = el('catalogSortBy')?.value || 'netProfit';
    const sorted = rows.slice();
    sorted.sort((a, b) => {
      if (sortKey === 'title') return String(a.title || '').localeCompare(String(b.title || ''), 'tr');
      if (sortKey === 'updatedAt') return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
      if (sortKey === 'buyboxOrder') {
        const safe = (value) => {
          const rank = Number(value);
          return Number.isFinite(rank) && rank > 0 ? rank : 9999;
        };
        return safe(a.buyboxOrder) - safe(b.buyboxOrder);
      }
      if (sortKey === 'buyboxPrice') return (Number(b.buyboxPrice) || 0) - (Number(a.buyboxPrice) || 0);
      if (sortKey === 'netProfitDesc') return (Number(b.netProfit) || -Infinity) - (Number(a.netProfit) || -Infinity);
      return (Number(a.netProfit) || -Infinity) - (Number(b.netProfit) || -Infinity);
    });
    return sorted;
  }

  function filteredRows() {
    const query = (el('catalogSearch')?.value || '').trim().toLocaleLowerCase('tr-TR');
    const brand = el('catalogFilterBrand')?.value || '';
    const rankFilter = el('catalogFilterRank')?.value || '';
    const missingCostOnly = Boolean(el('catalogFilterMissingCost')?.checked);
    const withBuyboxOnly = Boolean(el('catalogFilterWithBuybox')?.checked);

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
    return { pageRows: rows.slice(start, end), totalFiltered, totalPages, start, end };
  }

  function renderPaginationMeta(meta, dataTotal) {
    const rowCountEl = el('catalogRowCount');
    const pageNavEl = el('catalogPageNav');
    const { totalFiltered, totalPages, start, end } = meta;

    if (rowCountEl) {
      if (!totalFiltered) {
        rowCountEl.textContent = dataTotal ? 'Filtreye uygun kayıt yok' : 'Kayıt bulunamadı';
      } else if (totalFiltered <= pageSize) {
        rowCountEl.textContent = totalFiltered === dataTotal
          ? totalFiltered + ' kayıt'
          : totalFiltered + ' / ' + dataTotal + ' kayıt';
      } else {
        const range = (start + 1) + '–' + end;
        rowCountEl.textContent = totalFiltered === dataTotal
          ? range + ' / ' + totalFiltered + ' kayıt'
          : range + ' / ' + totalFiltered + ' kayıt (toplam ' + dataTotal + ')';
      }
    }

    if (!pageNavEl) return;
    if (totalFiltered <= pageSize) {
      pageNavEl.innerHTML = totalFiltered ? '<span class="page-status">Sayfa 1 / 1</span>' : '';
      return;
    }
    pageNavEl.innerHTML =
      '<button type="button" data-page-action="prev"' + (currentPage <= 1 ? ' disabled' : '') + '>Önceki</button>' +
      '<span class="page-status">Sayfa ' + currentPage + ' / ' + totalPages + '</span>' +
      '<button type="button" data-page-action="next"' + (currentPage >= totalPages ? ' disabled' : '') + '>Sonraki</button>';
  }

  function isMobileLayout() {
    return window.matchMedia('(max-width: 768px)').matches;
  }

  function renderRows() {
    const rowsEl = el('catalogRows');
    const cardsEl = el('catalogCards');
    const tableWrap = el('catalogTableWrap');
    if (!rowsEl) return;

    const allFiltered = filteredRows();
    const meta = paginateRows(allFiltered);
    const rows = meta.pageRows;
    const total = DATA.length;

    renderPaginationMeta(meta, total);

    if (tableWrap) tableWrap.hidden = isMobileLayout();
    if (cardsEl) cardsEl.hidden = !isMobileLayout();

    if (isMobileLayout() && cardsEl) {
      cardsEl.innerHTML = rows.length
        ? rows.map(renderCard).join('')
        : '<div class="catalog-empty">Kayıt bulunamadı.</div>';
      rowsEl.innerHTML = '';
      return;
    }

    rowsEl.innerHTML = rows.length
      ? rows.map(renderRow).join('')
      : '<tr><td colspan="10" class="catalog-empty">Kayıt bulunamadı.</td></tr>';
    if (cardsEl) cardsEl.innerHTML = '';
  }

  function productUrlFor(row) {
    return String(row.productUrl || '').trim();
  }

  function productThumbHtml(row) {
    const src = row.imageUrl
      ? row.imageUrl
      : '/api/product-thumb-img?barcode=' + encodeURIComponent(row.barcode);
    const img = '<img class="catalog-product-thumb" src="' + escAttr(src) + '" alt="" loading="lazy" onerror="this.classList.add(\'is-broken\')">';
    const url = productUrlFor(row);
    if (url) {
      return '<a class="catalog-thumb-link" href="' + escAttr(url) + '" target="_blank" rel="noopener noreferrer">' + img + '</a>';
    }
    return img;
  }

  function productCellHtml(row) {
    const url = productUrlFor(row);
    const title = url
      ? '<a class="catalog-product-link" href="' + escAttr(url) + '" target="_blank" rel="noopener noreferrer">' + esc(row.title || 'Ürün') + '</a>'
      : '<span class="catalog-product-link">' + esc(row.title || 'Ürün') + '</span>';
    return '<div class="catalog-product-cell">' +
      productThumbHtml(row) +
      '<div class="catalog-product-body">' +
        title +
        '<span class="catalog-product-meta">' + esc(row.brand || '—') + ' · ' + esc(row.barcode) + '</span>' +
      '</div>' +
    '</div>';
  }

  function commissionCellHtml(row) {
    if (!row.commissionRate) return '<strong>—</strong>';
    const tier = row.commissionTier
      ? '<span class="catalog-tier-tag">' + esc(String(row.commissionTier)) + '. aralık</span>'
      : '';
    const source = row.commissionSource === 'tariff'
      ? '<span class="catalog-tier-source">Tarife</span>'
      : '';
    return '<div class="catalog-commission-cell"><strong>' + esc(formatRate(row.commissionRate)) + '</strong>' + tier + source + '</div>';
  }

  function detailHtml(row) {
    return '<details class="catalog-detail">' +
      '<summary>Detay</summary>' +
      '<ul class="catalog-detail-list">' +
        '<li><span>Sıra</span><strong>' + esc(row.buyboxOrder || '—') + '</strong></li>' +
        '<li><span>Satıcı</span><strong>' + esc(row.buyboxSeller || '—') + '</strong></li>' +
        '<li><span>Son veri</span><strong>' + shortDate(row.updatedAt) + '</strong></li>' +
        (row.currentTsf ? '<li><span>TSF</span><strong>' + money(row.currentTsf) + '</strong></li>' : '') +
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

  function actionsHtml(row) {
    const trackLabel = row.autoTracked ? 'Takipten Çıkar' : 'Takibe Al';
    const trackClass = row.autoTracked ? ' catalog-action-btn--tracked' : '';
    const tariffLink = row.commissionSource === 'tariff'
      ? '<a class="catalog-action-btn catalog-action-btn--link" href="/marketplace/trendyol?barcode=' +
        encodeURIComponent(row.barcode) + '">Tarife\'de aç</a>'
      : '';
    return '<div class="catalog-actions-cell">' +
      '<button type="button" class="catalog-action-btn" data-catalog-action="refresh" data-barcode="' + escAttr(row.barcode) + '">Canlı Güncelle</button>' +
      '<button type="button" class="catalog-action-btn catalog-action-btn--ghost' + trackClass + '" data-catalog-action="track" data-barcode="' + escAttr(row.barcode) + '">' + esc(trackLabel) + '</button>' +
      tariffLink +
    '</div>';
  }

  function numClass(status) {
    if (status === 'KARLI') return 'is-profit';
    if (status === 'ZARAR') return 'is-loss';
    return '';
  }

  function statusBadge(status) {
    if (status === 'KARLI') return '<span class="catalog-badge catalog-badge--profit">Karlı</span>';
    if (status === 'ZARAR') return '<span class="catalog-badge catalog-badge--loss">Zarar</span>';
    return '<span class="catalog-badge catalog-badge--missing">Eksik</span>';
  }

  function renderRow(row) {
    const nc = numClass(row.status);
    return '<tr data-barcode="' + escAttr(row.barcode) + '">' +
      '<td class="col-product">' + productCellHtml(row) + '</td>' +
      '<td class="col-metric"><strong>' + money(row.buyboxPrice) + '</strong>' + buyboxRankBadge(row.buyboxOrder) + '</td>' +
      '<td class="col-metric"><strong>' + money(row.productCost) + '</strong></td>' +
      '<td class="col-metric"><strong>' + esc(String(row.desi ?? '—')) + '</strong></td>' +
      '<td class="col-metric">' + commissionCellHtml(row) + '</td>' +
      '<td class="col-metric ' + nc + '"><strong>' + money(row.netProfit) + '</strong></td>' +
      '<td class="col-metric ' + nc + '"><strong>' + percent(row.profitRate) + '</strong></td>' +
      '<td class="col-metric">' + statusBadge(row.status) + '</td>' +
      '<td class="col-detail">' + detailHtml(row) + '</td>' +
      '<td class="col-actions">' + actionsHtml(row) + '</td>' +
    '</tr>';
  }

  function renderCard(row) {
    const nc = numClass(row.status);
    return '<article class="catalog-mobile-card" data-barcode="' + escAttr(row.barcode) + '">' +
      '<div class="catalog-mobile-head">' + productCellHtml(row) + statusBadge(row.status) + '</div>' +
      '<div class="catalog-mobile-stats">' +
        '<span class="catalog-stat-chip">BuyBox <strong>' + money(row.buyboxPrice) + '</strong></span>' +
        '<span class="catalog-stat-chip">Net <strong class="' + nc + '">' + money(row.netProfit) + '</strong></span>' +
        '<span class="catalog-stat-chip">Kâr % <strong class="' + nc + '">' + percent(row.profitRate) + '</strong></span>' +
      '</div>' +
      actionsHtml(row) +
    '</article>';
  }

  async function refreshSingleBuybox(barcode, button) {
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
      await refreshData();
      if (window.loadWorkspaceStatus) window.loadWorkspaceStatus(true);
      showToast(result.skipped ? 'Az önce güncellendi.' : 'Ürün güncellendi');
    } catch (error) {
      showToast(error.message || 'Bağlantı hatası');
    } finally {
      C.setBusy(button, false);
    }
  }

  async function addAutoTrack(barcode, button) {
    C.setBusy(button, true);
    try {
      const response = await C.authFetch('/api/auto-track', {
        method: 'POST',
        body: JSON.stringify({ barcode, priority: 'normal' })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok === false) {
        showToast(result.error || 'Takibe alınamadı');
        return;
      }
      await refreshData();
      if (window.loadWorkspaceStatus) window.loadWorkspaceStatus(true);
      showToast('Takip listesine eklendi');
    } finally {
      C.setBusy(button, false);
    }
  }

  async function removeAutoTrack(barcode, button) {
    C.setBusy(button, true);
    try {
      const response = await C.authFetch('/api/auto-track/remove', {
        method: 'POST',
        body: JSON.stringify({ barcode })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok === false) {
        showToast(result.error || 'Takipten çıkarılamadı');
        return;
      }
      await refreshData();
      if (window.loadWorkspaceStatus) window.loadWorkspaceStatus(true);
      showToast('Takip listesinden çıkarıldı');
    } finally {
      C.setBusy(button, false);
    }
  }

  async function syncBuyboxCache() {
    const button = el('catalogSyncBtn');
    C.setBusy(button, true);
    try {
      const response = await C.authFetch('/api/sync-buybox-cache', { method: 'POST' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || result.message || 'Senkron başarısız');
      await refreshData();
      showToast(result.message || 'BuyBox cache senkronize edildi');
    } catch (error) {
      showToast(error.message || 'Senkron başarısız');
    } finally {
      C.setBusy(button, false);
    }
  }

  function showToast(message) {
    const toast = document.getElementById('tariffToast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
  }

  function money(value) {
    if (value === '' || value === null || value === undefined) return '—';
    return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(Number(value) || 0);
  }

  function percent(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return new Intl.NumberFormat('tr-TR', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  }

  function formatRate(value) {
    return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(value) || 0) + '%';
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

  function esc(value) { return C.esc(value); }
  function escAttr(value) { return C.escAttr(value); }

  return { init, ensureLoaded, refreshData, invalidate };
})();
