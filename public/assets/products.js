'use strict';

const bootstrap = JSON.parse(document.getElementById('bootstrap').textContent);
const costScope = bootstrap.costScope || 'trendyol-marketplace';
const costScopeLabel = bootstrap.costScopeLabel || 'Trendyol Pazaryeri';
const isChannelCostsPage = costScope === 'other-channels';
const tableWrap = document.getElementById('productsTableWrap');
const tableBody = document.getElementById('productsBody');
const footerEl = document.getElementById('productsFooter');
const toastEl = document.getElementById('productsToast');
const filterForm = document.getElementById('filterForm');

let tableScale = 0.75;
let allProductRows = [];
let catalogTotal = 0;
let catalogSummary = {};
let productsPageSize = 10;
let productsPage = 1;
let productsFilteredTotal = 0;

if (bootstrap.authRequired && !getStoredToken()) {
  redirectToLogin();
} else {
  bindEvents();
  applyInitialProductQuery();
  loadProducts();
}

function applyInitialProductQuery() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('emptyCostOnly') === '1') {
    const checkbox = document.getElementById('emptyCostOnly');
    if (checkbox) checkbox.checked = true;
  }
  const barcode = String(params.get('barcode') || '').trim();
  if (barcode) {
    const input = filterForm.querySelector('[name=barcode]');
    if (input) input.value = barcode;
  }
}

function bindEvents() {
  filterForm.addEventListener('submit', (e) => {
    e.preventDefault();
    productsPage = 1;
    renderFromCache();
  });
  filterForm.querySelectorAll('input').forEach((input) => {
    input.addEventListener('input', () => {
      productsPage = 1;
      renderFromCache();
    });
    input.addEventListener('change', () => {
      productsPage = 1;
      renderFromCache();
    });
  });
  document.getElementById('clearFilters').addEventListener('click', clearFilters);
  document.getElementById('refreshData').addEventListener('click', syncFromTrendyol);
  document.getElementById('exportCsv').addEventListener('click', exportCsv);
  document.getElementById('importExcel').addEventListener('click', () => document.getElementById('importExcelFile')?.click());
  document.getElementById('importExcelFile')?.addEventListener('change', importExcelFile);
  document.getElementById('importXml').addEventListener('click', () => showToast('XML yükleme yakında eklenecek.'));
  document.getElementById('zoomOut').addEventListener('click', () => setZoom(tableScale - 0.05));
  document.getElementById('zoomIn').addEventListener('click', () => setZoom(tableScale + 0.05));
  document.getElementById('zoomReset').addEventListener('click', () => setZoom(0.75));

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.addEventListener('click', logout);

  tableBody.addEventListener('input', onFieldInput);
  tableBody.addEventListener('change', onFieldInput);
  tableBody.addEventListener('click', (e) => {
    const btn = e.target.closest('.row-save-btn');
    if (!btn || btn.disabled) return;
    const tr = btn.closest('tr');
    if (tr) saveRow(tr);
  });
  tableBody.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.target.matches('[data-save]')) return;
    e.preventDefault();
    const tr = e.target.closest('tr');
    if (tr && isRowDirty(tr)) saveRow(tr);
  });
}

function getFiltersFromForm() {
  const fd = new FormData(filterForm);
  return {
    title: fd.get('title') || '',
    barcode: fd.get('barcode') || '',
    costVatRate: fd.get('costVatRate') || '',
    brand: fd.get('brand') || '',
    modelCode: fd.get('modelCode') || '',
    color: fd.get('color') || '',
    size: fd.get('size') || '',
    stockMin: fd.get('stockMin') || '',
    stockMax: fd.get('stockMax') || '',
    emptyCostOnly: fd.get('emptyCostOnly') === 'on',
    costMin: fd.get('costMin') || '',
    costMax: fd.get('costMax') || '',
    desiMin: fd.get('desiMin') || '',
    desiMax: fd.get('desiMax') || '',
    returnMin: fd.get('returnMin') || '',
    returnMax: fd.get('returnMax') || ''
  };
}

