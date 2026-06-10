'use strict';

const TOKEN_KEY = 'platformApiToken';
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
    loadProducts();
  });
  document.getElementById('clearFilters').addEventListener('click', clearFilters);
  document.getElementById('refreshData').addEventListener('click', loadProducts);
  document.getElementById('exportCsv').addEventListener('click', exportCsv);
  document.getElementById('importExcel').addEventListener('click', () => document.getElementById('importExcelFile')?.click());
  document.getElementById('importExcelFile')?.addEventListener('change', importExcelFile);
  document.getElementById('importXml').addEventListener('click', () => showToast('XML yükleme yakında eklenecek.'));
  document.getElementById('zoomOut').addEventListener('click', () => setZoom(tableScale - 0.05));
  document.getElementById('zoomIn').addEventListener('click', () => setZoom(tableScale + 0.05));
  document.getElementById('zoomReset').addEventListener('click', () => setZoom(0.75));

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.addEventListener('click', logout);

  window.BuyBoxCommon?.initPlatformNav?.();

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

function clearFilters() {
  filterForm.reset();
  loadProducts();
}

async function loadProducts() {
  const params = filtersToParams(getFiltersFromForm());
  const response = await authFetch('/api/products?' + params.toString());
  if (!response.ok) {
    showToast('Ürünler yüklenemedi.');
    return;
  }
  const data = await response.json();
  renderTable(data.rows || []);
  updateProductsSummary(data);
  footerEl.textContent = (data.rows || []).length + ' ürün listeleniyor (' + costScopeLabel + ', toplam ' + data.total + ')';
}

function updateProductsSummary(data) {
  const summary = data.summary || {};
  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value ?? '—');
  };
  set('productsSummaryListed', summary.listed ?? '—');
  set('productsSummaryWithCost', summary.withCost ?? '—');
  set('productsSummaryEmptyCost', summary.emptyCost ?? '—');
  set('productsSummaryFiltered', data.filtered ?? (data.rows || []).length);
}

function renderTable(rows) {
  if (!rows.length) {
    const colSpan = isChannelCostsPage ? 11 : 14;
    tableBody.innerHTML = '<tr><td colspan="' + colSpan + '" style="text-align:center;padding:24px;color:#6b7280">Kayıt bulunamadı.</td></tr>';
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
}

function renderRow(row) {
  const thumb = row.productUrl
    ? '<img class="product-thumb" src="" alt="" data-url="' + escAttr(row.productUrl) + '" onerror="this.classList.add(\'placeholder\');this.alt=\'Görsel\';">'
    : '<div class="product-thumb placeholder">Görsel yok</div>';
  const link = row.productUrl
    ? '<a href="' + escAttr(row.productUrl) + '" target="_blank" rel="noopener">' + esc(row.title) + '</a>'
    : esc(row.title);

  return '<tr data-barcode="' + escAttr(row.barcode) + '">' +
    '<td class="col-variant">' + esc(row.variantLabel) + '</td>' +
    '<td><div class="product-info">' + thumb +
      '<div class="product-info-text">' + link +
      '<small>' + esc(row.category) + ' · ' + esc(row.size) + '</small></div></div></td>' +
    '<td><div class="barcode-cell"><span>' + esc(row.barcode) + '</span>' +
      '<button type="button" class="copy-btn" data-barcode="' + escAttr(row.barcode) + '" title="Kopyala">⧉</button></div></td>' +
    '<td class="col-cost"><div class="cost-edit-wrap">' +
      '<input class="cell-input wide" data-field="productCost" data-save value="' + escAttr(row.productCost) + '">' +
      '<span class="currency-suffix">TRY</span>' +
      '<button type="button" class="row-save-btn" disabled title="Satır değişikliklerini kaydet">Güncelle</button>' +
    '</div></td>' +
    '<td><input class="cell-input" data-field="costVatRate" data-save value="' + escAttr(row.costVatRate) + '"></td>' +
    '<td><input class="cell-input" data-field="desi" data-save value="' + escAttr(row.desi) + '"></td>' +
    '<td>' + esc(row.brand) + '</td>' +
    '<td><input class="cell-input wide" data-field="modelCode" data-save value="' + escAttr(row.modelCode === '—' ? '' : row.modelCode) + '"></td>' +
    '<td><input class="cell-input" data-field="color" data-save value="' + escAttr(row.color === '—' ? '' : row.color) + '"></td>' +
    '<td><input class="cell-input" data-field="size" data-save value="' + escAttr(row.size === '—' ? '' : row.size) + '"></td>' +
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

function getStoredToken() { return sessionStorage.getItem(TOKEN_KEY) || ''; }
function redirectToLogin() {
  window.location.href = '/login?next=' + encodeURIComponent('/marketplace/products');
}
function logout() {
  sessionStorage.removeItem(TOKEN_KEY);
  redirectToLogin();
}

function apiHeaders(json) {
  const h = {};
  if (json) h['Content-Type'] = 'application/json';
  const t = getStoredToken();
  if (t) h.Authorization = 'Bearer ' + t;
  return h;
}

async function authFetch(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...apiHeaders(options.body != null), ...options.headers } });
  if (response.status === 401) {
    sessionStorage.removeItem(TOKEN_KEY);
    redirectToLogin();
    throw new Error('Yetkisiz');
  }
  return response;
}

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[c]));
}
function escAttr(v) { return esc(v).replace(/"/g, '&quot;'); }

setZoom(0.75);
