'use strict';

/** Ana Ürün Havuzu — yoğun tablo, sekmeler, filtreler, kolon özelleştirme */
(function () {
  const STORAGE_KEY = 'petfix.masterPool.columns.v1';

  const POOL_TABS = [
    { id: 'all', label: 'Tüm Ürünler' },
    { id: 'matched', label: 'Eşleşmiş' },
    { id: 'pending', label: 'Eşleşme Bekleyen' },
    { id: 'missing_master', label: "BenimPOS'ta Yok" },
    { id: 'data_issues', label: 'Veri Sorunlu' },
    { id: 'passive', label: 'Pasif' }
  ];

  const MATCH_LABELS = {
    all_matched: 'Tüm kanallarda eşleşmiş',
    partial: 'Kısmi eşleşmiş',
    pending: 'Eşleşme bekliyor',
    missing_master: "BenimPOS'ta yok",
    multi_candidate: 'Birden fazla aday',
    none: 'Kanal eşleşmesi yok',
    other: 'İnceleme gerekli'
  };

  const COLUMN_DEFS = [
    { id: 'select', label: 'Seç', fixed: true, default: true },
    { id: 'product', label: 'Ürün bilgisi', fixed: true, default: true, sortKey: 'name' },
    { id: 'barcode', label: 'Barkod', default: false, sortKey: 'barcode' },
    { id: 'stockCode', label: 'Stok kodu', default: false },
    { id: 'brand', label: 'Marka', default: false },
    { id: 'category', label: 'Kategori', default: false },
    { id: 'weight', label: 'Gramaj', default: false },
    { id: 'stock', label: 'Stok', default: true, sortKey: 'stock' },
    { id: 'cost', label: 'Maliyet', default: true, sortKey: 'cost' },
    { id: 'channels', label: 'Kanal eşleşmeleri', default: true },
    { id: 'channelPrices', label: 'Kanal fiyatları', default: false },
    { id: 'matchStatus', label: 'Eşleşme durumu', default: true },
    { id: 'dataQuality', label: 'Veri kalitesi', default: true },
    { id: 'updated', label: 'Son güncelleme', default: true, sortKey: 'updated' },
    { id: 'actions', label: 'İşlem', fixed: true, default: true }
  ];

  const PRESETS = {
    matching: ['select', 'product', 'channels', 'matchStatus', 'dataQuality', 'actions'],
    stock: ['select', 'product', 'stock', 'cost', 'updated', 'actions'],
    price: ['select', 'product', 'cost', 'channelPrices', 'matchStatus', 'actions'],
    quality: ['select', 'product', 'dataQuality', 'stock', 'cost', 'updated', 'actions']
  };

  let deps = null;
  let columnConfig = null;
  const selectedIds = new Set();

  function esc(v) {
    return deps?.esc?.(v) ?? String(v ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function escAttr(v) {
    return deps?.escAttr?.(v) ?? esc(v).replace(/"/g, '&quot;');
  }

  function formatMoney(v) {
    return deps?.formatMoney?.(v) ?? `₺${Number(v || 0).toFixed(2)}`;
  }

  function defaultColumnConfig() {
    return {
      order: COLUMN_DEFS.map((c) => c.id),
      visible: Object.fromEntries(COLUMN_DEFS.map((c) => [c.id, c.default !== false]))
    };
  }

  function loadColumnConfig() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultColumnConfig();
      const parsed = JSON.parse(raw);
      const base = defaultColumnConfig();
      return {
        order: Array.isArray(parsed.order) ? parsed.order.filter((id) => base.order.includes(id)) : base.order,
        visible: { ...base.visible, ...(parsed.visible || {}) }
      };
    } catch {
      return defaultColumnConfig();
    }
  }

  function saveColumnConfig() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(columnConfig));
  }

  function visibleColumns() {
    columnConfig = columnConfig || loadColumnConfig();
    return columnConfig.order
      .filter((id) => columnConfig.visible[id] !== false)
      .map((id) => COLUMN_DEFS.find((c) => c.id === id))
      .filter(Boolean);
  }

  function integrate(h) {
    deps = h;
    columnConfig = loadColumnConfig();
    bindPoolTabs();
    bindFilterToolbar();
    bindToolbar();
    bindColumnModal();
    bindBulkModal();
    readUrlIntoForm();
    document.body.classList.add('matching-master-table-ready');
  }

  function getColCount() {
    return visibleColumns().length || 8;
  }

  function bindPoolTabs() {
    const root = document.getElementById('masterPoolTabs');
    if (!root || root.dataset.bound === '1') return;
    root.dataset.bound = '1';
    root.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-pool-tab]');
      if (!btn) return;
      setPoolTab(btn.dataset.poolTab || 'all');
    });
  }

  function setPoolTab(tabId, { reload = true } = {}) {
    const input = document.getElementById('masterPoolTab');
    if (input) input.value = tabId || 'all';
    document.querySelectorAll('[data-pool-tab]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.poolTab === (tabId || 'all'));
      btn.setAttribute('aria-selected', btn.dataset.poolTab === (tabId || 'all') ? 'true' : 'false');
    });
    deps?.setMasterPage?.(1);
    syncUrlFromForm();
    if (reload) deps?.loadMasterProducts?.();
  }

  function updatePoolTabCounts(tabCounts = {}) {
    document.querySelectorAll('[data-pool-tab]').forEach((btn) => {
      const id = btn.dataset.poolTab;
      const countEl = btn.querySelector('.master-pool-tab-count');
      const count = tabCounts[id];
      if (countEl) countEl.textContent = count != null ? Number(count).toLocaleString('tr-TR') : '—';
    });
  }

  function bindFilterToolbar() {
    document.getElementById('masterFilterApply')?.addEventListener('click', (e) => {
      e.preventDefault();
      deps?.setMasterPage?.(1);
      syncUrlFromForm();
      deps?.loadMasterProducts?.();
    });
    document.getElementById('masterFilterClear')?.addEventListener('click', (e) => {
      e.preventDefault();
      deps?.clearMasterFilters?.();
      setPoolTab('all', { reload: false });
      syncUrlFromForm();
    });
    document.getElementById('masterAdvancedToggle')?.addEventListener('click', () => {
      const panel = document.getElementById('masterAdvancedFilters');
      if (panel) panel.hidden = !panel.hidden;
    });
    const form = document.getElementById('masterFilterForm');
    if (!form) return;
    form.querySelectorAll('select').forEach((el) => {
      el.addEventListener('change', () => {
        deps?.setMasterPage?.(1);
        syncUrlFromForm();
        deps?.loadMasterProducts?.();
      });
    });
    const search = document.getElementById('masterSearch');
    if (search) {
      let timer;
      search.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          deps?.setMasterPage?.(1);
          syncUrlFromForm();
          deps?.loadMasterProducts?.();
        }, 350);
      });
    }
  }

  function bindToolbar() {
    document.getElementById('masterSelectAll')?.addEventListener('change', (e) => {
      const checked = e.target.checked;
      document.querySelectorAll('.master-row-select').forEach((cb) => {
        cb.checked = checked;
        const id = cb.dataset.masterId;
        if (!id) return;
        if (checked) selectedIds.add(id);
        else selectedIds.delete(id);
      });
      updateBulkBar();
    });
    document.getElementById('masterBulkMenu')?.addEventListener('change', (e) => {
      const action = e.target.value;
      e.target.value = '';
      if (action) runBulkAction(action);
    });
    document.getElementById('masterColumnPreset')?.addEventListener('change', (e) => {
      const preset = PRESETS[e.target.value];
      if (!preset) return;
      columnConfig.visible = Object.fromEntries(COLUMN_DEFS.map((c) => [c.id, preset.includes(c.id)]));
      columnConfig.order = [...preset, ...COLUMN_DEFS.map((c) => c.id).filter((id) => !preset.includes(id))];
      saveColumnConfig();
      renderTableHead();
      deps?.loadMasterProducts?.();
      e.target.value = '';
    });
    document.getElementById('masterOpenColumnModal')?.addEventListener('click', openColumnModal);
    document.getElementById('masterPageSizeSelect')?.addEventListener('change', (e) => {
      const hidden = document.getElementById('masterPageSize');
      if (hidden) hidden.value = e.target.value;
      deps?.setMasterPage?.(1);
      syncUrlFromForm();
      deps?.loadMasterProducts?.();
    });
  }

  function syncUrlFromForm() {
    if (!window.history?.replaceState) return;
    const params = deps?.buildMasterFilterParams?.();
    if (!params) return;
    const url = new URL(window.location.href);
    for (const key of [...url.searchParams.keys()]) {
      if (key !== 'tab') url.searchParams.delete(key);
    }
    for (const [k, v] of params.entries()) {
      if (v) url.searchParams.set(k, v);
    }
    url.searchParams.set('tab', 'master');
    window.history.replaceState(null, '', url.pathname + '?' + url.searchParams.toString());
  }

  function readUrlIntoForm() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('tab') && params.get('tab') !== 'master') return;
    const form = document.getElementById('masterFilterForm');
    if (!form) return;
    const setVal = (name, val) => {
      const el = form.elements.namedItem(name) || form.querySelector(`[name="${name}"]`);
      if (el && val != null && val !== '') el.value = val;
    };
    setVal('poolTab', params.get('poolTab') || 'all');
    setVal('q', params.get('q') || params.get('barcode') || '');
    setVal('stockCode', params.get('stockCode') || '');
    setVal('channelCode', params.get('channelCode') || '');
    setVal('brand', params.get('brand') || '');
    setVal('category', params.get('category') || '');
    setVal('mappingChannel', params.get('mappingChannel') || '');
    setVal('mappingStatus', params.get('mappingStatus') || '');
    setVal('matchAggregate', params.get('matchAggregate') || '');
    setVal('stock', params.get('stock') || '');
    setVal('cost', params.get('cost') || '');
    setVal('dataQuality', params.get('dataQuality') || '');
    setVal('variant', params.get('variant') || '');
    setVal('weightMin', params.get('weightMin') || '');
    setVal('weightMax', params.get('weightMax') || '');
    setVal('updatedSince', params.get('updatedSince') || '');
    setVal('priceGap', params.get('priceGap') || '');
    setVal('sort', params.get('sort') || 'name');
    setVal('sortDir', params.get('sortDir') || 'asc');
    setVal('limit', params.get('limit') || '50');
    const pageSizeSelect = document.getElementById('masterPageSizeSelect');
    if (pageSizeSelect) pageSizeSelect.value = params.get('limit') || '50';
    if (params.get('negativeStock') === '1') {
      const cb = document.getElementById('masterNegativeStock');
      if (cb) cb.checked = true;
    }
    setPoolTab(params.get('poolTab') || 'all', { reload: false });
    const page = Number(params.get('page') || 1);
    if (page > 1) deps?.setMasterPage?.(page);
  }

  function productPlaceholder() {
    return '<span class="master-product-thumb master-product-thumb--placeholder" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" width="40" height="40"><path fill="currentColor" d="M4 8h16v11H4V8zm2-2h12l2 2H4l2-2zm4 10.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7z"/></svg></span>';
  }

  function productThumb(row) {
    const barcode = String(row.benimposBarcode || '').trim();
    if (!barcode) return productPlaceholder();
    return `<span class="master-product-thumb">` +
      `<img src="/api/product-thumb-img?barcode=${escAttr(barcode)}" alt="" loading="lazy" width="40" height="40" ` +
      `onerror="this.closest('.master-product-thumb').classList.add('master-product-thumb--broken')">` +
      `</span>`;
  }

  function renderProductCell(row) {
    const name = deps?.masterDisplayName?.(row) || row.name || '—';
    const meta = [
      row.brand ? esc(row.brand) : '',
      row.benimposBarcode ? esc(row.benimposBarcode) : '',
      row.normalizedWeightG ? `${row.normalizedWeightG}g` : '',
      row.stockCode ? esc(row.stockCode) : ''
    ].filter(Boolean).join(' · ');
    return `<div class="master-product-cell">${productThumb(row)}<div class="master-product-cell-body">` +
      `<div class="master-product-cell-name">${esc(name)}</div>` +
      (meta ? `<div class="master-product-cell-meta muted">${meta}</div>` : '') +
      `</div></div>`;
  }

  function channelLogoState(status) {
    if (status === 'manual_confirmed') return 'ok';
    if (['auto_matched', 'pending', 'review_required'].includes(status)) return 'warn';
    if (['missing_master', 'barcode_conflict'].includes(status)) return 'danger';
    return 'none';
  }

  function renderChannelsCell(row) {
    const logos = window.PetFixChannelLogos;
    if (!logos) return '—';
    const details = row.channelMappingDetails || [];
    const detailByChannel = Object.fromEntries(details.map((d) => [d.channelId, d]));
    return `<div class="master-channel-logos">${(deps.SALES_CHANNELS || []).map((channel) => {
      if (channel.status === 'planned') {
        return logos.render(channel.id, { state: 'wait', size: 'sm', title: `${channel.label}: yakında` });
      }
      const status = row.channelMappings?.[channel.id] || 'unmapped';
      const detail = detailByChannel[channel.id];
      const title = [channel.label, `Durum: ${status}`,
        detail?.channelProductId ? `Kod: ${detail.channelProductId}` : null,
        detail?.channelBarcode ? `Barkod: ${detail.channelBarcode}` : null].filter(Boolean).join('\n');
      const passive = row.isOnline === false ? ' master-channel-logo-wrap--passive' : '';
      const state = channelLogoState(status);
      return `<span class="master-channel-logo-wrap${passive}">${logos.render(channel.id, { state, size: 'sm', title })}` +
        (state === 'warn' || state === 'danger' ? '<span class="master-channel-dot"></span>' : '') +
        '</span>';
    }).join('')}</div>`;
  }

  function renderMatchStatusCell(row) {
    const agg = row.matchAggregate || {};
    const code = agg.code || 'other';
    const tone = code === 'all_matched' ? 'ok' : (code === 'missing_master' || code === 'multi_candidate' ? 'danger' : 'warn');
    return `<span class="master-status-pill master-status-pill--${tone}">${esc(MATCH_LABELS[code] || agg.label || '—')}</span>`;
  }

  function renderDataQualityCell(row) {
    const count = (row.actionSummary?.dqIssues || []).length;
    if (!count) return '<span class="master-status-pill master-status-pill--ok">Sorun yok</span>';
    return `<span class="master-status-pill master-status-pill--warn" title="${escAttr((row.actionSummary?.dqIssues || []).join(', '))}">${count} sorun</span>`;
  }

  function renderChannelPricesCell(row) {
    const prices = row.channelPrices || {};
    const parts = Object.entries(prices).slice(0, 4).map(([ch, price]) => {
      const label = window.PetFixChannelLogos?.getVisual?.(ch)?.shortLabel || ch;
      return `<span class="master-price-chip">${esc(label)} ${price > 0 ? formatMoney(price) : '—'}</span>`;
    });
    return parts.length ? `<div class="master-price-chips">${parts.join('')}</div>` : '<span class="muted">—</span>';
  }

  function renderActionsCell(row) {
    return `<div class="master-row-actions">` +
      `<button type="button" class="btn-mini btn-brown btn-master-inspect" data-master-id="${escAttr(row.id)}">Detay</button>` +
      `<details class="master-row-menu"><summary class="btn-mini ghost">İşlemler</summary><div class="master-row-menu-panel">` +
      `<button type="button" data-master-action="inspect" data-master-id="${escAttr(row.id)}">Eşleşmeyi incele</button>` +
      `<button type="button" data-master-action="map" data-master-id="${escAttr(row.id)}">Başka ürüne bağla</button>` +
      `<button type="button" data-master-action="unmap" data-master-id="${escAttr(row.id)}">Eşleşmeyi kaldır</button>` +
      `<button type="button" data-master-action="edit" data-master-id="${escAttr(row.id)}">Veri düzelt</button>` +
      `<button type="button" data-master-action="review" data-master-id="${escAttr(row.id)}">İncelemeye gönder</button>` +
      `<button type="button" data-master-action="passive" data-master-id="${escAttr(row.id)}">Pasife al</button>` +
      `</div></details></div>`;
  }

  function renderCell(colId, row) {
    switch (colId) {
      case 'select':
        return `<input type="checkbox" class="master-row-select" data-master-id="${escAttr(row.id)}" aria-label="Seç"${selectedIds.has(row.id) ? ' checked' : ''}>`;
      case 'product': return renderProductCell(row);
      case 'barcode':
        return `<button type="button" class="linkish master-barcode-btn" data-barcode="${escAttr(row.benimposBarcode)}">${esc(row.benimposBarcode || '—')}</button>`;
      case 'stockCode': return esc(row.stockCode || '—');
      case 'brand': return esc(row.brand || '—');
      case 'category': return esc(row.categoryName || '—');
      case 'weight': return row.normalizedWeightG ? `${row.normalizedWeightG} g` : '<span class="muted">—</span>';
      case 'stock': return `<span class="${Number(row.stock) < 0 ? 'cell-warn' : ''}">${esc(row.stock)}</span>`;
      case 'cost': return Number(row.buyingPrice) > 0 ? formatMoney(row.buyingPrice) : '<span class="muted">—</span>';
      case 'channels': return renderChannelsCell(row);
      case 'channelPrices': return renderChannelPricesCell(row);
      case 'matchStatus': return renderMatchStatusCell(row);
      case 'dataQuality': return renderDataQualityCell(row);
      case 'updated': return deps?.formatMasterUpdated?.(row) || '—';
      case 'actions': return renderActionsCell(row);
      default: return '—';
    }
  }

  function renderTableHead() {
    const headRow = document.getElementById('masterTableHeadRow');
    if (!headRow) return;
    headRow.innerHTML = visibleColumns().map((col) => {
      if (col.id === 'select') {
        return '<th class="col-master-select sticky-col" scope="col"><input type="checkbox" id="masterSelectAll" aria-label="Tümünü seç"></th>';
      }
      const sticky = col.id === 'product' ? ' sticky-col sticky-col-2' : '';
      if (col.sortKey) {
        return `<th class="col-master-${col.id}${sticky}" scope="col"><button type="button" class="master-sort-btn" data-sort-key="${escAttr(col.sortKey)}"><span>${esc(col.label)}</span><span class="master-sort-indicator"></span></button></th>`;
      }
      return `<th class="col-master-${col.id}${sticky}" scope="col">${esc(col.label)}</th>`;
    }).join('');
    deps?.initMasterColumnSort?.();
    bindToolbar();
  }

  function renderRows(rows) {
    const body = document.getElementById('masterProductsBody');
    const mobile = document.getElementById('masterMobileCards');
    const colCount = getColCount();
    if (!body) return;
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="${colCount}" class="matching-loading">Kayıt yok — filtreleri değiştirin.</td></tr>`;
      if (mobile) mobile.innerHTML = '<p class="muted master-mobile-empty">Kayıt yok.</p>';
      return;
    }
    const cols = visibleColumns();
    body.innerHTML = rows.map((row) => {
      const cells = cols.map((col) => {
        const sticky = col.id === 'select' ? ' sticky-col' : (col.id === 'product' ? ' sticky-col sticky-col-2' : '');
        return `<td class="col-master-${col.id}${sticky}">${renderCell(col.id, row)}</td>`;
      }).join('');
      return `<tr data-master-id="${escAttr(row.id)}" class="master-row-clickable master-pool-row" tabindex="0">${cells}</tr>`;
    }).join('');
    if (mobile) {
      mobile.innerHTML = rows.map((row) =>
        `<article class="master-mobile-card" data-master-id="${escAttr(row.id)}">${renderProductCell(row)}` +
        `<div class="master-mobile-card-meta">${renderMatchStatusCell(row)} ${renderDataQualityCell(row)}</div>` +
        `<div class="master-mobile-card-channels">${renderChannelsCell(row)}</div>` +
        `<button type="button" class="btn-mini btn-brown btn-master-inspect" data-master-id="${escAttr(row.id)}">Detay</button></article>`
      ).join('');
    }
    body.querySelectorAll('.master-row-select').forEach((cb) => {
      cb.addEventListener('change', () => {
        if (cb.checked) selectedIds.add(cb.dataset.masterId);
        else selectedIds.delete(cb.dataset.masterId);
        updateBulkBar();
      });
    });
    deps?.initMasterTableDelegation?.();
  }

  function afterListLoad(data) {
    updatePoolTabCounts(data?.summary?.tabCounts || {});
    populateCategoryOptions(data?.categories || []);
    renderTableHead();
    deps?.updateMasterSortHeaders?.();
  }

  function populateCategoryOptions(categories) {
    const select = document.getElementById('masterCategoryFilter');
    if (!select) return;
    const current = select.value;
    select.innerHTML = '<option value="">Kategori: Tümü</option>' +
      categories.map((c) => `<option value="${escAttr(c)}">${esc(c)}</option>`).join('');
    if (current && categories.includes(current)) select.value = current;
  }

  function updateBulkBar() {
    const bar = document.getElementById('masterBulkBar');
    const countEl = document.getElementById('masterBulkCount');
    if (!bar) return;
    bar.hidden = selectedIds.size <= 0;
    if (countEl) countEl.textContent = String(selectedIds.size);
  }

  function runBulkAction(action) {
    if (!selectedIds.size) {
      deps?.showToast?.('Önce ürün seçin.');
      return;
    }
    if (action === 'export') {
      deps?.exportMasterCsv?.({ masterProductIds: [...selectedIds] });
      return;
    }
    openBulkPreview(action, [...selectedIds]);
  }

  function resolveRowsForIds(ids) {
    const cache = deps?.getMasterRowsCache?.() || [];
    const byId = new Map(cache.map((row) => [row.id, row]));
    return ids.map((id) => byId.get(id)).filter(Boolean);
  }

  function openBulkPreview(action, ids) {
    const modal = document.getElementById('masterBulkModal');
    const body = document.getElementById('masterBulkModalBody');
    const title = document.getElementById('masterBulkModalTitle');
    if (!modal || !body) return;
    const labels = {
      confirm: 'Toplu eşleşmeyi onayla',
      review: 'Toplu incelemeye gönder',
      unmap: 'Toplu kanal bağlantısını kaldır',
      passive: 'Toplu pasife al'
    };
    if (title) title.textContent = labels[action] || 'Toplu işlem';
    const rows = resolveRowsForIds(ids);
    const previewItems = rows.slice(0, 8).map((row) => {
      const name = deps?.masterDisplayName?.(row) || row.name || row.id;
      const agg = row.matchAggregate?.label || '';
      return `<li><strong>${esc(name)}</strong>${agg ? `<span class="muted"> · ${esc(agg)}</span>` : ''}</li>`;
    }).join('');
    const hints = {
      confirm: 'Otomatik / bekleyen / kontrol gereken eşleştirmeler manuel onaylı yapılır.',
      unmap: 'Seçili ana ürünlerin tüm kanal eşleştirmeleri kaldırılır.',
      review: 'Manuel kontrol listesine (Gelen Kutusu) yönlendirilirsiniz.',
      passive: 'Pasif durum yalnızca BenimPOS senkronu ile güncellenir.'
    };
    body.innerHTML =
      `<p><strong>${ids.length}</strong> ana ürün seçildi.</p>` +
      `<p class="muted">${esc(hints[action] || '')}</p>` +
      `<ul class="master-bulk-preview-list">${previewItems}` +
      `${ids.length > 8 ? `<li class="muted">+ ${ids.length - 8} ürün daha…</li>` : ''}</ul>`;
    modal.dataset.pendingAction = action;
    modal.dataset.pendingIds = JSON.stringify(ids);
    modal.hidden = false;
  }

  async function executeBulkAction(action, ids) {
    if (action === 'passive') {
      deps?.showToast?.('Pasif durum BenimPOS senkronu ile güncellenir — panelden değiştirilmez.');
      return;
    }
    if (action === 'export') {
      deps?.exportMasterCsv?.({ masterProductIds: ids.length ? ids : [...selectedIds] });
      return;
    }
    const btn = document.getElementById('masterBulkModalConfirm');
    if (btn) btn.disabled = true;
    try {
      const response = await window.BuyBoxCommon.authFetch('/api/product-matching/master-pool-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, masterProductIds: ids })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        deps?.showToast?.(result.error || 'Toplu işlem başarısız.');
        return;
      }
      if (result.redirect && action === 'review') {
        deps?.showToast?.(result.message || 'Gelen Kutusu açılıyor…');
        window.location.href = result.redirect;
        return;
      }
      const note = result.confirmed != null
        ? `${result.confirmed} eşleştirme onaylandı${result.skipped ? ` · ${result.skipped} atlandı` : ''}`
        : (result.removed != null
          ? `${result.removed} eşleştirme kaldırıldı`
          : (result.message || 'Toplu işlem tamamlandı.'));
      deps?.showToast?.(note);
      selectedIds.clear();
      updateBulkBar();
      document.getElementById('masterSelectAll').checked = false;
      await deps?.loadMasterProducts?.();
      deps?.loadOpsSummary?.();
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function bindBulkModal() {
    document.getElementById('masterBulkModalClose')?.addEventListener('click', () => {
      document.getElementById('masterBulkModal').hidden = true;
    });
    document.getElementById('masterBulkModalConfirm')?.addEventListener('click', async () => {
      const modal = document.getElementById('masterBulkModal');
      const action = modal?.dataset.pendingAction;
      let ids = [];
      try {
        ids = JSON.parse(modal?.dataset.pendingIds || '[]');
      } catch {
        ids = [...selectedIds];
      }
      modal.hidden = true;
      if (action && ids.length) await executeBulkAction(action, ids);
    });
  }

  let dragColId = null;

  function reorderColumn(fromId, toId) {
    const order = [...columnConfig.order];
    const fromIdx = order.indexOf(fromId);
    const toIdx = order.indexOf(toId);
    if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
    order.splice(fromIdx, 1);
    order.splice(toIdx, 0, fromId);
    columnConfig.order = order;
  }

  function bindColumnDragList(list) {
    list.querySelectorAll('.master-column-row').forEach((row) => {
      row.draggable = true;
      row.addEventListener('dragstart', (e) => {
        dragColId = row.dataset.colId;
        row.classList.add('master-column-row--dragging');
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      });
      row.addEventListener('dragend', () => {
        row.classList.remove('master-column-row--dragging');
        dragColId = null;
      });
      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        row.classList.add('master-column-row--over');
      });
      row.addEventListener('dragleave', () => {
        row.classList.remove('master-column-row--over');
      });
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.classList.remove('master-column-row--over');
        const targetId = row.dataset.colId;
        if (!dragColId || !targetId || dragColId === targetId) return;
        reorderColumn(dragColId, targetId);
        openColumnModal();
      });
    });
  }

  function moveColumn(id, direction) {
    const idx = columnConfig.order.indexOf(id);
    if (idx < 0) return;
    const next = idx + direction;
    if (next < 0 || next >= columnConfig.order.length) return;
    const order = [...columnConfig.order];
    [order[idx], order[next]] = [order[next], order[idx]];
    columnConfig.order = order;
  }

  function openColumnModal() {
    const modal = document.getElementById('masterColumnModal');
    const list = document.getElementById('masterColumnList');
    if (!modal || !list) return;
    list.innerHTML = columnConfig.order.filter((id) => {
      const col = COLUMN_DEFS.find((c) => c.id === id);
      return col && !col.fixed;
    }).map((id) => {
      const col = COLUMN_DEFS.find((c) => c.id === id);
      return `<div class="master-column-row" data-col-id="${escAttr(id)}" draggable="true">` +
        `<span class="master-column-grip" aria-hidden="true">⠿</span>` +
        `<label class="master-column-toggle"><input type="checkbox" data-col-id="${escAttr(id)}"` +
        `${columnConfig.visible[id] !== false ? ' checked' : ''}> ${esc(col.label)}</label>` +
        `<span class="master-column-move">` +
        `<button type="button" class="btn-mini ghost" data-col-move="-1" aria-label="Yukarı">↑</button>` +
        `<button type="button" class="btn-mini ghost" data-col-move="1" aria-label="Aşağı">↓</button>` +
        `</span></div>`;
    }).join('');
    list.querySelectorAll('[data-col-move]').forEach((btn) => {
      btn.addEventListener('click', () => {
        moveColumn(btn.closest('.master-column-row')?.dataset.colId, Number(btn.dataset.colMove));
        openColumnModal();
      });
    });
    bindColumnDragList(list);
    modal.hidden = false;
  }

  function bindColumnModal() {
    document.getElementById('masterColumnModalClose')?.addEventListener('click', () => {
      document.getElementById('masterColumnModal').hidden = true;
    });
    document.getElementById('masterColumnModalSave')?.addEventListener('click', () => {
      document.querySelectorAll('#masterColumnList [data-col-id]').forEach((cb) => {
        if (cb.type !== 'checkbox') return;
        columnConfig.visible[cb.dataset.colId] = cb.checked;
      });
      saveColumnConfig();
      document.getElementById('masterColumnModal').hidden = true;
      renderTableHead();
      deps?.loadMasterProducts?.();
    });
  }

  function renderPoolTabsHtml() {
    return POOL_TABS.map((tab) =>
      `<button type="button" class="master-pool-tab${tab.id === 'all' ? ' active' : ''}" data-pool-tab="${escAttr(tab.id)}" role="tab">` +
      `${esc(tab.label)} <span class="master-pool-tab-count">—</span></button>`
    ).join('');
  }

  window.MatchingMasterTable = {
    integrate,
    renderRows,
    afterListLoad,
    getColCount,
    getSelectedIds: () => [...selectedIds],
    renderPoolTabsHtml,
    setPoolTab,
    syncUrlFromForm,
    readUrlIntoForm,
    visibleColumns
  };
})();