function filtersToParams(filters) {
  const p = new URLSearchParams();
  p.set('costScope', costScope);
  for (const [k, v] of Object.entries(filters)) {
    if (k === 'emptyCostOnly') { if (v) p.set(k, '1'); continue; }
    if (v !== '' && v !== false) p.set(k, String(v));
  }
  return p;
}

function toNum(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function text(value) {
  return String(value ?? '').trim();
}

function matchesProductFilter(row, filters) {
  const title = text(filters.title).toLocaleLowerCase('tr-TR');
  if (title && !String(row.title || '').toLocaleLowerCase('tr-TR').includes(title)) return false;

  const barcode = text(filters.barcode);
  if (barcode && !String(row.barcode || '').includes(barcode)) return false;

  const brand = text(filters.brand).toLocaleLowerCase('tr-TR');
  if (brand && !String(row.brand || '').toLocaleLowerCase('tr-TR').includes(brand)) return false;

  const modelCode = text(filters.modelCode).toLocaleLowerCase('tr-TR');
  if (modelCode && !String(row.modelCode || '').toLocaleLowerCase('tr-TR').includes(modelCode)) return false;

  const color = text(filters.color).toLocaleLowerCase('tr-TR');
  if (color && color !== '—' && !String(row.color || '').toLocaleLowerCase('tr-TR').includes(color)) return false;

  const size = text(filters.size).toLocaleLowerCase('tr-TR');
  if (size && size !== '—' && !String(row.size || '').toLocaleLowerCase('tr-TR').includes(size)) return false;

  const costVatRate = text(filters.costVatRate);
  if (costVatRate && String(row.costVatRate) !== costVatRate) return false;

  if (filters.emptyCostOnly && row.hasCost) return false;

  const stock = toNum(row.stock);
  const stockMin = toNum(filters.stockMin);
  const stockMax = toNum(filters.stockMax);
  if (stockMin !== null && (stock === null || stock < stockMin)) return false;
  if (stockMax !== null && (stock === null || stock > stockMax)) return false;

  const cost = toNum(row.productCost);
  const costMin = toNum(filters.costMin);
  const costMax = toNum(filters.costMax);
  if (costMin !== null && (cost === null || cost < costMin)) return false;
  if (costMax !== null && (cost === null || cost > costMax)) return false;

  const desi = toNum(row.desi);
  const desiMin = toNum(filters.desiMin);
  const desiMax = toNum(filters.desiMax);
  if (desiMin !== null && (desi === null || desi < desiMin)) return false;
  if (desiMax !== null && (desi === null || desi > desiMax)) return false;

  const returnRate = toNum(row.returnRate);
  const returnMin = toNum(filters.returnMin);
  const returnMax = toNum(filters.returnMax);
  if (returnMin !== null && (returnRate === null || returnRate < returnMin)) return false;
  if (returnMax !== null && (returnRate === null || returnRate > returnMax)) return false;

  return true;
}

function filteredProductRows() {
  const filters = getFiltersFromForm();
  return allProductRows.filter((row) => matchesProductFilter(row, filters));
}

function pageProductRows(rows) {
  productsFilteredTotal = rows.length;
  const totalPages = productsPageSize === 0
    ? 1
    : Math.max(1, Math.ceil(rows.length / productsPageSize));
  if (productsPage > totalPages) productsPage = totalPages;
  if (productsPage < 1) productsPage = 1;

  if (productsPageSize === 0) return rows;
  const start = (productsPage - 1) * productsPageSize;
  return rows.slice(start, start + productsPageSize);
}

function clearFilters() {
  filterForm.reset();
  productsPage = 1;
  renderFromCache();
}

function updateRowInCache(barcode, patch) {
  const idx = allProductRows.findIndex((row) => String(row.barcode) === String(barcode));
  if (idx >= 0) {
    allProductRows[idx] = { ...allProductRows[idx], ...patch };
  }
}

async function syncFromTrendyol() {
  const button = document.getElementById('refreshData');
  if (button) button.disabled = true;
  showToast('Trendyol ürünleri çekiliyor…');

  try {
    const response = await authFetch('/api/products/sync-trendyol', {
      method: 'POST',
      body: JSON.stringify({})
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok || result.ok === false) {
      if (response.status === 404) {
        showToast('Trendyol senkron henüz sunucuda yok — son kodu deploy edin (ops-deploy-vps.sh).');
      } else {
        showToast(result.error || result.message || 'Trendyol senkron başarısız.');
      }
      return;
    }

    await loadProducts();
    showToast(result.message || 'Trendyol katalog güncellendi.');
  } catch (error) {
    showToast(error.message || 'Trendyol senkron bağlantı hatası.');
  } finally {
    if (button) button.disabled = false;
  }
}

async function loadProducts() {
  const params = new URLSearchParams();
  params.set('costScope', costScope);
  params.set('limit', '0');

  const response = await authFetch('/api/products?' + params.toString());
  if (!response.ok) {
    showToast('Ürünler yüklenemedi.');
    return;
  }
  const data = await response.json();
  allProductRows = data.rows || [];
  catalogTotal = Number(data.total) || allProductRows.length;
  catalogSummary = data.summary || {};
  productsPage = 1;
  renderFromCache();
  updateProductsSummary(data);
}

function renderFromCache() {
  const filtered = filteredProductRows();
  const pageRows = pageProductRows(filtered);
  renderTable(pageRows);
  updateProductsSummary({
    summary: catalogSummary,
    filtered: productsFilteredTotal,
    total: catalogTotal
  });
  const shown = pageRows.length;
  footerEl.textContent = shown + ' ürün gösteriliyor (' + productsFilteredTotal + ' filtre sonucu, '
    + costScopeLabel + ' toplam ' + catalogTotal + ')';
}

function updateProductsSummary(data) {
  const summary = data.summary || catalogSummary || {};
  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value ?? '—');
  };
  set('productsSummaryListed', summary.listed ?? '—');
  set('productsSummaryWithCost', summary.withCost ?? '—');
  set('productsSummaryEmptyCost', summary.emptyCost ?? '—');
  set('productsSummaryFiltered', data.filtered ?? productsFilteredTotal);
}

function ensureProductsPagination() {
  let bar = document.getElementById('productsPagination');
  if (bar || !tableWrap) return bar;
  bar = document.createElement('div');
  bar.id = 'productsPagination';
  bar.className = 'products-pagination';
  tableWrap.insertAdjacentElement('afterend', bar);
  return bar;
}

function renderProductsPagination() {
  const bar = ensureProductsPagination();
  if (!bar) return;

  if (!productsFilteredTotal || productsPageSize === 0 || productsFilteredTotal <= productsPageSize) {
    bar.innerHTML = '';
    bar.hidden = true;
    return;
  }

  const totalPages = Math.max(1, dataTotalPages(productsFilteredTotal));
  if (productsPage > totalPages) productsPage = totalPages;

  const sizeOptions = [10, 25, 50, 100, 0].map((size) => {
    const label = size === 0 ? 'Tümü' : String(size);
    return '<option value="' + size + '"' + (size === productsPageSize ? ' selected' : '') + '>' + label + '</option>';
  }).join('');

  bar.hidden = false;
  bar.innerHTML =
    '<label class="products-page-size">Sayfa başına ' +
      '<select id="productsPageSizeSelect">' + sizeOptions + '</select>' +
    '</label>' +
    '<div class="products-page-nav">' +
      '<button type="button" class="btn-coral outline" id="productsPagePrev"' + (productsPage <= 1 ? ' disabled' : '') + '>‹ Önceki</button>' +
      '<span class="products-page-info">' + productsPage + ' / ' + totalPages + '</span>' +
      '<button type="button" class="btn-coral outline" id="productsPageNext"' + (productsPage >= totalPages ? ' disabled' : '') + '>Sonraki ›</button>' +
    '</div>';

  document.getElementById('productsPageSizeSelect')?.addEventListener('change', (e) => {
    productsPageSize = Number(e.target.value) || 0;
    productsPage = 1;
    renderFromCache();
  });
  document.getElementById('productsPagePrev')?.addEventListener('click', () => {
    if (productsPage > 1) {
      productsPage -= 1;
      renderFromCache();
    }
  });
  document.getElementById('productsPageNext')?.addEventListener('click', () => {
    productsPage += 1;
    renderFromCache();
  });
}

function dataTotalPages(total) {
  return productsPageSize === 0 ? 1 : Math.ceil(total / productsPageSize);
}

function renderTable(rows) {
  if (!rows.length) {
    const colSpan = isChannelCostsPage ? 7 : 10;
    tableBody.innerHTML =
      '<tr><td colspan="' + colSpan + '" class="products-empty">' +
        '<div class="products-empty-state">' +
          '<span aria-hidden="true" style="font-size:1.8rem">📦</span>' +
          '<strong>Filtrelere uyan ürün yok</strong>' +
          '<span>Filtreleri temizleyerek tüm ürünleri görebilirsiniz.</span>' +
        '</div>' +
      '</td></tr>';
    renderProductsPagination();
    return;
  }

  tableBody.innerHTML = rows.map(renderRow).join('');
  tableBody.querySelectorAll('tr[data-barcode]').forEach(snapshotRow);
  tableBody.querySelectorAll('.copy-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(btn.dataset.barcode).then(() => showToast('Barkod kopyalandı'));
    });
  });
  renderProductsPagination();
}

function renderProductThumb(row) {
  const src = row.imageUrl
    ? escAttr(row.imageUrl)
    : '/api/product-thumb-img?barcode=' + encodeURIComponent(row.barcode);
  const img = '<img class="product-thumb" src="' + src + '" alt="" loading="lazy" onerror="this.classList.add(\'is-broken\');this.removeAttribute(\'src\');">';
  const url = String(row.productUrl || '').trim();
  if (url) {
    return '<a href="' + escAttr(url) + '" target="_blank" rel="noopener">' + img + '</a>';
  }
  return img;
}

function renderRow(row) {
  const thumb = renderProductThumb(row);
  const link = row.productUrl
    ? '<a href="' + escAttr(row.productUrl) + '" target="_blank" rel="noopener">' + esc(row.title) + '</a>'
    : esc(row.title);
  const subtitle = row.category ? '<small>' + esc(row.category) + '</small>' : '';

  return '<tr data-barcode="' + escAttr(row.barcode) + '">' +
    '<td><div class="product-info">' + thumb +
      '<div class="product-info-text">' + link + subtitle + '</div></div></td>' +
    '<td><div class="barcode-cell"><span>' + esc(row.barcode) + '</span>' +
      '<button type="button" class="copy-btn" data-barcode="' + escAttr(row.barcode) + '" title="Kopyala">⧉</button></div></td>' +
    '<td class="col-cost"><div class="cost-edit-wrap">' +
      '<input class="cell-input wide" data-field="productCost" data-save value="' + escAttr(row.productCost) + '">' +
      '<span class="currency-suffix">TRY</span>' +
      '<button type="button" class="row-save-btn" disabled title="Satır değişikliklerini kaydet">Güncelle</button>' +
    '</div></td>' +
    '<td><input class="cell-input" data-field="desi" data-save value="' + escAttr(row.desi) + '"></td>' +
    '<td>' + esc(row.brand) + '</td>' +
    '<td><input class="cell-input wide" data-field="modelCode" data-save value="' + escAttr(row.modelCode === '—' ? '' : row.modelCode) + '"></td>' +
    '<td>' + esc(row.stock) + '</td>' +
    (isChannelCostsPage ? '' :
      '<td><span class="badge-return">' + esc(row.returnRateLabel) + '</span></td>' +
      '<td><select class="cell-input full" data-field="deliveryType" data-save>' + deliveryOptions(row.deliveryType) + '</select></td>') +
    '<td><input class="cell-input" data-field="extraExpense" data-save value="' + escAttr(row.extraExpense) + '"></td>' +
  '</tr>';
}

function deliveryOptions(selected) {
  const opts = ['Bugün Kargoda', 'Standart', 'Hızlı'];
  return opts.map((o) => '<option value="' + escAttr(o) + '"' + (o === selected ? ' selected' : '') + '>' + esc(o) + '</option>').join('');
}

function snapshotRow(tr) {
  const snap = {};
  tr.querySelectorAll('[data-save]').forEach((el) => {
    snap[el.dataset.field] = el.value;
  });
  tr.dataset.snapshot = JSON.stringify(snap);
}

function isRowDirty(tr) {
  const snap = JSON.parse(tr.dataset.snapshot || '{}');
  for (const el of tr.querySelectorAll('[data-save]')) {
    if (snap[el.dataset.field] !== el.value) return true;
  }
  return false;
}

function updateRowSaveState(tr) {
  const dirty = isRowDirty(tr);
  tr.classList.toggle('row-dirty', dirty);
  const btn = tr.querySelector('.row-save-btn');
  if (!btn || btn.classList.contains('saved-flash')) return;
  btn.disabled = !dirty;
}

function onFieldInput(event) {
  if (!event.target.matches('[data-save]')) return;
  const tr = event.target.closest('tr');
  if (tr) updateRowSaveState(tr);
}

async function saveRow(tr) {
  const barcode = tr.dataset.barcode;
  const btn = tr.querySelector('.row-save-btn');
  tr.classList.add('saving');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Kaydediliyor…';
  }
  const payload = { barcode, costScope };
  tr.querySelectorAll('[data-save]').forEach((el) => {
    payload[el.dataset.field] = el.value;
  });

  try {
    const response = await authFetch('/api/products/save', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error('Kayıt başarısız');
    snapshotRow(tr);
    tr.classList.remove('row-dirty');
    const costNum = toNum(payload.productCost);
    updateRowInCache(barcode, {
      productCost: payload.productCost,
      desi: payload.desi,
      modelCode: payload.modelCode || '—',
      deliveryType: payload.deliveryType,
      extraExpense: payload.extraExpense,
      hasCost: costNum !== null && costNum !== 0
    });
    if (btn) {
      btn.classList.add('saved-flash');
      btn.textContent = 'Kaydedildi ✓';
      clearTimeout(btn._flashTimer);
      btn._flashTimer = setTimeout(() => {
        btn.classList.remove('saved-flash');
        btn.textContent = 'Güncelle';
        btn.disabled = true;
      }, 1800);
    }
    showToast('Kaydedildi: ' + barcode);
  } catch {
    showToast('Kaydedilemedi: ' + barcode);
    if (btn) {
      btn.classList.remove('saved-flash');
      btn.textContent = 'Güncelle';
    }
    updateRowSaveState(tr);
  } finally {
    tr.classList.remove('saving');
  }
}

async function exportCsv() {
  const params = filtersToParams(getFiltersFromForm());
  const response = await authFetch('/api/products/export?' + params.toString());
  if (!response.ok) {
    showToast('Dışa aktarma başarısız.');
    return;
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'urun-ayarlari.csv';
  a.click();
  URL.revokeObjectURL(url);
  showToast('Excel (CSV) indirildi.');
}

async function importExcelFile(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;

  const button = document.getElementById('importExcel');
  if (button) button.disabled = true;
  showToast('Excel içe aktarılıyor...');

  try {
    const contentBase64 = await readFileBase64(file);
    const response = await authFetch('/api/products/import', {
      method: 'POST',
      body: JSON.stringify({ contentBase64, filename: file.name })
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok || result.ok === false) {
      showToast(result.error || result.message || 'İçe aktarma başarısız.');
      return;
    }

    await loadProducts();
    showToast(result.message || 'Excel içe aktarıldı.');
  } catch (error) {
    showToast(error.message || 'İçe aktarma bağlantı hatası.');
  } finally {
    if (button) button.disabled = false;
  }
}

function readFileBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = () => reject(new Error('Dosya okunamadı.'));
    reader.readAsDataURL(file);
  });
}

function setZoom(scale) {
  tableScale = Math.min(1, Math.max(0.6, scale));
  tableWrap.style.fontSize = (tableScale * 100) + '%';
  document.getElementById('zoomLabel').textContent = Math.round(tableScale * 100) + '%';
}

function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toastEl.classList.remove('show'), 2600);
}

function getStoredToken() { return window.BuyBoxCommon.getStoredToken(); }
function redirectToLogin() { window.BuyBoxCommon.redirectToLogin(); }
function logout() { window.BuyBoxCommon.logout(); }

async function authFetch(url, options = {}) {
  return window.BuyBoxCommon.authFetch(url, options);
}

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[c]));
}
function escAttr(v) { return esc(v).replace(/"/g, '&quot;'); }

setZoom(0.75);
