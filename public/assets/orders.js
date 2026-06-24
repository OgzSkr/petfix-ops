'use strict';

(function () {
const bootstrap = JSON.parse(document.getElementById('bootstrap').textContent);
const isMultiChannel = Boolean(bootstrap.multiChannel);
const isOpsOrders = Boolean(bootstrap.opsMode);
const isChannelPage = Boolean(bootstrap.channelId);
const isEmbeddedChannel = isChannelPage && !isMultiChannel;
const ORDERS_API = bootstrap.apiPath || '/api/orders';
const ORDERS_EXPORT_API = bootstrap.exportPath || '/api/orders/export';
const DEFAULT_ORDERS_DAYS = '1';
const channelLabel = bootstrap.channelLabel || 'Trendyol Pazaryeri';
const HZLMRKTOPS_CHANNEL_ROUTES = {
  'uber-eats': '/hzlmrktops/siparisler',
  'yemeksepeti': '/hzlmrktops/siparisler',
  getir: '/hzlmrktops/siparisler'
};
const tableWrap = document.getElementById('ordersTableWrap');
const tableBody = document.getElementById('ordersBody');
const footerEl = document.getElementById('ordersFooter');
const toastEl = document.getElementById('ordersToast');
const modalBackdrop = document.getElementById('orderModalBackdrop');
const modalBody = document.getElementById('orderModalBody');
const modalTitle = document.getElementById('orderModalTitle');
const filterForm = document.getElementById('ordersFilterForm');
const daysSelect = document.getElementById('daysSelect');
const startDateInput = document.getElementById('startDate');
const endDateInput = document.getElementById('endDate');
const statusFilter = document.getElementById('statusFilter');
const profitFilter = document.getElementById('profitFilter');
const matchingFilter = document.getElementById('matchingFilter');
const matchingFilterField = document.getElementById('matchingFilterField');
const chartWrap = document.getElementById('ordersChartWrap');
const uberOrdersSubnav = document.getElementById('uberOrdersSubnav');
const ordersListPanel = document.getElementById('ordersListPanel');
const uberLossProductsPanel = document.getElementById('uberLossProductsPanel');
const lossProductsBody = document.getElementById('lossProductsBody');
const lossProductsFooter = document.getElementById('lossProductsFooter');
const lossProductsSearch = document.getElementById('lossProductsSearch');
const ordersSearch = document.getElementById('ordersSearch');
const lossProductsIssuesOnly = document.getElementById('lossProductsIssuesOnly');
const lossProductsUnmapAllBtn = document.getElementById('lossProductsUnmapAllBtn');
const LOSS_PRODUCT_MATCHING_ISSUES = ['missing_master', 'barcode_conflict', 'review_required', 'pending', 'unmapped'];
const LOSS_PRODUCT_MATCHING_SEVERITY = {
  barcode_conflict: 6,
  missing_master: 5,
  unmapped: 4,
  review_required: 4,
  pending: 3,
  auto_matched: 2,
  legacy_fallback: 2,
  manual_confirmed: 1,
  legacy: 0
};

const ORDER_TIMEZONE = bootstrap.orderDateTimezone || 'UTC';

function normalizeOrderTimestamp(value) {
  if (value === '' || value === null || value === undefined) return 0;

  let n = Number(value);
  if (Number.isFinite(n) && n > 0) {
    if (n < 1e12) n *= 1000;
    return n;
  }

  const parsed = Date.parse(String(value));
  if (Number.isFinite(parsed) && parsed > 0) return parsed;

  return 0;
}

function formatOrderDate(timestamp) {
  const ms = normalizeOrderTimestamp(timestamp);
  if (!ms) return '';

  const parts = new Intl.DateTimeFormat('tr-TR', {
    timeZone: ORDER_TIMEZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(ms));

  const get = (type) => parts.find((part) => part.type === type)?.value || '';
  const month = get('month').replace(/\.$/, '');

  return `${get('day')} ${month} ${get('year')} - ${get('hour')}:${get('minute')}`;
}

function orderDayKey(timestamp) {
  const ms = normalizeOrderTimestamp(timestamp);
  if (!ms) return '';

  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ORDER_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(ms));
}

function orderWeekKey(timestamp) {
  const ms = normalizeOrderTimestamp(timestamp);
  if (!ms) return '';

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ORDER_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(ms));

  const get = (type) => Number(parts.find((part) => part.type === type)?.value || 0);
  const date = new Date(Date.UTC(get('year'), get('month') - 1, get('day')));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);

  return date.toISOString().slice(0, 10);
}

function formatBucketLabel(key, mode) {
  if (!key) return '';
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  if (mode === 'week') {
    return date.toLocaleDateString('tr-TR', {
      timeZone: ORDER_TIMEZONE,
      day: '2-digit',
      month: 'short'
    }) + ' hft';
  }
  return date.toLocaleDateString('tr-TR', {
    timeZone: ORDER_TIMEZONE,
    day: '2-digit',
    month: 'short'
  });
}

let tableScale = 0.9;
let allRows = [];
let fetchedCount = 0;
let activeRange = { startMs: 0, endMs: 0 };
let activeDays = 1;
let chartMode = 'day';
let sortKey = 'orderDateMs';
let sortDir = 'desc';
let lastDataQuality = null;
let lastOrderSources = null;
let lastMatchingSummary = null;
let pendingOrderNumber = null;
let orderDeepLinkHandled = false;
let activeOrdersView = 'orders';
let activeChannelFilter = 'all';
let lastHzlMrktOpsChannels = null;
let lastUpdatedAt = null;
let lastFromCache = false;
let lastCacheMeta = { skipped: false, cooldownSeconds: 0, message: '' };
let lastGetirSync = null;
let ordersPageSize = 10;
let ordersPage = 1;
let serverPaginated = false;
let ordersServerTotal = 0;
let lifecycleCountsFromServer = null;
let currentTableRows = [];
let activeLifecycleTab = 'active';
let lifecycleTabUserSelected = false;
let opsActiveRefreshTimer = null;

const ACTIVE_ORDER_SOUND_STORAGE_KEY = 'hzlmrktops.activeOrderSound';
let knownActiveOrderKeys = new Set();
let activeOrderSoundReady = false;
let activeOrderSoundScope = '';
let orderSoundAudioCtx = null;
let activeOrderSoundEnabled = readActiveOrderSoundEnabled();

const COL_COUNT = isOpsOrders ? 11 : (isMultiChannel ? 11 : 10);

const TERMINAL_ORDER_STATUSES = new Set(
  Array.isArray(bootstrap.terminalOrderStatusKeys) && bootstrap.terminalOrderStatusKeys.length
    ? bootstrap.terminalOrderStatusKeys
    : [
      'DELIVERED', 'COMPLETED', 'FINISHED', 'CANCELLED', 'CANCELED', 'RETURNED', 'UNDELIVERED',
      'FAILED', 'PICKED_UP', 'TESLIM EDILDI', 'TAMAMLANDI', 'IPTAL', 'TESLIM EDILEMEDI', 'IADE', 'BASARISIZ'
    ]
);

function normalizeOrderStatusKey(status) {
  const turkishFold = {
    'ı': 'i',
    'İ': 'i',
    'ş': 's',
    'Ş': 's',
    'ğ': 'g',
    'Ğ': 'g',
    'ü': 'u',
    'Ü': 'u',
    'ö': 'o',
    'Ö': 'o',
    'ç': 'c',
    'Ç': 'c'
  };

  const folded = [...String(status || '').trim()].map((ch) => turkishFold[ch] ?? ch).join('');
  return folded.toUpperCase().replace(/\s+/g, ' ');
}
const qualityBannerEl = document.getElementById('ordersQualityBanner');
const cacheBannerEl = document.getElementById('ordersCacheBanner');
const syncBannerEl = document.getElementById('ordersSyncBanner');
const matchingBannerEl = document.getElementById('ordersMatchingBanner');
const matchingStripEl = document.getElementById('ordersMatchingStrip');
const quickFilterRoot = document.getElementById('ordersQuickFilters');

if (bootstrap.authRequired && !getStoredToken()) {
  redirectToLogin();
} else {
  bindEvents();
  initMatchingFilters();
  setDefaultCustomDates();
  applyInitialQueryParams();
  if (!isChannelPage) loadEmailSettings();
  if (isEmbeddedChannel) window.BuyBoxChannelPage?.setOrdersLoading(true);
  syncChannelFilterTabs();
  hydrateChannelFilterLogos();
  if (isOpsOrders) {
    initActiveOrderSoundToggle();
    restartOpsActiveAutoRefresh();
    bindOrderSoundUnlock();
    window.onPanelRefresh = () => loadOrders(true, { silent: true });
  }
  loadOrders();
}

function readActiveOrderSoundEnabled() {
  try {
    const raw = localStorage.getItem(ACTIVE_ORDER_SOUND_STORAGE_KEY);
    if (raw === '0' || raw === 'false') return false;
    return true;
  } catch {
    return true;
  }
}

function persistActiveOrderSoundEnabled(enabled) {
  try {
    localStorage.setItem(ACTIVE_ORDER_SOUND_STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function initActiveOrderSoundToggle() {
  const btn = document.getElementById('ordersSoundToggle');
  if (!btn) return;
  syncActiveOrderSoundToggle();
  btn.addEventListener('click', () => {
    activeOrderSoundEnabled = !activeOrderSoundEnabled;
    persistActiveOrderSoundEnabled(activeOrderSoundEnabled);
    syncActiveOrderSoundToggle();
    ensureOrderSoundAudioContext();
    if (activeOrderSoundEnabled) playNewActiveOrderSound(true);
  });
}

function syncActiveOrderSoundToggle() {
  const btn = document.getElementById('ordersSoundToggle');
  if (!btn) return;
  btn.classList.toggle('is-on', activeOrderSoundEnabled);
  btn.classList.toggle('is-off', !activeOrderSoundEnabled);
  btn.setAttribute('aria-pressed', activeOrderSoundEnabled ? 'true' : 'false');
  btn.textContent = activeOrderSoundEnabled ? 'Ses: Açık' : 'Ses: Kapalı';
  btn.title = activeOrderSoundEnabled
    ? 'Yeni aktif sipariş geldiğinde ses çal'
    : 'Ses bildirimi kapalı — açmak için tıklayın';
}

function bindOrderSoundUnlock() {
  const unlock = () => ensureOrderSoundAudioContext();
  document.addEventListener('click', unlock, { once: true, capture: true });
  document.addEventListener('keydown', unlock, { once: true, capture: true });
}

function activeOrderSoundScopeKey() {
  return `${activeChannelFilter}:${daysSelect?.value || DEFAULT_ORDERS_DAYS}`;
}

function orderRowIdentity(row) {
  const channel = String(row.channel || row.channelId || '').trim();
  const orderNo = String(row.orderNumber || row.shipmentPackageId || '').trim();
  if (channel && orderNo) return `${channel}::${orderNo}`;
  return orderNo;
}

function activeOrderKeysFromRows(rows) {
  const keys = new Set();
  for (const row of rows) {
    if (!rowMatchesDateRange(row)) continue;
    if (isOrderCompleted(row)) continue;
    const id = orderRowIdentity(row);
    if (id) keys.add(id);
  }
  return keys;
}

function ensureOrderSoundAudioContext() {
  if (!orderSoundAudioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) orderSoundAudioCtx = new Ctx();
  }
  if (orderSoundAudioCtx?.state === 'suspended') {
    orderSoundAudioCtx.resume().catch(() => {});
  }
  return orderSoundAudioCtx;
}

function playNewActiveOrderSound(preview = false) {
  if (!preview && !activeOrderSoundEnabled) return;
  try {
    if (navigator.vibrate) navigator.vibrate([70, 35, 90]);
  } catch {
    /* ignore */
  }
  const ctx = ensureOrderSoundAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  const tones = [
    { freq: 880, start: 0, duration: 0.11 },
    { freq: 1175, start: 0.17, duration: 0.13 }
  ];
  for (const tone of tones) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = tone.freq;
    osc.connect(gain);
    gain.connect(ctx.destination);
    const t0 = now + tone.start;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.14, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + tone.duration);
    osc.start(t0);
    osc.stop(t0 + tone.duration + 0.02);
  }
}

function detectNewActiveOrdersAndNotify() {
  if (!isOpsOrders) return;

  const scope = activeOrderSoundScopeKey();
  const currentKeys = activeOrderKeysFromRows(allRows);

  if (scope !== activeOrderSoundScope) {
    activeOrderSoundScope = scope;
    knownActiveOrderKeys = currentKeys;
    activeOrderSoundReady = true;
    return;
  }

  if (!activeOrderSoundReady) {
    knownActiveOrderKeys = currentKeys;
    activeOrderSoundReady = true;
    return;
  }

  const newcomers = [];
  for (const key of currentKeys) {
    if (!knownActiveOrderKeys.has(key)) newcomers.push(key);
  }
  knownActiveOrderKeys = currentKeys;

  if (!newcomers.length || !activeOrderSoundEnabled) return;

  playNewActiveOrderSound();
  const msg = newcomers.length === 1
    ? 'Yeni aktif sipariş geldi'
    : `${newcomers.length} yeni aktif sipariş geldi`;
  showToast(msg);
}

function applyInitialQueryParams() {
  const params = new URLSearchParams(window.location.search);
  const profit = params.get('profit');
  if (profit && profitFilter) {
    if (['all', 'profit', 'loss', 'zero'].includes(profit)) {
      profitFilter.value = profit;
    }
  }
  const order = String(params.get('order') || '').trim();
  if (order) {
    pendingOrderNumber = order;
    orderDeepLinkHandled = false;
  }
  const days = params.get('days');
  if (daysSelect) {
    if (days && ['7', '14', '30', '60', '1'].includes(days)) {
      daysSelect.value = days;
    } else {
      daysSelect.value = DEFAULT_ORDERS_DAYS;
    }
    toggleCustomDates();
    updateOrdersHeroPeriodLabel();
  }
  const matching = params.get('matching');
  if (matching && matchingFilter && ['all', 'unmapped', 'needs_review'].includes(matching)) {
    matchingFilter.value = matching;
  }
  const channel = String(params.get('channel') || '').trim();
  if (isMultiChannel && channel) {
    activeChannelFilter = channel;
    syncChannelFilterTabs();
  }
  const view = String(params.get('view') || '').trim();
  if (view === 'loss-products' && uberLossProductsPanel) {
    switchOrdersView('loss-products', { syncUrl: false });
  }
  syncQuickFilterButtons();
  syncMatchingQuickButtons();
}

let ordersSearchTimer = null;

function bindEvents() {
  filterForm.addEventListener('submit', (e) => {
    e.preventDefault();
    loadOrders();
  });
  document.getElementById('clearOrderFilters').addEventListener('click', clearFilters);
  document.getElementById('refreshOrders').addEventListener('click', () => loadOrders(true));
  document.getElementById('exportReport')?.addEventListener('click', exportReport);
  const zoomOut = document.getElementById('zoomOut');
  const zoomIn = document.getElementById('zoomIn');
  const zoomReset = document.getElementById('zoomReset');
  if (zoomOut) zoomOut.addEventListener('click', () => setZoom(tableScale - 0.05));
  if (zoomIn) zoomIn.addEventListener('click', () => setZoom(tableScale + 0.05));
  if (zoomReset) zoomReset.addEventListener('click', () => setZoom(0.9));
  daysSelect.addEventListener('change', () => {
    toggleCustomDates();
    updateOrdersHeroPeriodLabel();
    if (daysSelect.value !== 'custom') loadOrders();
  });
  statusFilter.addEventListener('change', () => {
    ordersPage = 1;
    if (isOpsOrders && serverPaginated) {
      loadOrders();
      return;
    }
    refreshView();
  });
  profitFilter?.addEventListener('change', () => {
    syncQuickFilterButtons();
    syncProfitQueryParam();
    refreshView();
  });
  matchingFilter?.addEventListener('change', () => {
    syncMatchingQueryParam();
    syncMatchingQuickButtons();
    refreshView();
  });

  if (quickFilterRoot) {
    quickFilterRoot.querySelectorAll('.orders-quick-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const value = btn.dataset.profit || 'all';
        if (!profitFilter || profitFilter.value === value) return;
        profitFilter.value = value;
        syncQuickFilterButtons();
        syncProfitQueryParam();
        refreshView();
      });
    });
  }

  document.getElementById('ordersLifecycleTabs')?.querySelectorAll('.orders-lifecycle-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      lifecycleTabUserSelected = true;
      setActiveLifecycleTab(btn.dataset.lifecycle || 'active');
      ordersPage = 1;
      if (!serverPaginated) refreshView();
    });
  });

  uberOrdersSubnav?.querySelectorAll('[data-orders-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      switchOrdersView(btn.dataset.ordersView || 'orders');
    });
  });
  lossProductsSearch?.addEventListener('input', renderLossProducts);
  ordersSearch?.addEventListener('input', () => {
    ordersPage = 1;
    clearTimeout(ordersSearchTimer);
    ordersSearchTimer = setTimeout(() => {
      if (isOpsOrders && serverPaginated) loadOrders();
      else refreshView();
    }, 300);
  });
  lossProductsIssuesOnly?.addEventListener('change', renderLossProducts);
  lossProductsUnmapAllBtn?.addEventListener('click', unmapAllLossProducts);
  document.getElementById('orderModalClose').addEventListener('click', closeModal);
  modalBackdrop.addEventListener('click', (e) => {
    if (e.target === modalBackdrop) closeModal();
  });
  window.addEventListener('buybox:benimpos-sale-success', (event) => {
    handleBenimposSaleSuccess(event.detail || {});
  });

  if (chartWrap) {
    document.querySelectorAll('.chart-mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        chartMode = btn.dataset.mode;
        document.querySelectorAll('.chart-mode-btn').forEach((el) => el.classList.toggle('active', el === btn));
        renderChart();
      });
    });
  }

  document.querySelectorAll('.orders-table th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      else {
        sortKey = key;
        sortDir = 'desc';
      }
      ordersPage = 1;
      renderTable();
    });
  });

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.addEventListener('click', logout);

  const channelFilterRoot = document.getElementById('hzlmrktopsChannelFilters');
  if (channelFilterRoot) {
    channelFilterRoot.querySelectorAll('[data-channel]').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeChannelFilter = btn.dataset.channel || 'all';
        syncChannelFilterTabs();
        syncChannelQueryParam();
        loadOrders();
      });
    });
  }

  const emailSave = document.getElementById('emailSave');
  if (emailSave) {
    emailSave.addEventListener('click', saveEmailSettings);
    document.getElementById('emailTest').addEventListener('click', testEmail);
    document.getElementById('emailCheckNow').addEventListener('click', checkEmailNow);
  }
}

function setDefaultCustomDates() {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 13);
  endDateInput.value = toInputDate(end);
  startDateInput.value = toInputDate(start);
  toggleCustomDates();
}

function toggleCustomDates() {
  const custom = daysSelect.value === 'custom';
  startDateInput.disabled = !custom;
  endDateInput.disabled = !custom;
  document.querySelectorAll('.custom-date-field').forEach((el) => {
    el.classList.toggle('disabled', !custom);
  });
}

function initMatchingFilters() {
  if (isOpsOrders || !matchingEnabled()) return;
  if (matchingFilterField) matchingFilterField.hidden = false;
  injectMatchingQuickFilter();
}

function injectMatchingQuickFilter() {
  if (!quickFilterRoot || quickFilterRoot.querySelector('[data-matching="unmapped"]')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'orders-quick-btn';
  btn.dataset.matching = 'unmapped';
  btn.textContent = 'Eşleşmemiş';
  btn.addEventListener('click', () => {
    if (!matchingFilter) return;
    matchingFilter.value = matchingFilter.value === 'unmapped' ? 'all' : 'unmapped';
    syncMatchingQueryParam();
    syncMatchingQuickButtons();
    refreshView();
  });
  quickFilterRoot.appendChild(btn);
}

function syncMatchingQuickButtons() {
  const btn = quickFilterRoot?.querySelector('[data-matching="unmapped"]');
  if (btn && matchingFilter) {
    btn.classList.toggle('active', matchingFilter.value === 'unmapped');
  }
}

function syncMatchingQueryParam() {
  if (!matchingFilter || !matchingEnabled()) return;
  const params = new URLSearchParams(window.location.search);
  if (matchingFilter.value === 'all') params.delete('matching');
  else params.set('matching', matchingFilter.value);
  const next = params.toString();
  window.history.replaceState({}, '', next ? `${window.location.pathname}?${next}` : window.location.pathname);
}

function orderMatchesMatchingFilter(row, filter) {
  const value = String(filter || 'all').trim();
  if (!value || value === 'all') return true;
  const lines = row.lines || [];
  if (!lines.length) return false;

  if (value === 'unmapped') {
    return lines.some((line) =>
      line.mappingSource === 'unmapped'
      || line.mappingStatus === 'unmapped'
      || line.mappingStatus === 'missing_master'
    );
  }

  if (value === 'needs_review') {
    return lines.some((line) =>
      ['pending', 'review_required', 'barcode_conflict', 'missing_master', 'unmapped'].includes(line.mappingStatus)
      || line.mappingSource === 'unmapped'
      || line.mappingSource === 'legacy_fallback'
    );
  }

  return true;
}

function syncQuickFilterButtons() {
  if (!quickFilterRoot || !profitFilter) return;
  const value = profitFilter.value || 'all';
  quickFilterRoot.querySelectorAll('.orders-quick-btn').forEach((btn) => {
    btn.classList.toggle('active', (btn.dataset.profit || 'all') === value);
  });
}

function syncProfitQueryParam() {
  if (!profitFilter) return;
  const params = new URLSearchParams(window.location.search);
  if (profitFilter.value === 'all') params.delete('profit');
  else params.set('profit', profitFilter.value);
  const qs = params.toString();
  const next = qs ? window.location.pathname + '?' + qs : window.location.pathname;
  history.replaceState(null, '', next);
}

function syncOrderQueryParam(orderNumber) {
  const params = new URLSearchParams(window.location.search);
  const order = String(orderNumber || '').trim();
  if (order) params.set('order', order);
  else params.delete('order');
  const qs = params.toString();
  history.replaceState(null, '', qs ? window.location.pathname + '?' + qs : window.location.pathname);
}

function clearFilters() {
  daysSelect.value = DEFAULT_ORDERS_DAYS;
  statusFilter.value = '';
  if (profitFilter) profitFilter.value = 'all';
  if (matchingFilter) matchingFilter.value = 'all';
  if (ordersSearch) ordersSearch.value = '';
  syncQuickFilterButtons();
  syncMatchingQuickButtons();
  syncProfitQueryParam();
  syncMatchingQueryParam();
  setDefaultCustomDates();
  loadOrders();
}

function orderMatchesSearch(row, query) {
  if (!query) return true;
  const q = query.toLocaleLowerCase('tr-TR');
  const parts = [
    row.orderNumber,
    row.customerName,
    row.status,
    row.channelId,
    row.channelLabel,
    row.paymentType,
    row.deliveryType
  ];
  for (const line of row.lines || []) {
    parts.push(line.title, line.productName, line.name, line.barcode, line.sku);
  }
  return parts
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase('tr-TR')
    .includes(q);
}

function buildQueryParams() {
  const params = new URLSearchParams();
  if (daysSelect.value === 'custom') {
    if (startDateInput.value) params.set('startDate', startDateInput.value);
    if (endDateInput.value) params.set('endDate', endDateInput.value);
  } else {
    params.set('days', daysSelect.value || DEFAULT_ORDERS_DAYS);
  }
  if (isMultiChannel && activeChannelFilter !== 'all') {
    params.set('channel', activeChannelFilter);
  }
  if (isOpsOrders) {
    params.set('page', String(ordersPage));
    params.set('limit', String(ordersPageSize || 25));
    params.set('lifecycle', activeLifecycleTab);
    const q = String(ordersSearch?.value || '').trim();
    if (q) params.set('q', q);
    if (statusFilter?.value) params.set('status', statusFilter.value);
  }
  return params;
}

function syncChannelFilterTabs() {
  const channelFilterRoot = document.getElementById('hzlmrktopsChannelFilters');
  if (!channelFilterRoot) return;
  channelFilterRoot.querySelectorAll('[data-channel]').forEach((btn) => {
    const active = (btn.dataset.channel || 'all') === activeChannelFilter;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
}

function hydrateChannelFilterLogos() {
  if (!isMultiChannel) return;
  const root = document.getElementById('hzlmrktopsChannelFilters');
  const logos = channelLogos();
  if (!root || !logos?.render) return;
  root.querySelectorAll('button[data-channel]').forEach((btn) => {
    const channelId = String(btn.dataset.channel || '').trim();
    const countEl = btn.querySelector('.orders-subnav-count');
    const countHtml = countEl ? countEl.outerHTML : '';
    if (channelId === 'all') {
      btn.innerHTML = '<span class="orders-subnav-label">Tümü</span>' + countHtml;
      return;
    }
    btn.innerHTML = logos.render(channelId, { size: 'sm' }) + countHtml;
  });
}

function syncChannelQueryParam() {
  if (!isMultiChannel) return;
  const params = new URLSearchParams(window.location.search);
  if (activeChannelFilter && activeChannelFilter !== 'all') params.set('channel', activeChannelFilter);
  else params.delete('channel');
  const qs = params.toString();
  const next = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  window.history.replaceState({}, '', next);
}

function channelLogos() {
  return window.PetFixChannelLogos || window.BuyBoxChannelLogos || null;
}

function renderChannelCell(row) {
  const channelId = row.channel || row.channelId || '';
  const label = row.channelLabel || channelId || '—';
  const route = HZLMRKTOPS_CHANNEL_ROUTES[channelId];
  const logos = channelLogos();
  const logo = channelId && logos?.render
    ? logos.render(channelId, { size: isOpsOrders ? 'sm' : 'xs' })
    : '';
  if (isOpsOrders) {
    return logo || '<span class="pf-channel-logo pf-channel-logo--sm" title="' + escAttr(label) + '">?</span>';
  }
  if (route) {
    return logo + '<a class="orders-channel-link" href="' + esc(route) + '">' + esc(label) + '</a>';
  }
  return logo + esc(label);
}

function formatOpsDate(timestamp) {
  const ms = normalizeOrderTimestamp(timestamp);
  if (!ms) return '—';
  const parts = new Intl.DateTimeFormat('tr-TR', {
    timeZone: ORDER_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(ms));
  const get = (type) => parts.find((part) => part.type === type)?.value || '';
  return get('day') + '.' + get('month') + '.' + get('year') + ' ' + get('hour') + ':' + get('minute');
}

function formatElapsedMinutes(timestamp) {
  const ms = normalizeOrderTimestamp(timestamp);
  if (!ms) return '';
  const diffMin = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (diffMin < 60) return diffMin + ' dk';
  const hours = Math.floor(diffMin / 60);
  const mins = diffMin % 60;
  return hours + ' sa ' + (mins ? mins + ' dk' : '');
}

function formatOpsPhone(row) {
  const phone = String(row.customerPhone || '').trim();
  return phone || '—';
}

function isOpsOrderDelivered(row) {
  const status = String(row.status || '').trim();
  const normalized = status.toLowerCase();
  if (['delivered', 'completed', 'picked_up', 'finished', 'teslim edildi', 'tamamlandı'].includes(normalized)) {
    return true;
  }
  return ['Delivered', 'COMPLETED', 'DELIVERED', 'PICKED_UP'].includes(status);
}

function formatOpsDeliveryDate(row) {
  if (row.deliveredAtMs) return formatOpsDate(row.deliveredAtMs);
  if (isOpsOrderDelivered(row)) return '—';
  return 'Henüz teslim edilmedi';
}

function opsSettlementChannelLabel(channelId) {
  if (channelId === 'uber-eats') return 'Uber Eats';
  if (channelId === 'yemeksepeti') return 'Yemeksepeti';
  if (channelId === 'getir') return 'Getir';
  return 'Kanal';
}

function renderMultiChannelSourceNote(data) {
  if (!isMultiChannel) return;
  const footerEl = document.getElementById('ordersSourceNote');
  if (!footerEl) return;
  const parts = (data.channels || [])
    .filter((entry) => entry.available)
    .map((entry) => {
      let text = `${entry.label}: ${entry.total}`;
      if (entry.skipped) text += ' (API beklemede)';
      return text;
    });
  footerEl.textContent = parts.length
    ? parts.join(' · ')
    : 'Aktif kanal bulunamadı — Yönetim → Ayarlar bölümünden API bilgilerini kontrol edin.';
  footerEl.hidden = false;
  updateChannelTabCounts(data.channels || []);
}

function updateChannelTabCounts(channelsMeta) {
  if (!isMultiChannel) return;
  const root = document.getElementById('hzlmrktopsChannelFilters');
  if (!root) return;

  let allCount = 0;
  for (const entry of channelsMeta) {
    const total = Number(entry.total) || 0;
    if (entry.available) allCount += total;
    const countEl = root.querySelector(`[data-count-for="${entry.id}"]`);
    if (countEl) {
      countEl.textContent = entry.available ? String(total) : '—';
      countEl.classList.toggle('is-empty', entry.available && total === 0);
    }
  }

  const allCountEl = root.querySelector('[data-count-for="all"]');
  if (allCountEl) {
    allCountEl.textContent = String(allCount);
    allCountEl.classList.toggle('is-empty', allCount === 0);
  }
}

function renderYemeksepetiEmptyHint(data) {
  if (bootstrap.channelId !== 'yemeksepeti') return;
  let banner = document.getElementById('ysOrdersEmptyHint');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'ysOrdersEmptyHint';
    banner.className = 'orders-quality-banner';
    const anchor = document.getElementById('ordersQualityBanner');
    if (anchor?.parentNode) {
      anchor.parentNode.insertBefore(banner, anchor.nextSibling);
    }
  }
  const sources = data.orderSources;
  if ((data.rows || []).length > 0 || !sources) {
    banner.hidden = true;
    banner.textContent = '';
    return;
  }
  banner.hidden = false;
  banner.innerHTML =
    'Yemeksepeti Partner API bu dönemde <strong>0</strong> sipariş döndürdü' +
    (sources.opsWebhook ? ` · Webhook/Ops kaynağında <strong>${sources.opsWebhook}</strong> kayıt var (tam gövde eksik olabilir)` : '') +
    '. Canlı siparişler webhook ile gelir — ' +
    '<a href="/admin/settings">Ayarlar</a> ve ' +
    '<a href="https://partner-app.yemeksepeti.com/" target="_blank" rel="noopener">Partner Portal</a> → Shop Integrations loglarını kontrol edin.';
}

async function loadOrders(forceRefresh = false, options = {}) {
  const silent = Boolean(options.silent);
  const refreshBtn = document.getElementById('refreshOrders');
  refreshBtn.disabled = true;
  footerEl.textContent = forceRefresh
    ? `${channelLabel} API'den siparişler çekiliyor…`
    : 'Siparişler yükleniyor…';
  if (!silent) {
    window.PfStatus?.loading?.(
      forceRefresh ? 'Siparişler güncelleniyor' : 'Siparişler yükleniyor',
      forceRefresh ? 'Kanallardan yeni siparişler kontrol ediliyor' : 'Liste hazırlanıyor'
    );
  }
  tableBody.innerHTML = '<tr><td colspan="' + COL_COUNT + '" class="orders-loading"><span class="orders-loading-spinner" aria-hidden="true"></span> Siparişler çekiliyor, lütfen bekleyin…</td></tr>';
  if (lossProductsBody) {
    lossProductsBody.innerHTML = '<tr><td colspan="10" class="orders-loading">Siparişler çekiliyor, lütfen bekleyin…</td></tr>';
  }

  try {
    const params = buildQueryParams();
    if (forceRefresh) params.set('force', '1');
    const response = await authFetch(ORDERS_API + '?' + params.toString());
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Yüklenemedi');

    allRows = data.rows || [];
    serverPaginated = Boolean(data.paginated);
    ordersServerTotal = serverPaginated
      ? (Number(data.total) || 0)
      : allRows.length;
    lifecycleCountsFromServer = data.lifecycleCounts || null;
    if (serverPaginated && Number(data.page) > 0) {
      ordersPage = Number(data.page);
    }
    if (serverPaginated && Number(data.limit) > 0) {
      ordersPageSize = Number(data.limit);
    }
    fetchedCount = data.fetched ?? (serverPaginated ? ordersServerTotal : allRows.length);
    lastHzlMrktOpsChannels = data.channels || null;
    lastDataQuality = data.dataQuality || null;
    lastOrderSources = data.orderSources || null;
    lastMatchingSummary = data.matchingSummary || null;
    lastGetirSync = data.getirSync || null;
    activeRange = {
      startMs: data.range?.startMs || 0,
      endMs: data.range?.endMs || 0
    };
    activeDays = Number(data.range?.days) || Number(params.get('days')) || 30;
    lastUpdatedAt = data.updatedAt ? Date.parse(data.updatedAt) : Date.now();
    lastFromCache = Boolean(data.skipped);
    lastCacheMeta = {
      skipped: Boolean(data.skipped),
      cooldownSeconds: Number(data.cooldownSeconds) || 0,
      message: String(data.message || '').trim()
    };
    populateStatusOptions(data.statuses || []);
    pickLifecycleTabAfterLoad();
    refreshView({
      dataQuality: data.dataQuality,
      matchingSummary: data.matchingSummary,
      orderSources: data.orderSources
    });
    if (isOpsOrders && !data.skipped) {
      detectNewActiveOrdersAndNotify();
    }
    if (isEmbeddedChannel) {
      window.BuyBoxChannelPage?.updateOrdersStatus({
        configured: true,
        skipped: Boolean(data.skipped),
        cooldownSeconds: data.cooldownSeconds || 0,
        orderCount: allRows.length,
        fetched: fetchedCount,
        stats: data.stats || null,
        orderSources: data.orderSources || null,
        message: data.message || ''
      });
    }
    renderYemeksepetiEmptyHint(data);
    renderMultiChannelSourceNote(data);
    if (!silent) {
      if (data.skipped) {
        window.PfStatus?.error?.(
          'Güncelleme bekleniyor',
          `${data.message || 'Kısa süre önce güncellendi'} (${data.cooldownSeconds || 0} sn)`
        );
      } else {
        const dq = data.dataQuality;
        let detail = `${allRows.length.toLocaleString('tr-TR')} kayıt listelendi`;
        if (dq && dq.withWarnings > 0) {
          detail += ` · ${dq.withWarnings} siparişte uyarı var`;
        }
        window.PfStatus?.success?.(
          forceRefresh ? 'Siparişler güncellendi' : 'Siparişler hazır',
          detail
        );
      }
    }
    if (data.skipped) {
      if (!silent) showToast(data.message + ' (' + data.cooldownSeconds + ' sn)');
      return;
    }
    if (silent) return;
    const dq = data.dataQuality;
    const dhl = data.dhlShipping;
    if (dq && dq.withWarnings > 0) {
      showToast('Güncellendi — ' + dq.withWarnings + ' siparişte veri uyarısı var.' + (dhl?.queried ? ' DHL: ' + dhl.resolved + ' net.' : ''));
    } else if (dhl && dhl.queried > 0) {
      showToast('Siparişler güncellendi. DHL: ' + dhl.resolved + ' net, ' + dhl.pending + ' bekliyor.');
    }
  } catch (error) {
    tableBody.innerHTML = '<tr><td colspan="' + COL_COUNT + '" class="orders-error">' + esc(error.message) + '</td></tr>';
    if (lossProductsBody) {
      lossProductsBody.innerHTML = '<tr><td colspan="10" class="orders-error">' + esc(error.message) + '</td></tr>';
    }
    footerEl.textContent = 'Yüklenemedi: ' + error.message;
    if (isEmbeddedChannel) {
      window.BuyBoxChannelPage?.updateOrdersStatus({
        configured: !String(error.message || '').includes('API bilgileri eksik'),
        error: error.message || 'Yüklenemedi'
      });
    }
    if (!silent) {
      window.PfStatus?.error?.('Siparişler yüklenemedi', error.message);
    }
    showToast(error.message);
  } finally {
    refreshBtn.disabled = false;
  }
}

function populateStatusOptions(statuses) {
  const current = statusFilter.value;
  statusFilter.innerHTML = '<option value="">Tüm durumlar</option>' +
    statuses.map((status) => '<option value="' + escAttr(status) + '">' + esc(translateStatus(status)) + '</option>').join('');
  if (current && statuses.includes(current)) statusFilter.value = current;
}

function translateStatus(status) {
  const map = {
    // Trendyol
    Created: 'Oluşturuldu',
    Picking: 'Hazırlanıyor',
    Invoiced: 'Faturalandı',
    Shipped: 'Yolda',
    Delivered: 'Teslim edildi',
    Cancelled: 'İptal',
    UnDelivered: 'Teslim edilemedi',
    Returned: 'İade',
    Repack: 'Yeniden paketlendi',
    UnPacked: 'Paket açıldı',
    Awaiting: 'Bekliyor',
    // Yemeksepeti / Uber Eats / Ops
    RECEIVED: 'Alındı',
    ACCEPTED: 'Kabul edildi',
    IN_PREPARATION: 'Hazırlanıyor',
    PICKING: 'Toplanıyor',
    READY_FOR_PICKUP: 'Teslime hazır',
    DISPATCHED: 'Yola çıktı',
    DELIVERED: 'Teslim edildi',
    COMPLETED: 'Tamamlandı',
    PICKED_UP: 'Teslim edildi',
    CANCELLED: 'İptal',
    CANCELED: 'İptal',
    received: 'Alındı',
    picking: 'Toplanıyor',
    picked: 'Toplandı',
    ready: 'Hazır',
    completed: 'Tamamlandı',
    cancelled: 'İptal',
    blocked: 'Engellendi',
    accepted: 'Kabul edildi',
    delivered: 'Teslim edildi',
    finished: 'Tamamlandı',
    Yolda: 'Yolda',
    Yeni: 'Yeni',
    Hazırlanıyor: 'Hazırlanıyor',
    Faturalandı: 'Faturalandı',
    'Teslim edilemedi': 'Teslim edilemedi',
    İade: 'İade',
    failed: 'Başarısız'
  };
  return map[status] || status;
}

function translateSource(source) {
  const map = {
    partner_api: 'Partner API',
    portal_api: 'Portal geçmişi',
    webhook: 'Canlı (webhook)',
    poll: 'Otomatik poll',
    backfill: 'Geçmiş doldurma',
    manual: 'Manuel',
    fixture: 'Test verisi'
  };
  return map[source] || source || '—';
}

function translateConfidence(confidence) {
  const map = {
    complete: 'Tam',
    estimated: 'Tahmini',
    missing_cost: 'Maliyet eksik',
    missing_mapping: 'Eşleşme eksik',
    invalid_data: 'Geçersiz veri'
  };
  return map[confidence] || confidence || '—';
}

function refreshView(meta) {
  if (!serverPaginated) ordersPage = 1;
  const rows = filteredRows();
  const dq = meta?.dataQuality ?? lastDataQuality;
  if (!isOpsOrders) {
    renderSummary(rows, dq, {
      orderSources: meta?.orderSources ?? lastOrderSources,
      matchingSummary: meta?.matchingSummary ?? lastMatchingSummary
    });
    renderMatchingSummary(meta?.matchingSummary ?? lastMatchingSummary);
    renderQualityBanner(dq);
  }
  renderCacheBanner();
  renderSyncBanner();
  if (activeOrdersView === 'loss-products') {
    renderLossProducts();
  } else {
    if (!isOpsOrders) renderChart(rows);
    renderTable();
  }
  if (!isOpsOrders) syncQuickFilterButtons();
  const shown = rows.length;
  const fetchedNote = fetchedCount > shown ? ' (' + fetchedCount + ' API kaydından süzüldü)' : '';
  let footer = shown + ' sipariş gösteriliyor' + fetchedNote;
  if (!isOpsOrders && dq && dq.withWarnings > 0) {
    footer += ' · ' + dq.withWarnings + ' uyarılı kayıt';
  }
  if (lastUpdatedAt) {
    const time = new Date(lastUpdatedAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    footer += ' · Son güncelleme: ' + time + (lastFromCache ? ' (önbellek)' : '');
  }
  if (activeOrdersView !== 'loss-products') {
    footerEl.textContent = footer;
  }
  if (isMultiChannel && !isOpsOrders) renderMultiChannelSourceNote({ channels: lastHzlMrktOpsChannels || [] });
  if (isOpsOrders) {
    updateLifecycleTabCounts();
    if (!lifecycleTabUserSelected) {
      const activeCount = countLifecycleRows('active');
      const completedCount = countLifecycleRows('completed');
      if (activeLifecycleTab === 'active' && activeCount === 0 && completedCount > 0) {
        setActiveLifecycleTab('completed');
      }
    }
  }
  tryOpenPendingOrder();
}

function tryOpenPendingOrder() {
  if (!pendingOrderNumber || orderDeepLinkHandled) return;

  const target = pendingOrderNumber;
  let rows = sortedRows(filteredRows());
  let index = rows.findIndex((row) => String(row.orderNumber) === target);

  if (index < 0 && profitFilter && profitFilter.value !== 'all') {
    profitFilter.value = 'all';
    syncQuickFilterButtons();
    syncProfitQueryParam();
    rows = sortedRows(filteredRows());
    index = rows.findIndex((row) => String(row.orderNumber) === target);
  }

  if (index < 0) return;

  orderDeepLinkHandled = true;
  openDetail(index);
}

function rowMatchesDateRange(row) {
  const ms = normalizeOrderTimestamp(row.orderDateMs);
  if (!ms) return false;
  if (activeRange.startMs && ms < activeRange.startMs) return false;
  if (activeRange.endMs && ms > activeRange.endMs) return false;
  return true;
}

function countLifecycleRows(lifecycle) {
  let rows = allRows.slice().filter(rowMatchesDateRange);
  const status = statusFilter?.value;
  if (status) rows = rows.filter((r) => String(r.status) === status);
  return rows.filter((row) => lifecycle === 'completed' ? isOrderCompleted(row) : !isOrderCompleted(row)).length;
}

function updateOrdersListHeading() {
  if (!isOpsOrders) return;
  const listTitle = document.getElementById('ordersListTitle');
  if (listTitle) {
    listTitle.textContent = activeLifecycleTab === 'completed'
      ? 'Tamamlanmış siparişler'
      : 'Aktif siparişler';
  }
}

function updateOrdersHeroPeriodLabel() {
  const heroPeriod = document.getElementById('ordersHeroPeriod');
  if (!heroPeriod || !daysSelect) return;
  const value = daysSelect.value;
  const labels = {
    '1': 'Bugün',
    '7': '7 gün',
    '14': '14 gün',
    '30': '30 gün',
    '60': '60 gün',
    custom: 'Özel aralık'
  };
  heroPeriod.textContent = labels[value] || 'Dönem';
}

function updateLifecycleTabCounts() {
  if (!isOpsOrders) return;
  const activeCount = serverPaginated && lifecycleCountsFromServer
    ? Number(lifecycleCountsFromServer.active) || 0
    : countLifecycleRows('active');
  const completedCount = serverPaginated && lifecycleCountsFromServer
    ? Number(lifecycleCountsFromServer.completed) || 0
    : countLifecycleRows('completed');
  const activeEl = document.getElementById('lifecycleCountActive');
  const completedEl = document.getElementById('lifecycleCountCompleted');
  if (activeEl) activeEl.textContent = activeCount ? '(' + activeCount + ')' : '';
  if (completedEl) completedEl.textContent = completedCount ? '(' + completedCount + ')' : '';
  const heroActive = document.getElementById('ordersHeroActive');
  const heroCompleted = document.getElementById('ordersHeroCompleted');
  if (heroActive) heroActive.textContent = String(activeCount);
  if (heroCompleted) heroCompleted.textContent = String(completedCount);
  updateOrdersListHeading();
}

function setActiveLifecycleTab(lifecycle) {
  activeLifecycleTab = lifecycle === 'completed' ? 'completed' : 'active';
  document.querySelectorAll('.orders-lifecycle-tab').forEach((el) => {
    const selected = el.dataset.lifecycle === activeLifecycleTab;
    el.classList.toggle('active', selected);
    el.setAttribute('aria-selected', selected ? 'true' : 'false');
  });
  updateOrdersListHeading();
  restartOpsActiveAutoRefresh();
  if (serverPaginated) {
    ordersPage = 1;
    loadOrders();
  }
}

function restartOpsActiveAutoRefresh() {
  if (opsActiveRefreshTimer) {
    clearInterval(opsActiveRefreshTimer);
    opsActiveRefreshTimer = null;
  }
  if (!isOpsOrders || activeLifecycleTab !== 'active') return;
  opsActiveRefreshTimer = setInterval(() => {
    if (activeLifecycleTab !== 'active' || activeOrdersView !== 'orders') return;
    loadOrders(false, { silent: true }).catch(() => {});
  }, 90000);
}

function pickLifecycleTabAfterLoad() {
  if (!isOpsOrders || lifecycleTabUserSelected) return;
  const activeCount = serverPaginated && lifecycleCountsFromServer
    ? Number(lifecycleCountsFromServer.active) || 0
    : countLifecycleRows('active');
  const completedCount = serverPaginated && lifecycleCountsFromServer
    ? Number(lifecycleCountsFromServer.completed) || 0
    : countLifecycleRows('completed');
  if (!allRows.length && !ordersServerTotal) return;
  if (activeCount === 0 && completedCount > 0) {
    setActiveLifecycleTab('completed');
    return;
  }
  if (completedCount === 0 && activeCount > 0) {
    setActiveLifecycleTab('active');
  }
}

function isOrderCompleted(row) {
  const key = normalizeOrderStatusKey(row.status);
  return key ? TERMINAL_ORDER_STATUSES.has(key) : false;
}

function filteredRows() {
  let rows = allRows.slice();
  const status = statusFilter.value;
  const filter = profitFilter?.value || 'all';
  const matching = matchingFilter?.value || 'all';

  rows = rows.filter(rowMatchesDateRange);

  if (isOpsOrders) {
    rows = rows.filter((row) => activeLifecycleTab === 'completed' ? isOrderCompleted(row) : !isOrderCompleted(row));
  }

  if (status) rows = rows.filter((r) => String(r.status) === status);
  if (!isOpsOrders) {
    if (filter === 'profit') rows = rows.filter((r) => r.netProfit > 0);
    if (filter === 'loss') rows = rows.filter((r) => r.netProfit < 0);
    if (filter === 'zero') rows = rows.filter((r) => r.netProfit === 0);
    if (matchingEnabled() && matching !== 'all') {
      rows = rows.filter((row) => orderMatchesMatchingFilter(row, matching));
    }
  }
  const searchQuery = String(ordersSearch?.value || '').trim();
  if (searchQuery) {
    rows = rows.filter((row) => orderMatchesSearch(row, searchQuery));
  }
  return rows;
}

function worseLossProductStatus(current, next) {
  const a = LOSS_PRODUCT_MATCHING_SEVERITY[current] ?? 0;
  const b = LOSS_PRODUCT_MATCHING_SEVERITY[next] ?? 0;
  return b >= a ? next : current;
}

function lossProductHasIssue(item) {
  return LOSS_PRODUCT_MATCHING_ISSUES.includes(item.mappingStatus) || (item.costWarnings && item.costWarnings.length > 0);
}

function filteredRowsForLossProducts() {
  let rows = allRows.slice();
  const status = statusFilter.value;
  const matching = matchingFilter?.value || 'all';

  rows = rows.filter(rowMatchesDateRange);
  if (status) rows = rows.filter((r) => String(r.status) === status);
  if (matchingEnabled() && matching !== 'all') {
    rows = rows.filter((row) => orderMatchesMatchingFilter(row, matching));
  }
  return rows;
}

function aggregateLossProductsClient(rows) {
  const byBarcode = new Map();

  for (const order of rows || []) {
    if (Number(order.netProfit) >= 0) continue;

    for (const line of order.lines || []) {
      const barcode = String(line.barcode || '').trim();
      if (!barcode) continue;

      let entry = byBarcode.get(barcode);
      if (!entry) {
        entry = {
          barcode,
          productName: line.productName || barcode,
          masterBarcode: line.masterBarcode || '',
          mappingStatus: line.mappingStatus || 'legacy',
          costWarnings: [],
          costWarningSet: new Set(),
          lossOrderNumbers: [],
          lossOrderSet: new Set(),
          lineCount: 0,
          quantity: 0,
          totalSales: 0,
          totalCost: 0,
          totalCommission: 0,
          totalLineNet: 0,
          poolMatchUrl: line.poolMatchUrl || null
        };
        byBarcode.set(barcode, entry);
      }

      entry.lineCount += 1;
      entry.quantity += Number(line.quantity || 0);
      entry.totalSales += Number(line.lineSalesAmount || 0);
      entry.totalCost += Number(line.totalProductCost || 0);
      entry.totalCommission += Number(line.commissionAmount || 0);
      entry.totalLineNet += Number(line.lineNetBeforeFees || 0);
      entry.mappingStatus = worseLossProductStatus(entry.mappingStatus, line.mappingStatus || 'legacy');
      if (line.masterBarcode && !entry.masterBarcode) entry.masterBarcode = line.masterBarcode;
      if (line.poolMatchUrl && !entry.poolMatchUrl) entry.poolMatchUrl = line.poolMatchUrl;

      const orderNumber = String(order.orderNumber || '').trim();
      if (orderNumber && !entry.lossOrderSet.has(orderNumber)) {
        entry.lossOrderSet.add(orderNumber);
        entry.lossOrderNumbers.push(orderNumber);
      }

      for (const warning of line.costWarnings || []) {
        const text = String(warning || '').trim();
        if (!text || entry.costWarningSet.has(text)) continue;
        entry.costWarningSet.add(text);
        entry.costWarnings.push(text);
      }
    }
  }

  return Array.from(byBarcode.values())
    .map((item) => ({
      barcode: item.barcode,
      productName: item.productName,
      masterBarcode: item.masterBarcode,
      mappingStatus: item.mappingStatus,
      costWarnings: item.costWarnings,
      lossOrderNumbers: item.lossOrderNumbers,
      lossOrderCount: item.lossOrderNumbers.length,
      lineCount: item.lineCount,
      quantity: item.quantity,
      totalSales: roundMoney(item.totalSales),
      totalCost: roundMoney(item.totalCost),
      totalCommission: roundMoney(item.totalCommission),
      totalLineNet: roundMoney(item.totalLineNet),
      poolMatchUrl: item.poolMatchUrl
    }))
    .sort((a, b) => a.totalLineNet - b.totalLineNet || b.lossOrderCount - a.lossOrderCount);
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function switchOrdersView(view, options = {}) {
  if (!uberLossProductsPanel) return;
  activeOrdersView = view === 'loss-products' ? 'loss-products' : 'orders';

  uberOrdersSubnav?.querySelectorAll('[data-orders-view]').forEach((btn) => {
    const active = btn.dataset.ordersView === activeOrdersView;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  ordersListPanel?.toggleAttribute('hidden', activeOrdersView !== 'orders');
  uberLossProductsPanel.toggleAttribute('hidden', activeOrdersView !== 'loss-products');
  quickFilterRoot?.toggleAttribute('hidden', activeOrdersView !== 'orders');

  if (activeOrdersView === 'loss-products') {
    renderLossProducts();
  } else {
    renderChart(filteredRows());
    renderTable();
    const shown = filteredRows().length;
    const fetchedNote = fetchedCount > shown ? ' (' + fetchedCount + ' API kaydından süzüldü)' : '';
    footerEl.textContent = shown + ' sipariş gösteriliyor' + fetchedNote;
  }

  if (options.syncUrl !== false) {
    syncOrdersViewQueryParam();
  }
}

function syncOrdersViewQueryParam() {
  const params = new URLSearchParams(window.location.search);
  if (activeOrdersView === 'loss-products') params.set('view', 'loss-products');
  else params.delete('view');
  const next = params.toString();
  const url = next ? window.location.pathname + '?' + next : window.location.pathname;
  window.history.replaceState({}, '', url);
}

function currentLossProductItems() {
  const aggregated = aggregateLossProductsClient(filteredRowsForLossProducts());
  const query = String(lossProductsSearch?.value || '').trim().toLowerCase();
  const issuesOnly = Boolean(lossProductsIssuesOnly?.checked);
  let items = aggregated;

  if (issuesOnly) {
    items = items.filter((item) => lossProductHasIssue(item));
  }
  if (query) {
    items = items.filter((item) => {
      const haystack = [item.barcode, item.productName, item.masterBarcode].join(' ').toLowerCase();
      return haystack.includes(query);
    });
  }
  return items;
}

async function unmapAllLossProducts() {
  const items = currentLossProductItems();
  if (!items.length) {
    showToast('Listede kaldırılacak ürün yok.');
    return;
  }

  const mappable = items.filter((item) => item.mappingStatus && !['unmapped', 'legacy'].includes(item.mappingStatus));
  const barcodes = items.map((item) => item.barcode).filter(Boolean);
  const confirmText = mappable.length
    ? `Listedeki ${items.length} ürünün ${mappable.length} tanesinde Uber eşleştirmesi var.\n\nHepsini kaldırmak istediğinize emin misiniz?`
    : `Listedeki ${items.length} ürün için kayıtlı eşleştirme bulunamayabilir.\n\nYine de eşleştirme araması yapılsın mı?`;

  if (!window.confirm(confirmText)) return;

  lossProductsUnmapAllBtn.disabled = true;
  lossProductsUnmapAllBtn.textContent = 'Kaldırılıyor…';

  try {
    const response = await authFetch('/api/product-matching/remove-mappings-bulk', {
      method: 'POST',
      body: JSON.stringify({
        channelId: bootstrap.channelId || 'uber-eats',
        barcodes
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Eşleştirmeler kaldırılamadı.');

    showToast(
      data.removed > 0
        ? data.removed + ' eşleştirme kaldırıldı.' + (data.notFound ? ' (' + data.notFound + ' üründe eşleştirme yoktu)' : '')
        : 'Listede kaldırılacak eşleştirme bulunamadı.'
    );
    await loadOrders(true);
    if (activeOrdersView === 'loss-products') {
      switchOrdersView('loss-products', { syncUrl: false });
    }
  } catch (error) {
    showToast(error.message || 'Eşleştirmeler kaldırılamadı.');
  } finally {
    lossProductsUnmapAllBtn.disabled = false;
    lossProductsUnmapAllBtn.textContent = 'Tüm eşleştirmeleri kaldır';
  }
}

function renderLossProducts() {
  if (!lossProductsBody) return;

  const aggregated = aggregateLossProductsClient(filteredRowsForLossProducts());
  const items = currentLossProductItems();

  const statCount = document.getElementById('lossProdStatCount');
  const statNet = document.getElementById('lossProdStatNet');
  const statMatching = document.getElementById('lossProdStatMatching');
  const statCost = document.getElementById('lossProdStatCost');

  const totalLineNet = items.reduce((sum, item) => sum + Number(item.totalLineNet || 0), 0);
  const matchingIssues = items.filter((item) => LOSS_PRODUCT_MATCHING_ISSUES.includes(item.mappingStatus)).length;
  const costIssues = items.filter((item) => item.costWarnings && item.costWarnings.length).length;

  if (statCount) statCount.textContent = String(items.length);
  if (statNet) statNet.textContent = formatSignedMoney(totalLineNet);
  if (statMatching) statMatching.textContent = String(matchingIssues);
  if (statCost) statCost.textContent = String(costIssues);

  if (!aggregated.length) {
    lossProductsBody.innerHTML = '<tr><td colspan="10" class="orders-empty">Seçili dönemde zararlı sipariş satırı bulunamadı.</td></tr>';
    if (lossProductsFooter) {
      lossProductsFooter.textContent = 'Zararlı sipariş yok — dönemi genişletmeyi veya siparişleri yenilemeyi deneyin.';
    }
    return;
  }

  if (!items.length) {
    lossProductsBody.innerHTML = '<tr><td colspan="10" class="orders-empty">Filtreye uyan zarar eden ürün yok.</td></tr>';
    if (lossProductsFooter) {
      lossProductsFooter.textContent = aggregated.length + ' ürün var; filtreleri gevşetin.';
    }
    return;
  }

  lossProductsBody.innerHTML = items.map((item) => renderLossProductRow(item)).join('');
  lossProductsBody.querySelectorAll('[data-loss-order]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const orderNumber = btn.dataset.lossOrder;
      if (!orderNumber) return;
      pendingOrderNumber = orderNumber;
      orderDeepLinkHandled = false;
      switchOrdersView('orders');
      tryOpenPendingOrder();
    });
  });

  if (lossProductsFooter) {
    lossProductsFooter.textContent =
      items.length + ' ürün · ' +
      aggregated.reduce((sum, item) => sum + item.lossOrderCount, 0) + ' zararlı sipariş satırından';
  }
}

function renderLossProductRow(item) {
  const netClass = item.totalLineNet < 0 ? 'amount-neg' : item.totalLineNet > 0 ? 'amount-pos' : 'amount-neutral';
  const urls = buildLossProductEditUrls(item);
  const warnings = [];
  if (LOSS_PRODUCT_MATCHING_ISSUES.includes(item.mappingStatus)) {
    warnings.push(renderLineMappingBadge({ mappingStatus: item.mappingStatus, masterBarcode: item.masterBarcode, barcode: item.barcode, poolMatchUrl: urls.matching }));
  }
  if (item.costWarnings && item.costWarnings.length) {
    warnings.push('<span class="orders-loss-cost-warn">' + esc(item.costWarnings.join(' · ')) + '</span>');
  }
  const warningCell = warnings.length ? warnings.join('<br>') : '<span class="muted">—</span>';

  const orderSample = item.lossOrderNumbers.slice(0, 2).map((orderNumber) =>
    '<button type="button" class="orders-loss-order-link" data-loss-order="' + esc(orderNumber) + '" title="Sipariş detayını aç">#' + esc(orderNumber) + '</button>'
  ).join(' ');
  const orderMore = item.lossOrderCount > 2
    ? ' <button type="button" class="orders-loss-order-link orders-loss-order-more" data-loss-order="' + esc(item.lossOrderNumbers[2]) + '" title="İlk zarar siparişini aç">+' + (item.lossOrderCount - 2) + '</button>'
    : '';

  const barcodeCell = urls.matching
    ? '<a class="orders-barcode-link" href="' + esc(urls.matching) + '">' + esc(item.barcode) + '</a>'
    : renderBarcodeLink(item.barcode);

  return '<tr class="orders-loss-product-row">' +
    '<td class="orders-loss-product-cell">' + renderLossProductNameCell(item) + '</td>' +
    '<td>' + barcodeCell + '</td>' +
    '<td>' + renderLineMappingBadge({ ...item, poolMatchUrl: urls.matching }) + '</td>' +
    '<td class="orders-loss-orders-cell">' + orderSample + orderMore + '</td>' +
    '<td>' + esc(item.quantity) + '</td>' +
    '<td>₺' + formatMoney(item.totalSales) + '</td>' +
    '<td>₺' + formatMoney(item.totalCost) + '</td>' +
    '<td class="' + netClass + '">' + formatSignedMoney(item.totalLineNet) + '</td>' +
    '<td class="orders-loss-warn-cell">' + warningCell + '</td>' +
    '<td class="orders-loss-actions">' + renderLossProductActions(item) + '</td>' +
  '</tr>';
}

/** Backend isProfitKpiIncluded ile aynı kural: yalnızca complete/estimated güvenli kabul edilir. */
function isKpiIncludedRow(row) {
  if (row.ingestSource === 'fixture') return false;
  const confidence = row.profitConfidence || 'complete';
  return confidence === 'complete' || confidence === 'estimated';
}

function buildStats(rows) {
  const kpiRows = rows.filter(isKpiIncludedRow);

  let totalSales = 0;
  let totalProfit = 0;
  let profitable = 0;
  let loss = 0;

  for (const row of kpiRows) {
    totalSales += Number(row.salesAmount || 0);
    totalProfit += Number(row.netProfit || 0);
    if (row.netProfit > 0) profitable += 1;
    else if (row.netProfit < 0) loss += 1;
  }

  const count = rows.length;
  return {
    count,
    kpiCount: kpiRows.length,
    totalSales,
    totalProfit,
    avgProfit: kpiRows.length ? totalProfit / kpiRows.length : 0,
    profitable,
    loss
  };
}

const ORDERS_KPI_SESSION_KEY = 'buybox_orders_kpi_prev';

function renderKpiTrend(current, prev, higherIsBetter) {
  const c = Number(current);
  const p = Number(prev);
  if (prev == null || isNaN(c) || isNaN(p) || c === p) return '';
  const increased = c > p;
  const isPositive = higherIsBetter ? increased : !increased;
  return '<span class="kpi-trend ' + (isPositive ? 'kpi-trend--up' : 'kpi-trend--down') + '">' +
    (increased ? '▲' : '▼') + '</span>';
}

function setStatWithTrend(id, text, numericValue, prevValue, higherIsBetter) {
  const el = document.getElementById(id);
  if (!el) return;
  const trend = renderKpiTrend(numericValue, prevValue, higherIsBetter !== false);
  el.innerHTML = esc(String(text)) + trend;
}

function renderSummary(rows, dataQuality, meta) {
  const stats = buildStats(rows);
  let prev = {};
  try { prev = JSON.parse(sessionStorage.getItem(ORDERS_KPI_SESSION_KEY) || '{}'); } catch (_) {}

  setStatWithTrend('statCount', String(stats.count), stats.count, prev.count, true);
  setStatWithTrend('statSales', '₺' + formatMoney(stats.totalSales), stats.totalSales, prev.totalSales, true);
  setStatWithTrend('statProfit', formatSignedMoney(stats.totalProfit), stats.totalProfit, prev.totalProfit, true);
  document.getElementById('statProfit')?.classList?.toggle('amount-pos', stats.totalProfit >= 0);
  document.getElementById('statProfit')?.classList?.toggle('amount-neg', stats.totalProfit < 0);
  setStatWithTrend('statAvgProfit', formatSignedMoney(stats.avgProfit), stats.avgProfit, prev.avgProfit, true);
  setStatWithTrend('statProfitable', String(stats.profitable), stats.profitable, prev.profitable, true);
  setStatWithTrend('statLoss', String(stats.loss), stats.loss, prev.loss, false);

  try {
    sessionStorage.setItem(ORDERS_KPI_SESSION_KEY, JSON.stringify({
      count: stats.count,
      totalSales: stats.totalSales,
      totalProfit: stats.totalProfit,
      avgProfit: stats.avgProfit,
      profitable: stats.profitable,
      loss: stats.loss
    }));
  } catch (_) {}

  const sourceNote = meta?.orderSources?.label;
  const footerEl = document.getElementById('ordersSourceNote');
  if (footerEl) {
    footerEl.textContent = sourceNote || '';
    footerEl.hidden = !sourceNote;
  }

  const warningsEl = document.getElementById('statWarnings');
  if (warningsEl) {
    const warnCount = dataQuality?.withWarnings ?? rows.filter((r) => r.dataWarnings?.length).length;
    warningsEl.textContent = String(warnCount);
    warningsEl.closest('.ops-summary-item')?.classList.toggle('ops-summary-item--warn', warnCount > 0);
  }
}

function renderCacheBanner() {
  if (!cacheBannerEl) return;
  if (!lastFromCache) {
    cacheBannerEl.hidden = true;
    cacheBannerEl.innerHTML = '';
    return;
  }
  const secs = lastCacheMeta.cooldownSeconds;
  const waitNote = secs > 0
    ? 'Yenileme için yaklaşık ' + secs + ' sn beklemeniz gerekiyor.'
    : 'Kanal API’si kısa süre önce sorgulandı.';
  const detail = lastCacheMeta.message
    ? esc(lastCacheMeta.message)
    : 'Liste önbellekten gösteriliyor; canlı veri henüz çekilmedi.';
  cacheBannerEl.hidden = false;
  cacheBannerEl.innerHTML =
    '<strong>Önbellekten gösteriliyor</strong>' +
    '<span>' + detail + ' ' + waitNote + '</span>' +
    '<button type="button" class="btn-brown orders-cache-refresh" id="ordersCacheRefreshBtn">Şimdi yenile</button>';
  const btn = document.getElementById('ordersCacheRefreshBtn');
  if (btn && !btn.dataset.bound) {
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => loadOrders(true));
  }
}

function renderSyncBanner() {
  if (!syncBannerEl) return;

  const sync = lastGetirSync;
  const showForChannel = !isMultiChannel || activeChannelFilter === 'all' || activeChannelFilter === 'getir';
  if (!sync || !showForChannel) {
    syncBannerEl.hidden = true;
    syncBannerEl.innerHTML = '';
    return;
  }

  const lines = [];
  if (Array.isArray(sync.messages) && sync.messages.length) {
    lines.push(...sync.messages);
  } else if (Number(sync.ingested) > 0) {
    lines.push(`${sync.ingested} yeni Getir siparişi senkronize edildi.`);
  } else if (Number(sync.duplicates) > 0 && Number(sync.fetched) > 0) {
    lines.push(`${sync.duplicates} Getir siparişi güncellendi.`);
  }

  if (!lines.length) {
    syncBannerEl.hidden = true;
    syncBannerEl.innerHTML = '';
    return;
  }

  const isWarn = Boolean(sync.messages?.length) || Number(sync.failed) > 0 || sync.apiReady === false;
  syncBannerEl.hidden = false;
  syncBannerEl.className = 'orders-sync-banner' + (isWarn ? ' orders-sync-banner--warn' : ' orders-sync-banner--ok');
  syncBannerEl.innerHTML =
    '<strong>Getir senkron</strong>' +
    '<span>' + esc(lines.join(' · ')) + '</span>' +
    (isWarn ? ' <a href="/hzlmrktops/integrations?channel=getir">Entegrasyonlar</a>' : '');
}

function renderQualityBanner(dataQuality) {
  if (!qualityBannerEl) return;

  const count = Number(dataQuality?.withWarnings || 0);
  if (!count) {
    qualityBannerEl.hidden = true;
    qualityBannerEl.innerHTML = '';
    return;
  }

  const topIssues = Object.entries(dataQuality.byType || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([label, n]) => esc(label) + ' (' + n + ')')
    .join(' · ');

  qualityBannerEl.hidden = false;
  qualityBannerEl.innerHTML =
    '<strong>' + count + ' siparişte veri uyarısı</strong>' +
    '<span>Kâr hesabı eksik maliyet veya komisyon nedeniyle güvenilir olmayabilir.</span>' +
    (topIssues ? '<span class="orders-quality-detail">' + topIssues + '</span>' : '') +
    '<a href="' + esc(isChannelPage ? '/hzlmrktops/urunler' : '/hzlmrktops/urunler?emptyCostOnly=1') + '">Eksik maliyetleri düzelt</a>';
}

function matchingPoolUrl() {
  const channelId = bootstrap.channelId || 'uber-eats';
  return (bootstrap.matchingPath || '/hzlmrktops/urunler') + '?tab=' + encodeURIComponent(channelId);
}

function renderMatchingSummary(summary) {
  if (!matchingEnabled()) {
    if (matchingStripEl) matchingStripEl.hidden = true;
    if (matchingBannerEl) {
      matchingBannerEl.hidden = true;
      matchingBannerEl.innerHTML = '';
    }
    return;
  }

  const s = summary || {
    totalLines: 0,
    mappedLines: 0,
    unmappedLines: 0,
    fallbackLines: 0,
    legacyLines: 0
  };

  if (matchingStripEl) {
    matchingStripEl.hidden = false;
    const totalEl = document.getElementById('matchStatTotal');
    const mappedEl = document.getElementById('matchStatMapped');
    const unmappedEl = document.getElementById('matchStatUnmapped');
    const fallbackEl = document.getElementById('matchStatFallback');
    if (totalEl) totalEl.textContent = String(s.totalLines);
    if (mappedEl) mappedEl.textContent = String(s.mappedLines);
    if (unmappedEl) {
      unmappedEl.textContent = String(s.unmappedLines);
      unmappedEl.closest('.ops-summary-item')?.classList.toggle('ops-summary-item--warn', s.unmappedLines > 0);
    }
    if (fallbackEl) fallbackEl.textContent = String(s.fallbackLines + s.legacyLines);
  }

  if (!matchingBannerEl) return;

  if (!s.unmappedLines) {
    matchingBannerEl.hidden = true;
    matchingBannerEl.innerHTML = '';
    return;
  }

  const pct = s.totalLines ? Math.round((s.unmappedLines / s.totalLines) * 100) : 0;
  matchingBannerEl.hidden = false;
  matchingBannerEl.innerHTML =
    '<strong>' + s.unmappedLines + ' sipariş satırı eşleşmemiş</strong>' +
    '<span>Dönemdeki satırların yaklaşık %' + pct + ' kadarı onaylı eşleştirme bulamadı; kâr hesabı legacy maliyet veya sıfır maliyet kullanıyor olabilir.</span>' +
    '<a href="' + esc(matchingPoolUrl()) + '">Ürün Havuzu\'nda eşleştir</a>' +
    ' · <button type="button" class="orders-matching-filter-btn" id="ordersMatchingFilterBtn">Eşleşmemiş siparişleri göster</button>';
  document.getElementById('ordersMatchingFilterBtn')?.addEventListener('click', () => {
    if (!matchingFilter) return;
    matchingFilter.value = 'unmapped';
    syncMatchingQueryParam();
    syncMatchingQuickButtons();
    refreshView();
  });
}

function buildTimelineFromRows(rows, mode) {
  const buckets = new Map();

  for (const row of rows) {
    const key = mode === 'week' ? orderWeekKey(row.orderDateMs) : orderDayKey(row.orderDateMs);
    if (!key) continue;
    if (!buckets.has(key)) {
      buckets.set(key, { key, label: formatBucketLabel(key, mode), salesAmount: 0, netProfit: 0, count: 0 });
    }
    const bucket = buckets.get(key);
    bucket.salesAmount += Number(row.salesAmount || 0);
    bucket.netProfit += Number(row.netProfit || 0);
    bucket.count += 1;
  }

  return Array.from(buckets.values()).sort((a, b) => a.key.localeCompare(b.key));
}

function renderChart(rows) {
  if (!chartWrap) return;

  // Özet KPI ile aynı güven filtresi — grafik ve üst kartlar aynı kümeyi anlatsın.
  const data = buildTimelineFromRows((rows || filteredRows()).filter(isKpiIncludedRow), chartMode);
  if (!data.length) {
    chartWrap.innerHTML = '<p class="orders-chart-empty">Seçili filtreler için grafik verisi yok.</p>';
    return;
  }

  const width = Math.max(560, data.length * 48);
  const height = 220;
  const padX = 36;
  const padTop = 16;
  const padBottom = 36;
  const chartHeight = height - padTop - padBottom;
  const maxProfit = Math.max(...data.map((d) => Math.abs(d.netProfit)), 1);
  const maxSales = Math.max(...data.map((d) => d.salesAmount), 1);
  const barWidth = Math.min(28, (width - padX * 2) / data.length - 8);
  const gap = (width - padX * 2 - barWidth * data.length) / Math.max(data.length - 1, 1);

  let bars = '';
  data.forEach((point, index) => {
    const x = padX + index * (barWidth + gap);
    const salesH = (point.salesAmount / maxSales) * (chartHeight * 0.35);
    const profitAbs = Math.abs(point.netProfit);
    const profitH = (profitAbs / maxProfit) * (chartHeight * 0.55);
    const profitY = padTop + chartHeight * 0.35 - profitH;
    const salesY = padTop + chartHeight - salesH;
    const profitClass = point.netProfit >= 0 ? 'bar-profit' : 'bar-loss';

    bars +=
      '<rect class="bar-sales" x="' + x + '" y="' + salesY + '" width="' + barWidth + '" height="' + salesH + '" rx="3">' +
        '<title>' + esc(point.label) + ' — Ciro: ₺' + formatMoney(point.salesAmount) + '</title>' +
      '</rect>' +
      '<rect class="' + profitClass + '" x="' + x + '" y="' + profitY + '" width="' + barWidth + '" height="' + profitH + '" rx="3">' +
        '<title>' + esc(point.label) + ' — Kâr: ' + formatSignedMoney(point.netProfit) + ' (' + point.count + ' sipariş)</title>' +
      '</rect>' +
      '<text class="axis-label" x="' + (x + barWidth / 2) + '" y="' + (height - 8) + '" text-anchor="middle">' + esc(point.label) + '</text>';
  });

  chartWrap.innerHTML =
    '<div class="orders-chart">' +
      '<div class="orders-chart-legend">' +
        '<span class="legend-sales">Ciro</span>' +
        '<span class="legend-profit">Kâr</span>' +
        '<span class="legend-loss">Zarar</span>' +
      '</div>' +
      '<svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Sipariş kâr grafiği">' +
        '<line class="axis-line" x1="' + padX + '" y1="' + (padTop + chartHeight * 0.35) + '" x2="' + (width - padX) + '" y2="' + (padTop + chartHeight * 0.35) + '"></line>' +
        bars +
      '</svg>' +
    '</div>';
}

function sortedRows(rows) {
  const sorted = rows.slice();
  sorted.sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    if (typeof av === 'number' && typeof bv === 'number') {
      return sortDir === 'asc' ? av - bv : bv - av;
    }
    return sortDir === 'asc'
      ? String(av).localeCompare(String(bv), 'tr-TR')
      : String(bv).localeCompare(String(av), 'tr-TR');
  });
  return sorted;
}

function ensureOrdersPagination() {
  let bar = document.getElementById('ordersPagination');
  if (bar || !tableWrap) return bar;
  bar = document.createElement('div');
  bar.id = 'ordersPagination';
  bar.className = 'orders-pagination';
  tableWrap.insertAdjacentElement('afterend', bar);
  return bar;
}

function renderOrdersPagination(total) {
  const bar = ensureOrdersPagination();
  if (!bar) return;

  if (!total || total <= 10) {
    bar.innerHTML = '';
    bar.hidden = true;
    return;
  }

  const totalPages = ordersPageSize === 0 ? 1 : Math.max(1, Math.ceil(total / ordersPageSize));
  if (ordersPage > totalPages) ordersPage = totalPages;

  const sizeOptions = [10, 25, 50, 100, 0].map((size) => {
    const label = size === 0 ? 'Tümü' : String(size);
    return '<option value="' + size + '"' + (size === ordersPageSize ? ' selected' : '') + '>' + label + '</option>';
  }).join('');

  bar.hidden = false;
  bar.innerHTML =
    '<label class="orders-page-size">Sayfa başına ' +
      '<select id="ordersPageSizeSelect">' + sizeOptions + '</select>' +
    '</label>' +
    '<div class="orders-page-nav">' +
      '<button type="button" class="btn-detail" id="ordersPagePrev"' + (ordersPage <= 1 ? ' disabled' : '') + '>‹ Önceki</button>' +
      '<span class="orders-page-info">' + ordersPage + ' / ' + totalPages + '</span>' +
      '<button type="button" class="btn-detail" id="ordersPageNext"' + (ordersPage >= totalPages ? ' disabled' : '') + '>Sonraki ›</button>' +
    '</div>';

  document.getElementById('ordersPageSizeSelect')?.addEventListener('change', (e) => {
    ordersPageSize = Number(e.target.value) || 0;
    ordersPage = 1;
    if (serverPaginated) loadOrders();
    else renderTable();
  });
  document.getElementById('ordersPagePrev')?.addEventListener('click', () => {
    if (ordersPage > 1) {
      ordersPage -= 1;
      if (serverPaginated) loadOrders();
      else renderTable();
    }
  });
  document.getElementById('ordersPageNext')?.addEventListener('click', () => {
    const totalPages = ordersPageSize === 0 ? 1 : Math.max(1, Math.ceil((serverPaginated ? ordersServerTotal : total) / ordersPageSize));
    if (ordersPage < totalPages) {
      ordersPage += 1;
      if (serverPaginated) loadOrders();
      else renderTable();
    }
  });
}

function renderTable() {
  const rows = serverPaginated
    ? sortedRows(allRows)
    : sortedRows(filteredRows());

  document.querySelectorAll('.orders-table th[data-sort]').forEach((th) => {
    th.classList.toggle('sorted', th.dataset.sort === sortKey);
    const icon = th.querySelector('.sort-icon');
    if (icon) icon.textContent = th.dataset.sort === sortKey ? (sortDir === 'asc' ? '▲' : '▼') : '↕';
  });

  if (!rows.length) {
    renderOrdersPagination(serverPaginated ? ordersServerTotal : 0);
    const hasActiveFilter = (statusFilter && statusFilter.value) ||
      (ordersSearch && String(ordersSearch.value || '').trim()) ||
      (isOpsOrders && activeLifecycleTab === 'active' && countLifecycleRows('completed') > 0) ||
      (!isOpsOrders && profitFilter && profitFilter.value !== 'all') ||
      (!isOpsOrders && matchingFilter && matchingFilter.value !== 'all');
    const emptyHint = hasActiveFilter
      ? (isOpsOrders && activeLifecycleTab === 'active' && countLifecycleRows('completed') > 0
        ? 'Getir siparişleri çoğunlukla tamamlanmış — «Tamamlanmış Siparişler» sekmesine geçin.'
        : 'Filtreleri temizleyerek tüm siparişleri görebilirsiniz.')
      : 'Tarih aralığını genişletmeyi veya «Verileri Güncelle» ile yeniden çekmeyi deneyin.';
    tableBody.innerHTML =
      '<tr><td colspan="' + COL_COUNT + '" class="orders-empty">' +
        '<div class="orders-empty-state">' +
          '<span class="orders-empty-icon" aria-hidden="true">📭</span>' +
          '<strong>' + (hasActiveFilter ? 'Filtrelere uyan sipariş yok' : 'Bu dönemde sipariş yok') + '</strong>' +
          '<span>' + emptyHint + '</span>' +
          (hasActiveFilter ? '<button type="button" class="btn-ghost orders-empty-clear" id="ordersEmptyClearBtn">Filtreleri Temizle</button>' : '') +
        '</div>' +
      '</td></tr>';
    document.getElementById('ordersEmptyClearBtn')?.addEventListener('click', clearFilters);
    return;
  }

  const paginationTotal = serverPaginated ? ordersServerTotal : rows.length;
  const totalPages = ordersPageSize === 0 ? 1 : Math.max(1, Math.ceil(paginationTotal / ordersPageSize));
  if (ordersPage > totalPages) ordersPage = totalPages;
  const startIndex = ordersPageSize === 0 ? 0 : (ordersPage - 1) * ordersPageSize;
  const pageRows = serverPaginated
    ? rows
    : (ordersPageSize === 0 ? rows : rows.slice(startIndex, startIndex + ordersPageSize));
  currentTableRows = pageRows;

  // data-detail global (sıralı liste) indeksi taşır — openDetail tüm listede arar.
  tableBody.innerHTML = pageRows.map((row, index) =>
    isOpsOrders ? renderOpsRow(row, startIndex + index) : renderRow(row, startIndex + index)
  ).join('');
  tableBody.querySelectorAll('[data-detail]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      if (btn.tagName === 'A') e.preventDefault();
      openDetail(Number(btn.dataset.detail));
    });
  });
  tableBody.querySelectorAll('[data-invoice]').forEach((btn) => {
    btn.addEventListener('click', () => showToast('Fatura işlemi BenimPOS üzerinden yapılır.'));
  });
  renderOrdersPagination(paginationTotal);
}

function renderOpsRow(row, index) {
  const elapsed = formatElapsedMinutes(row.orderDateMs);
  const dateCell = formatOpsDate(row.orderDateMs) + (elapsed ? ' ' + elapsed : '');
  const sourceBadge = row.ingestSource
    ? '<span class="orders-source-pill" title="Sipariş kaynağı">' + esc(translateSource(row.ingestSource)) + '</span> '
    : '';
  return '<tr class="orders-ops-row">' +
    '<td>' + sourceBadge + '<a href="#" class="orders-id-link" data-detail="' + index + '">' + esc(row.orderNumber) + '</a></td>' +
    '<td class="orders-channel-logo-cell">' + renderChannelCell(row) + '</td>' +
    '<td>' + esc(row.customerName || '—') + '</td>' +
    '<td>' + esc(row.paymentMethod || 'Online') + '</td>' +
    '<td>' + esc(row.deliveryMethod || '—') + '</td>' +
    '<td class="orders-amount-cell">' + formatMoney(row.salesAmount) + ' ₺</td>' +
    '<td><span class="orders-status-pill orders-status-pill--ops">' + esc(translateStatus(row.status) || '—') + '</span></td>' +
    '<td class="orders-benimpos-cell">' + renderBenimposTransferBadge(row) + '</td>' +
    '<td class="orders-date-cell">' + esc(dateCell) + '</td>' +
    '<td><button type="button" class="btn-invoice" data-invoice="' + index + '" title="Fatura kes">Fatura Kes</button></td>' +
    '<td><button type="button" class="btn-detail btn-detail--icon" data-detail="' + index + '" title="Detay">🔍</button></td>' +
  '</tr>';
}

function renderBenimposTransferBadge(row) {
  const status = row.benimposTransferStatus;
  if (!status) {
    return '<span class="orders-benimpos-badge orders-benimpos-badge--na" title="BenimPOS aktarımı bu kanal için geçerli değil">—</span>';
  }

  const note = row.benimposTransferNote || '';
  const labels = {
    transferred: 'BenimPOS\'a aktarıldı',
    ready: 'BenimPOS aktarımına hazır',
    blocked: 'BenimPOS aktarımı engelli'
  };
  const channelId = row.channel || row.channelId || '';
  const matchHref = channelId
    ? '/hzlmrktops/urunler?tab=' + encodeURIComponent(channelId)
    : '/hzlmrktops/urunler';
  const title = note || labels[status] || 'BenimPOS aktarım durumu';

  const inner =
    '<span class="orders-benimpos-badge orders-benimpos-badge--' + escAttr(status) + '" title="' + escAttr(title) + '">' +
      '<img src="/assets/channels/benimpos.png" alt="" class="orders-benimpos-badge__logo" width="20" height="20" loading="lazy">' +
      '<span class="orders-benimpos-badge__state" aria-hidden="true"></span>' +
    '</span>';

  if (status === 'blocked' && channelId) {
    return '<a href="' + escAttr(matchHref) + '" class="orders-benimpos-link" title="' + escAttr(title + ' — Eşleştirmeye git') + '">' + inner + '</a>';
  }
  return inner;
}

function renderRow(row, index) {
  const profitClass = row.netProfit > 0 ? 'amount-pos' : row.netProfit < 0 ? 'amount-neg' : 'amount-neutral';
  const rowClasses = [];
  if (row.netProfit < 0) rowClasses.push('row-loss');
  if (row.dataWarnings?.length) rowClasses.push('row-warn');
  if (matchingEnabled() && orderMatchesMatchingFilter(row, 'needs_review')) rowClasses.push('row-match-warn');
  const warnBadge = row.dataWarnings?.length
    ? '<span class="orders-warn-dot" title="' + escAttr(row.dataWarnings.join(' · ')) + '">!</span> '
    : '';
  const sourceBadge = row.ingestSource
    ? '<span class="orders-source-pill" title="Sipariş kaynağı">' + esc(translateSource(row.ingestSource)) + '</span> '
    : '';
  const confidenceBadge = row.profitConfidence && row.profitConfidence !== 'complete'
    ? '<span class="orders-confidence-pill orders-confidence-' + escAttr(row.profitConfidence) + '" title="Kâr güveni">' + esc(translateConfidence(row.profitConfidence)) + '</span> '
    : '';
  const matchBadge = matchingEnabled() && orderMatchesMatchingFilter(row, 'unmapped')
    ? '<span class="orders-match-dot" title="Eşleşmemiş ürün satırı">◎</span> '
    : '';
  const channelCell = isMultiChannel
    ? '<td>' + renderChannelCell(row) + '</td>'
    : '';

  const customerCell = '<td class="orders-customer-cell">' + esc(row.customerName || '—') + '</td>';
  const deliveryCell = '<td class="orders-delivery-cell">' + esc(row.deliveryMethod || '—') + '</td>';

  return '<tr' + (rowClasses.length ? ' class="' + rowClasses.join(' ') + '"' : '') + '>' +
    channelCell +
    '<td>' + warnBadge + matchBadge + sourceBadge + confidenceBadge + esc(row.orderNumber) + '</td>' +
    '<td>' + esc(formatOrderDate(row.orderDateMs)) + '</td>' +
    customerCell +
    deliveryCell +
    '<td><span class="orders-status-pill">' + esc(translateStatus(row.status) || '—') + '</span></td>' +
    '<td class="amount-neutral">₺' + formatMoney(row.salesAmount) + '</td>' +
    '<td class="' + profitClass + '">' + formatSignedMoney(row.netProfit) + '</td>' +
    '<td class="' + profitClass + '">' + formatPercent(row.profitRate) + '</td>' +
    '<td class="' + profitClass + '">' + formatPercent(row.profitMargin) + '</td>' +
    '<td><button type="button" class="btn-detail" data-detail="' + index + '">Detay</button></td>' +
  '</tr>';
}

function openDetail(index) {
  if (isOpsOrders) return openOpsDetail(index);
  const rows = sortedRows(filteredRows());
  const row = rows[index];
  if (!row) return;

  modalTitle.textContent = 'Sipariş #' + row.orderNumber;
  syncOrderQueryParam(row.orderNumber);
  const matchingNotes = row.matchingWarnings && row.matchingWarnings.length
    ? row.matchingWarnings
    : [];
  const allWarnings = [...new Set([...(row.dataWarnings || []), ...matchingNotes])];
  modalBody.innerHTML =
    (allWarnings.length
      ? '<p class="orders-warn-box">' + esc(allWarnings.join(' · ')) + '</p>'
      : '') +
    '<div class="detail-grid">' +
      (isMultiChannel ? detailItem('Kanal', row.channelLabel || row.channel || '—') : '') +
      (row.customerName ? detailItem('Müşteri', row.customerName) : '') +
      (row.deliveryMethod ? detailItem('Teslimat', row.deliveryMethod) : '') +
      detailItem('Sipariş tarihi', formatOrderDate(row.orderDateMs)) +
      detailItem('Durum', translateStatus(row.status) || '—') +
      detailItem('Kaynak', translateSource(row.ingestSource)) +
      detailItem('Kâr güveni', translateConfidence(row.profitConfidence)) +
      detailItem('Sipariş tutarı', '₺' + formatMoney(row.salesAmount)) +
      detailItem('Ürün maliyeti', '₺' + formatMoney(row.productCost)) +
      detailItem('Ek maliyet', '₺' + formatMoney(row.extraCost)) +
      detailItem('Komisyon', '₺' + formatMoney(row.commissionAmount)) +
      detailItem('Kurye ücreti', formatShippingCostLabel(row)) +
      detailItem('Hizmet bedeli', '₺' + formatMoney(row.serviceFee)) +
      detailItem('Stopaj', '₺' + formatMoney(row.stopajAmount)) +
      detailItem('Satış KDV', '₺' + formatMoney(row.salesVat)) +
      detailItem('Alış KDV', '₺' + formatMoney(row.purchaseVat)) +
      detailItem('Komisyon KDV', '₺' + formatMoney(row.commissionVat)) +
      detailItem('Kurye KDV', '₺' + formatMoney(row.shippingVat)) +
      detailItem('Hizmet KDV', '₺' + formatMoney(row.serviceFeeVat)) +
      detailItem('Net ödenecek KDV', '₺' + formatMoney(row.payableVat)) +
      (row.carriedForwardVat > 0 ? detailItem('Devreden KDV', '₺' + formatMoney(row.carriedForwardVat)) : '') +
      detailItem('Net kâr', formatSignedMoney(row.netProfit)) +
      detailItem('Kâr oranı', formatPercent(row.profitRate)) +
      detailItem('Kâr marjı', formatPercent(row.profitMargin)) +
    '</div>' +
    renderMatchingActions(row) +
    renderLineItems(row.lines) +
    (bootstrap.benimposSaleEnabled
      ? '<div class="detail-actions">' +
        (row.benimposTransferStatus === 'blocked'
          ? '<p class="orders-warn-box">' + esc(row.benimposTransferNote || 'Eşleştirme eksik — BenimPOS gönderimi engelli.') + '</p>'
          : '') +
        '<button type="button" class="btn-green" id="benimposPreviewBtn">' +
        (row.benimposTransferStatus === 'blocked' ? 'Eşleştir ve BenimPOS\'a gönder' : 'BenimPOS\'a Gönder') +
        '</button>' +
        '<span class="muted detail-actions-note">Önce eşleştirme ön izlemesi — onaylı eşleştirmeler satışa gider.</span></div>'
      : '');

  showOrderModal();

  if (bootstrap.benimposSaleEnabled) {
    document.getElementById('benimposPreviewBtn')?.addEventListener('click', () => {
      const blocked = row.benimposTransferStatus === 'blocked';
      window.BuyBoxBenimposSale?.openPreview(row, activeDays, {
        focusLineBarcode: blocked ? findFirstBlockedLineBarcode(row) : '',
        openFirstBlockedInline: blocked
      });
    });
  }
}

function openOpsDetail(index) {
  const row = currentTableRows[index];
  if (!row) return;

  modalTitle.textContent = 'Sipariş Detayı';
  syncOrderQueryParam(row.orderNumber);

  const channelId = row.channel || row.channelId || '';
  const logos = channelLogos();
  const totals = opsOrderTotals(row, row.lines || []);
  const channelBlock = renderOpsChannelBlock(channelId, logos, row.channelLabel);

  modalBody.innerHTML =
    '<div class="ops-detail-layout ops-detail-layout--hzlmrktops">' +
      '<section class="ops-detail-section ops-detail-section--products">' +
        '<h4>Ürün Bilgileri</h4>' +
        renderOpsLineItems(row.lines, channelId) +
        renderOpsOrderTotalsFooter(totals, channelId) +
        renderOpsBenimposActions(row) +
      '</section>' +
      '<div class="ops-detail-side">' +
        '<section class="ops-detail-section">' +
          '<h4>Müşteri Bilgileri</h4>' +
          '<dl class="ops-detail-dl">' +
            detailItem('Adı Soyadı', row.customerName || '—') +
            detailItem('TC Kimlik No', row.customerIdentityNumber || '—') +
            detailItem('Telefon', formatOpsPhone(row)) +
            detailItem('Adres', row.customerAddress || '—') +
            detailItem('Müşteri notu', row.customerNote || '—') +
          '</dl>' +
        '</section>' +
        '<section class="ops-detail-section">' +
          '<h4>Kurye Bilgileri</h4>' +
          '<dl class="ops-detail-dl">' +
            detailItem('Kurye', row.deliveryMethod || '—') +
            detailItem('Telefon', row.courierPhone || '—') +
          '</dl>' +
        '</section>' +
        '<section class="ops-detail-section">' +
          '<h4>Sipariş Bilgileri</h4>' +
          '<dl class="ops-detail-dl">' +
            detailItem('Sipariş Kodu', row.orderNumber || '—') +
            '<div><span>Sipariş Durumu</span><strong>' + renderOpsStatusPill(row.status) + '</strong></div>' +
            '<div><span>Satış Kanalı</span><strong class="ops-channel-value">' + channelBlock + '</strong></div>' +
            detailItem('Ödeme Yöntemi', row.paymentMethod || 'Online') +
            detailItem('Not', row.orderNote || '—') +
            detailItem('Sipariş Tarihi', formatOpsDate(row.orderDateMs)) +
            detailItem('Teslim Tarihi', formatOpsDeliveryDate(row)) +
            renderOpsBenimposTransferDetail(row) +
          '</dl>' +
        '</section>' +
      '</div>' +
    '</div>';

  showOrderModal();
  bindOpsOrderDetailActions(row);
}

function lineNeedsBenimposMatch(line) {
  if (!matchingEnabled()) return false;
  const status = line.mappingStatus || 'legacy';
  return status !== 'manual_confirmed' && status !== 'legacy';
}

function findFirstBlockedLineBarcode(row) {
  const line = (row.lines || []).find((item) => lineNeedsBenimposMatch(item));
  return line ? String(line.barcode || '').trim() : '';
}

function bindOpsOrderDetailActions(row) {
  document.getElementById('benimposPreviewBtn')?.addEventListener('click', () => {
    const blocked = row.benimposTransferStatus === 'blocked';
    window.BuyBoxBenimposSale?.openPreview(row, activeDays, {
      focusLineBarcode: blocked ? findFirstBlockedLineBarcode(row) : '',
      openFirstBlockedInline: blocked
    });
  });

  modalBody.querySelectorAll('.ops-line-match-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const barcode = btn.getAttribute('data-line-barcode') || '';
      window.BuyBoxBenimposSale?.openPreview(row, activeDays, { focusLineBarcode: barcode });
    });
  });
}

function renderOpsBenimposActions(row) {
  if (!bootstrap.benimposSaleEnabled) return '';
  const channelId = row.channel || row.channelId || '';
  if (!['uber-eats', 'yemeksepeti', 'getir'].includes(channelId)) return '';

  const status = row.benimposTransferStatus;
  const note = row.benimposTransferNote || 'BenimPOS gönderimi için eşleştirme gerekli.';
  if (status === 'transferred') {
    return '<div class="ops-detail-actions ops-detail-actions--benimpos">' +
      '<p class="muted">' + esc(note) + '</p>' +
      '<button type="button" class="btn-green" id="benimposPreviewBtn">Ön izlemeyi tekrar aç</button>' +
      '<p class="muted ops-detail-actions-note">Yeniden göndermeden önce BenimPOS\'ta mevcut satışı iptal edin.</p></div>';
  }
  if (status === 'blocked') {
    return '<div class="ops-detail-actions ops-detail-actions--benimpos">' +
      '<p class="orders-warn-box">' + esc(note) + '</p>' +
      '<button type="button" class="btn-green" id="benimposPreviewBtn">Eşleştir ve BenimPOS\'a gönder</button>' +
      '<p class="muted ops-detail-actions-note">Engelli satırları ön izlemede eşleştirip ardından gönderebilirsiniz.</p></div>';
  }
  if (status !== 'ready') {
    return '<div class="ops-detail-actions ops-detail-actions--benimpos">' +
      '<p class="orders-warn-box">' + esc(note) + '</p></div>';
  }

  return '<div class="ops-detail-actions ops-detail-actions--benimpos">' +
    '<button type="button" class="btn-green" id="benimposPreviewBtn">BenimPOS\'a Gönder</button>' +
    '<p class="muted ops-detail-actions-note">Brüt fiyat, indirim ve komisyon BenimPOS satışına yansıtılır; net hakediş tutarı korunur.</p>' +
  '</div>';
}

function renderOpsBenimposTransferDetail(row) {
  const status = row.benimposTransferStatus;
  if (!status) return '';

  const labels = {
    transferred: 'Aktarıldı',
    ready: 'Gönderime hazır',
    blocked: 'Engelli'
  };
  const channelId = row.channel || row.channelId || '';
  const note = row.benimposTransferNote || '';
  const statusLabel = labels[status] || status;
  const matchLink = status === 'blocked' && channelId
    ? ' <a href="/hzlmrktops/urunler?tab=' + escAttr(channelId) + '" class="ops-detail-match-link">Eşleştir</a>'
    : '';

  return '<div><span>BenimPOS</span><strong class="orders-benimpos-detail orders-benimpos-detail--' + escAttr(status) + '">' +
    esc(statusLabel) + (note ? ' — ' + esc(note) : '') + matchLink +
    '</strong></div>';
}

function opsOrderTotalsFromPortal(portal) {
  const bagFee = Number(portal.bagFee) || 0;
  const orderAmount = Number(portal.orderAmount) || 0;
  return {
    basket: orderAmount > 0 && bagFee > 0 ? orderAmount : (Number(portal.price) || 0),
    discount: Number(portal.discount) || 0,
    campaignAmount: Number(portal.campaignAmount) || 0,
    bagFee,
    commission: Number(portal.orderCommission) > 0
      ? Number(portal.orderCommission)
      : (Number(portal.commission) || 0),
    orderCommission: Number(portal.orderCommission) || 0,
    commissionRate: portal.commissionRate ?? null,
    courierFee: Number(portal.courierFee ?? portal.deliveryFee) || 0,
    courierFeeRate: portal.courierFeeRate ?? null,
    fixedDistribution: Number(portal.fixedDistribution) || 0,
    totalDeductions: Number(portal.totalDeductions) || 0,
    withholdingRate: portal.withholdingRate ?? null,
    withholdingAmount: Number(portal.withholdingAmount) || 0,
    partialRefund: Number(portal.partialRefund) || 0,
    deliveryFee: Number(portal.deliveryFee) || 0,
    provision: Number(portal.provision) || 0,
    total: Math.max(0, Number(portal.price) - Number(portal.discount)),
    netHakedis: Number(portal.netEarning) || 0,
    settlementLoaded: true,
    ruleBased: portal.source === 'rules'
  };
}

function opsOrderTotals(row, lines) {
  const portal = row.portalFinancials;
  if (portal?.loaded) {
    return opsOrderTotalsFromPortal(portal);
  }

  const getir = row.getirFinancials;
  if (getir?.grossAmount > 0) {
    return opsOrderTotalsFromPortal({
      loaded: true,
      price: getir.grossAmount,
      orderAmount: getir.orderAmount,
      discount: getir.sellerDiscount,
      campaignAmount: getir.campaignAmount,
      bagFee: getir.bagFee,
      commission: getir.orderCommission,
      orderCommission: getir.orderCommission,
      commissionRate: getir.commissionRate,
      courierFee: getir.courierFee,
      courierFeeRate: getir.courierFeeRate,
      fixedDistribution: getir.fixedDistribution,
      totalDeductions: getir.totalDeductions,
      withholdingRate: getir.withholdingRate,
      withholdingAmount: getir.withholdingAmount,
      partialRefund: 0,
      deliveryFee: getir.courierFee,
      provision: 0,
      netEarning: getir.netAmount
    });
  }

  const items = Array.isArray(lines) ? lines : [];
  const lineSum = items.reduce((sum, line) => {
    const pricing = resolveOpsLineDisplayPrices(line);
    return sum + (Number(pricing.total) || 0);
  }, 0);
  const basket = lineSum > 0
    ? lineSum
    : Number(row.packageGrossAmount || row.salesAmount) || 0;
  const discount = Number(row.packageTotalDiscount) || 0;
  const lineCommission = items.reduce(
    (sum, line) => sum + (Number(line.portalCommissionAmount ?? line.saleCommissionAmount ?? line.commissionAmount) || 0),
    0
  );
  const commission = Number(row.packagePortalCommissionAmount) || lineCommission || Number(row.commissionAmount) || 0;
  const provisionNet = row.packageProvisionNet != null && row.packageProvisionNet !== ''
    ? Number(row.packageProvisionNet)
    : (Number(row.packageProvisionAmount) || 0);
  const sellerRevenue = Number(row.packageSellerRevenue) || 0;
  const discountSellerRevenue = Number(row.packageDiscountSellerRevenue) || 0;
  const total = discount > 0
    ? Math.max(0, basket - discount)
    : Number(row.salesAmount || basket) || 0;
  let netHakedis = null;
  if (sellerRevenue > 0 && discountSellerRevenue > 0) {
    netHakedis = Math.max(0, sellerRevenue - discountSellerRevenue - provisionNet);
  } else if (commission > 0) {
    netHakedis = Math.max(0, basket - discount - commission - provisionNet);
  }
  return {
    basket,
    discount,
    commission,
    commissionRate: null,
    partialRefund: Number(row.packagePartialRefund) || 0,
    deliveryFee: Number(row.packageDeliveryFee) || 0,
    provision: Number(row.portalProvisionCredit ?? row.packageProvisionAmount) || 0,
    total,
    netHakedis,
    settlementLoaded: false
  };
}

function renderOpsOrderTotalsFooter(totals, channelId = '') {
  if (totals.settlementLoaded) {
    return renderOpsPortalFinancialsFooter(totals, channelId);
  }

  const channelLabel = opsSettlementChannelLabel(channelId);
  const settlementNote = channelId === 'getir'
    ? ''
    : (channelId === 'uber-eats' || channelId === 'yemeksepeti')
      ? '<p class="muted ops-detail-settlement-note">' + esc(channelLabel) +
        ' gider özeti henüz yüklenmedi; komisyon ve net hakediş tahmini olabilir.</p>'
      : '';

  const discountRow = totals.discount > 0
    ? '<div class="ops-detail-total-row ops-detail-total-row--discount">' +
        '<span>İndirim</span><strong>-' + formatMoney(totals.discount) + ' ₺</strong>' +
      '</div>'
    : '';
  const commissionRow = totals.commission > 0
    ? '<div class="ops-detail-total-row ops-detail-total-row--commission">' +
        '<span>Komisyon</span><strong>-' + formatMoney(totals.commission) + ' ₺</strong>' +
      '</div>'
    : '';
  const netRow = totals.netHakedis != null
    ? '<div class="ops-detail-total-row ops-detail-total-row--net">' +
        '<span>Net Hakediş</span><strong>' + formatMoney(totals.netHakedis) + ' ₺</strong>' +
      '</div>'
    : '';
  const grandLabel = totals.netHakedis != null ? 'Ara Toplam' : 'TOPLAM';
  const grandValue = totals.netHakedis != null ? totals.total : totals.total;
  return '<div class="ops-detail-totals">' +
    '<div class="ops-detail-total-row"><span>Sepet</span><strong>' + formatMoney(totals.basket) + ' ₺</strong></div>' +
    discountRow +
    commissionRow +
    (totals.netHakedis != null
      ? '<div class="ops-detail-total-row ops-detail-total-row--subtotal">' +
          '<span>' + grandLabel + '</span><strong>' + formatMoney(grandValue) + ' ₺</strong>' +
        '</div>' + netRow
      : '<div class="ops-detail-total-row ops-detail-total-row--grand">' +
          '<span>TOPLAM</span><strong>' + formatMoney(totals.total) + ' ₺</strong>' +
        '</div>') +
    settlementNote +
  '</div>';
}

function renderOpsPortalFinancialsFooter(totals, channelId = '') {
  const channelLabel = opsSettlementChannelLabel(channelId);
  const commissionRate = totals.commissionRate != null
    ? '<span class="ops-portal-rate">%' + formatMoney(totals.commissionRate) + '</span>'
    : '';
  const courierRate = totals.courierFeeRate != null
    ? '<span class="ops-portal-rate">%' + formatMoney(totals.courierFeeRate) + '</span>'
    : '';
  const rows = [
    ['Fiyat', formatMoney(totals.basket) + ' ₺', ''],
    totals.discount > 0 ? ['Kampanya / İndirim', '-' + formatMoney(totals.discount) + ' ₺', 'is-deduct'] : null,
    totals.bagFee > 0 ? ['Poşet', formatMoney(totals.bagFee) + ' ₺', ''] : null,
    totals.commission > 0 ? ['Komisyon', '-' + formatMoney(totals.commission) + ' ₺', 'is-deduct', commissionRate] : null,
    totals.courierFee > 0 ? ['Kurye', '-' + formatMoney(totals.courierFee) + ' ₺', 'is-deduct', courierRate] : null,
    totals.fixedDistribution > 0 ? ['Sabit dağıtım', '-' + formatMoney(totals.fixedDistribution) + ' ₺', 'is-deduct'] : null,
    totals.partialRefund > 0 ? ['Kısmi İade', '-' + formatMoney(totals.partialRefund) + ' ₺', 'is-deduct'] : null,
    totals.deliveryFee > 0 && !totals.courierFee ? ['Teslimat Ücreti', '-' + formatMoney(totals.deliveryFee) + ' ₺', 'is-deduct'] : null,
    totals.provision !== 0 ? ['Provizyon', (totals.provision > 0 ? '+' : '-') + formatMoney(Math.abs(totals.provision)) + ' ₺', totals.provision > 0 ? 'is-credit' : 'is-deduct'] : null,
    totals.withholdingAmount > 0 ? ['Stopaj', '-' + formatMoney(totals.withholdingAmount) + ' ₺', 'is-deduct'] : null,
    totals.netHakedis != null ? ['İşletme alacağı', formatMoney(totals.netHakedis) + ' ₺', 'is-net'] : null
  ].filter(Boolean);

  const sourceNote = channelId === 'getir'
    ? 'Kaynak: PetFix Getir kural hesabı (%13,2 komisyon, stopaj; Getir kurye +%14,4).'
    : 'Kaynak: ' + esc(channelLabel) + ' cari ekstre (fiyat, indirim, iade, provizyon).';

  return '<div class="ops-portal-financials">' +
    '<div class="ops-portal-financials-head">' + esc(channelLabel) + ' gider özeti</div>' +
    '<table class="ops-portal-financials-table"><tbody>' +
    rows.map((row) =>
      '<tr><th>' + esc(row[0]) + '</th><td class="' + escAttr(row[2] || '') + '">' +
        '<strong>' + row[1] + '</strong>' + (row[3] || '') +
      '</td></tr>'
    ).join('') +
    '</tbody></table>' +
    '<p class="muted ops-detail-settlement-note">' + sourceNote + '</p>' +
  '</div>';
}

function renderOpsChannelBlock(channelId, logos, fallbackLabel) {
  if (!logos?.render) return esc(fallbackLabel || '—');
  const visual = logos.getVisual?.(channelId) || {};
  const label = visual.label || fallbackLabel || channelId || '—';
  return '<span class="ops-channel-inline">' +
    logos.render(channelId, { size: 'sm' }) +
    '<span class="ops-channel-label">' + esc(label) + '</span>' +
  '</span>';
}

function renderOpsStatusPill(status) {
  const label = translateStatus(status) || '—';
  const normalized = String(status || '').toLowerCase();
  const done = ['delivered', 'completed', 'picked_up', 'finished'].includes(normalized)
    || ['Delivered', 'COMPLETED', 'PICKED_UP'].includes(String(status || ''));
  const cancelled = ['cancelled', 'canceled', 'cancelled'].includes(normalized)
    || ['Cancelled', 'CANCELLED', 'CANCELED'].includes(String(status || ''));
  const cls = cancelled ? ' ops-status-pill--cancelled' : (done ? ' ops-status-pill--done' : '');
  return '<span class="ops-status-pill' + cls + '">' + esc(label) + '</span>';
}

function opsLineThumbHtml(line, channelId) {
  const directUrl = String(line.imageUrl || '').trim();
  const barcode = String(line.masterBarcode || line.costBarcode || line.barcode || '').trim();
  const channel = String(channelId || '').trim();
  if (directUrl) {
    return '<img class="orders-line-img ops-product-thumb" src="' + escAttr(directUrl) + '" width="56" height="56" loading="lazy" alt="" ' +
      'onerror="this.onerror=null;this.classList.add(\'is-missing\');this.removeAttribute(\'src\');">';
  }
  if (barcode) {
    const params = new URLSearchParams({ barcode });
    if (channel) params.set('channel', channel);
    return '<img class="orders-line-img ops-product-thumb" src="/api/product-thumb-img?' + params.toString() + '" width="56" height="56" loading="lazy" alt="" ' +
      'onerror="this.onerror=null;this.classList.add(\'is-missing\');this.removeAttribute(\'src\');">';
  }
  return '<span class="orders-line-img orders-line-img--placeholder ops-product-thumb" aria-hidden="true"></span>';
}

function renderOpsQtyBadge(quantity) {
  const qty = Number(quantity) || 1;
  const multi = qty > 1 ? ' ops-qty-badge--multi' : '';
  return '<span class="ops-qty-badge' + multi + '">' + esc(qty) + '</span>';
}

function renderOpsLineMappingCell(line, channelId) {
  const status = line.mappingStatus || 'legacy';
  if (status === 'legacy') {
    return '<td class="ops-line-match-cell"><span class="muted">—</span></td>';
  }

  const badgeHtml = renderLineMappingBadge(line, channelId);
  let actionHtml = '';
  if (bootstrap.benimposSaleEnabled && lineNeedsBenimposMatch(line)) {
    const barcode = String(line.barcode || '').trim();
    const label = status === 'auto_matched' ? 'Onayla' : 'Eşleştir';
    actionHtml = barcode
      ? '<button type="button" class="btn-mini ops-line-match-btn" data-line-barcode="' +
        escAttr(barcode) + '">' + esc(label) + '</button>'
      : '';
  }

  return '<td class="ops-line-match-cell">' + badgeHtml + actionHtml + '</td>';
}

function resolveOpsLineDisplayPrices(line) {
  const qty = Number(line.quantity) || 1;
  let unit = Number(line.unitSalesPrice ?? line.lineUnitPrice ?? line.unitPrice) || 0;
  let total = Number(line.lineSalesAmount ?? line.lineGrossAmount) || 0;

  if (unit > 0 && total > 0 && Math.abs(total - unit) < 0.02 && qty > 1) {
    total = unit * qty;
  } else if (unit > 0 && !total) {
    total = unit * qty;
  } else if (total > 0 && !unit) {
    unit = total / qty;
  } else if (unit > 0 && total > 0 && Math.abs(total - unit * qty) > 0.05) {
    total = unit * qty;
  }

  return { unit, total, qty };
}

function renderOpsLineItems(lines, channelId) {
  if (!lines || !lines.length) {
    return '<p class="muted">Ürün satırı yok.</p>';
  }

  const showMatching = matchingEnabled();
  const rows = lines.map((line) => {
    const barcode = String(line.barcode || line.masterBarcode || '').trim();
    const pricing = resolveOpsLineDisplayPrices(line);
    const brand = String(line.brandName || '—').trim() || '—';
    const imgCell = opsLineThumbHtml(line, channelId);
    return '<tr>' +
      '<td class="ops-product-name-cell">' +
        '<div class="ops-product-row">' + imgCell +
          '<div class="ops-product-copy">' +
            '<div class="ops-product-title">' + esc(line.productName || barcode || '—') + '</div>' +
            (barcode ? '<div class="ops-product-barcode">' + esc(barcode) + '</div>' : '') +
          '</div>' +
        '</div>' +
      '</td>' +
      '<td class="ops-brand-cell">' + esc(brand) + '</td>' +
      '<td class="ops-money-cell">' + formatMoney(pricing.unit) + ' ₺</td>' +
      '<td class="ops-qty-cell">' + renderOpsQtyBadge(pricing.qty) + '</td>' +
      '<td class="ops-money-cell">' + formatMoney(pricing.total) + ' ₺</td>' +
      (showMatching ? renderOpsLineMappingCell(line, channelId) : '') +
    '</tr>';
  }).join('');

  return '<div class="ops-products-wrap">' +
    '<table class="ops-products-table ops-products-table--hzlmrktops">' +
      '<thead><tr>' +
        '<th>Ürün</th><th>Marka</th><th>Birim Fiyat</th><th>Miktar</th><th>Toplam Fiyat</th>' +
        (showMatching ? '<th>Eşleşme</th>' : '') +
      '</tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
    '</table>' +
  '</div>';
}

function matchingEnabled() {
  return String(bootstrap.productMatchingMode || 'legacy') !== 'legacy';
}

function buildPoolMatchUrl(line, orderChannelId) {
  if (line.poolMatchUrl) return line.poolMatchUrl;
  const channelId = orderChannelId || bootstrap.channelId;
  if (!matchingEnabled() || !channelId) return '';
  const barcode = String(line.barcode || '').trim();
  if (!barcode) return '';
  return buildPoolMatchUrlForStatus(barcode, line.mappingStatus || 'legacy', channelId);
}

function buildPoolMatchUrlForStatus(barcode) {
  const code = String(barcode || '').trim();
  if (!code) return '';
  return (bootstrap.matchingPath || '/hzlmrktops/urunler') + '?q=' + encodeURIComponent(code);
}

function buildMasterPoolUrl(barcode) {
  return buildPoolMatchUrlForStatus(barcode);
}

function buildUberCatalogUrl(barcode, options = {}) {
  const code = String(barcode || '').trim();
  if (!code) return '';
  const params = new URLSearchParams();
  params.set('tab', 'uber-eats');
  params.set('q', code);
  if (options.openMap) params.set('openMap', '1');
  if (options.status) params.set('status', options.status);
  return (bootstrap.matchingPath || '/products') + '?' + params.toString();
}

function buildLossProductEditUrls(item) {
  const channelBarcode = String(item.barcode || '').trim();
  const masterBarcode = String(item.masterBarcode || '').trim();
  const costBarcode = masterBarcode || channelBarcode;
  const status = item.mappingStatus || 'legacy';

  return {
    matching: item.poolMatchUrl || buildPoolMatchUrlForStatus(channelBarcode, status, 'uber-eats'),
    uberCatalog: buildUberCatalogUrl(channelBarcode),
    masterPool: buildMasterPoolUrl(masterBarcode || channelBarcode),
    channelCost: productsUrlForBarcode(costBarcode)
  };
}

function renderLossProductActions(item) {
  const urls = buildLossProductEditUrls(item);
  const parts = [];

  if (urls.matching) {
    parts.push('<a class="orders-loss-action-btn orders-loss-action-btn--primary" href="' + esc(urls.matching) + '">Uber eşleştir</a>');
  }
  if (urls.masterPool) {
    parts.push('<a class="orders-loss-action-btn" href="' + esc(urls.masterPool) + '">Ana havuz</a>');
  }
  if (urls.channelCost) {
    parts.push('<a class="orders-loss-action-btn" href="' + esc(urls.channelCost) + '">Maliyet</a>');
  }
  if (urls.uberCatalog && urls.uberCatalog !== urls.matching) {
    parts.push('<a class="orders-loss-action-btn orders-loss-action-btn--ghost" href="' + esc(urls.uberCatalog) + '">Uber katalog</a>');
  }

  return parts.length
    ? '<div class="orders-loss-action-stack">' + parts.join('') + '</div>'
    : '<span class="muted">—</span>';
}

function renderLossProductNameCell(item) {
  const urls = buildLossProductEditUrls(item);
  const title = esc(item.productName || item.barcode);
  const masterMeta = item.masterBarcode && item.masterBarcode !== item.barcode
    ? '<div class="orders-loss-master-meta"><span class="muted">BenimPOS:</span> ' +
      '<a class="orders-barcode-link" href="' + esc(urls.masterPool) + '">' + esc(item.masterBarcode) + '</a></div>'
    : '';
  const nameLink = urls.matching
    ? '<a class="orders-loss-product-link" href="' + esc(urls.matching) + '">' + title + '</a>'
    : title;
  return nameLink + masterMeta;
}

function renderMatchingActions(row) {
  if (!matchingEnabled()) return '';
  const channelId = row.channel || row.channelId || bootstrap.channelId;
  if (!channelId) return '';
  const lines = row.lines || [];
  if (!lines.length) return '';

  const chips = [];
  const seen = new Set();
  for (const line of lines) {
    const url = buildPoolMatchUrl(line, channelId);
    const barcode = String(line.barcode || '').trim();
    if (!url || !barcode || seen.has(barcode)) continue;
    seen.add(barcode);
    const label = line.productName || barcode;
    const warn = line.costWarnings && line.costWarnings.length;
    chips.push(
      '<a class="orders-match-chip' + (warn ? ' orders-match-chip--warn' : '') + '" href="' + esc(url) + '">' +
        esc(label.length > 48 ? label.slice(0, 45) + '…' : label) +
        ' <span class="orders-match-chip-cta">Eşleştir →</span>' +
      '</a>'
    );
  }

  if (!chips.length) return '';

  return '<div class="orders-detail-match-actions">' +
    '<h4>Ürün eşleştirme</h4>' +
    '<p class="muted orders-detail-hint">Satırdaki ürünlerden Ana Ürün Havuzu\'nda eşleştirmeyi düzenleyin.</p>' +
    '<div class="orders-match-chips">' + chips.join('') + '</div>' +
  '</div>';
}

function productsUrlForBarcode(barcode) {
  const code = String(barcode || '').trim();
  if (!code) return bootstrap.productsPath || '/hzlmrktops/urunler';
  return (bootstrap.productsPath || '/hzlmrktops/urunler') + '?barcode=' + encodeURIComponent(code);
}

function renderBarcodeLink(barcode) {
  const code = String(barcode || '').trim();
  if (!code) return '—';
  return '<a class="orders-barcode-link" href="' + esc(productsUrlForBarcode(code)) + '">' + esc(code) + '</a>';
}

function renderLineCostMeta(line) {
  const parts = [];
  if (line.costSourceLabel) {
    parts.push('<div class="orders-cost-meta"><span class="muted">Maliyet kaynağı:</span> ' + esc(line.costSourceLabel) + '</div>');
  }
  if (line.costBarcode && line.costBarcode !== line.barcode) {
    parts.push('<div class="orders-cost-meta"><span class="muted">Maliyet barkodu:</span> ' + renderBarcodeLink(line.costBarcode) + '</div>');
  }
  if (line.costProductName && line.costProductName !== line.productName) {
    parts.push('<div class="orders-cost-meta"><span class="muted">Maliyet ürünü:</span> ' + esc(line.costProductName) + '</div>');
  }
  if (line.costWarnings && line.costWarnings.length) {
    parts.push('<div class="orders-cost-warn">' + esc(line.costWarnings.join(' · ')) + '</div>');
  }
  return parts.join('');
}

function renderLineItems(lines) {
  if (!lines || !lines.length) {
    return '<p class="muted">Satır detayı yok.</p>';
  }

  const showMapping = matchingEnabled() && Boolean(bootstrap.channelId);
  const showCostMeta = true;
  const head = showMapping
    ? '<th class="orders-line-img-th"></th><th>Ürün</th><th>Barkod</th><th>Adet</th><th>Satış</th><th>Maliyet</th><th>Komisyon</th><th>Maliyet kaynağı</th><th>Eşleşme</th>'
    : '<th class="orders-line-img-th"></th><th>Ürün</th><th>Barkod</th><th>Adet</th><th>Satış</th><th>Maliyet</th><th>Komisyon</th><th>Maliyet kaynağı</th>';

  const rows = lines.map((line) => {
    const barcode = String(line.masterBarcode || line.barcode || '').trim();
    const imgCell = barcode
      ? '<td class="orders-line-img-td"><img class="orders-line-img" src="/api/product-thumb-img?barcode=' + encodeURIComponent(barcode) + '" width="48" height="48" loading="lazy" alt="" onerror="this.style.display=\'none\'"></td>'
      : '<td class="orders-line-img-td"></td>';
    const mappingCell = showMapping
      ? '<td>' + renderLineMappingBadge(line, bootstrap.channelId) + '</td>'
      : '';
    const costMetaCell = showCostMeta
      ? '<td class="orders-cost-cell">' + renderLineCostMeta(line) + '</td>'
      : '';
    const rowClass = line.costWarnings && line.costWarnings.length ? ' class="orders-line-warn"' : '';
    return '<tr' + rowClass + '>' +
      imgCell +
      '<td>' + esc(line.productName || line.barcode) + '</td>' +
      '<td>' + renderBarcodeLink(line.barcode) + '</td>' +
      '<td>' + esc(line.quantity) + '</td>' +
      '<td>₺' + formatMoney(line.lineSalesAmount) + '</td>' +
      '<td>₺' + formatMoney(line.totalProductCost) + '</td>' +
      '<td>₺' + formatMoney(line.commissionAmount) + '</td>' +
      costMetaCell +
      mappingCell +
    '</tr>';
  }).join('');

  return '<div class="detail-lines">' +
    '<h4>Ürün satırları</h4>' +
    '<p class="muted orders-detail-hint">Barkoda tıklayarak <strong>Ürün Ayarları</strong>nda maliyet kaydını açabilirsiniz.' +
      (showMapping ? ' Eşleşme sütunundan <strong>Ürün Havuzu</strong>na gidebilirsiniz.' : '') +
    '</p>' +
    '<table><thead><tr>' + head + '</tr></thead>' +
    '<tbody>' + rows + '</tbody></table></div>';
}

function renderLineMappingBadge(line, orderChannelId) {
  const status = line.mappingStatus || 'legacy';
  const labels = {
    auto_matched: 'Otomatik',
    manual_confirmed: 'Onaylı',
    missing_master: 'BenimPOS yok',
    pending: 'Bekliyor',
    review_required: 'Kontrol',
    barcode_conflict: 'Çakışma',
    legacy_fallback: 'Fallback',
    unmapped: 'Eşleşmedi',
    legacy: 'Legacy'
  };
  const cls = ['missing_master', 'barcode_conflict', 'review_required', 'pending', 'unmapped'].includes(status)
    ? 'orders-map-badge orders-map-badge--warn'
    : (status === 'auto_matched' || status === 'manual_confirmed' ? 'orders-map-badge orders-map-badge--ok' : 'orders-map-badge');
  let html = '<span class="' + cls + '">' + esc(labels[status] || status) + '</span>';
  if (line.masterBarcode && line.masterBarcode !== line.barcode) {
    html += '<div class="orders-map-meta">→ ' + esc(line.masterBarcode) + '</div>';
  }
  const poolUrl = buildPoolMatchUrl(line, orderChannelId);
  if (poolUrl && !bootstrap.benimposSaleEnabled) {
    html += '<div class="orders-map-actions">' +
      '<a href="' + esc(poolUrl) + '" class="orders-map-link">Eşleştirmeyi düzenle</a>' +
      '</div>';
  }
  return html;
}

function detailItem(label, value) {
  return '<div><span>' + esc(label) + '</span><strong>' + esc(String(value)) + '</strong></div>';
}

function closeModal() {
  if (modalBackdrop) {
    modalBackdrop.classList.remove('open');
    modalBackdrop.hidden = true;
  }
  syncOrderQueryParam('');
}

function showOrderModal() {
  if (!modalBackdrop) return;
  modalBackdrop.hidden = false;
  modalBackdrop.classList.add('open');
}

function handleBenimposSaleSuccess(detail) {
  closeModal();
  window.BuyBoxBenimposSale?.close?.();

  const orderNumber = String(detail.orderNumber || '').trim();
  const salesCode = String(detail.salesCode || '').trim();
  if (orderNumber && salesCode) {
    const row = allRows.find((item) => String(item.orderNumber) === orderNumber);
    if (row) {
      row.benimposSalesCode = salesCode;
      row.benimposTransferStatus = 'transferred';
      row.benimposTransferNote = `BenimPOS satışı: ${salesCode}`;
      refreshView();
    }
  }

  const toastMessage = salesCode
    ? `BenimPOS satış oluşturuldu: ${salesCode}`
    : (detail.message || 'BenimPOS satışı oluşturuldu');
  showToast(toastMessage);
}

async function exportReport() {
  const params = buildQueryParams();
  if (statusFilter.value) params.set('status', statusFilter.value);
  if (profitFilter && profitFilter.value !== 'all') params.set('profit', profitFilter.value);

  const response = await authFetch(ORDERS_EXPORT_API + '?' + params.toString());
  if (!response.ok) {
    showToast('Rapor indirilemedi.');
    return;
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (isMultiChannel ? 'hzlmrktops' : (bootstrap.channelId || 'siparis')) + '-karlilik.csv';
  a.click();
  URL.revokeObjectURL(url);
  showToast('Rapor indirildi.');
}

function setZoom(scale) {
  tableScale = Math.min(1.1, Math.max(0.7, scale));
  if (tableWrap) tableWrap.style.fontSize = (tableScale * 100) + '%';
  const zoomLabel = document.getElementById('zoomLabel');
  if (zoomLabel) zoomLabel.textContent = Math.round(tableScale * 100) + '%';
}

function toInputDate(date) {
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function formatShippingCostLabel(row) {
  const amount = '₺' + formatMoney(row.shippingCost);
  if (row.shippingCostSource === 'dhl') {
    const tag = row.shippingCostEstimated ? 'DHL tahmini' : 'DHL gerçek';
    const parts = [amount, '<span class="muted">(' + esc(tag) + ')</span>'];
    if (toNumber(row.returnShippingCost) > 0) {
      parts.push('<span class="muted">iade ₺' + formatMoney(row.returnShippingCost) + '</span>');
    }
    return parts.join(' ');
  }
  if (row.shippingCostEstimated && row.shippingCostSource === 'desi') {
    return amount + ' <span class="muted">(desi tahmini)</span>';
  }
  return amount;
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatSignedMoney(value) {
  const n = Number(value || 0);
  const prefix = n < 0 ? '-₺' : '₺';
  return prefix + formatMoney(Math.abs(n));
}

function formatPercent(value) {
  const n = Number(value || 0);
  return (n >= 0 ? '' : '-') + Math.abs(n).toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
}

function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toastEl.classList.remove('show'), 2600);
}

function getStoredToken() {
  return window.BuyBoxCommon.getStoredToken();
}

function redirectToLogin() {
  window.BuyBoxCommon.redirectToLogin();
}

function logout() {
  window.BuyBoxCommon.logout();
}

async function authFetch(url, options = {}) {
  return window.BuyBoxCommon.authFetch(url, options);
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(value) {
  return esc(value).replace(/'/g, '&#39;');
}

async function loadEmailSettings() {
  const statusEl = document.getElementById('emailStatus');
  const smtpNoteEl = document.getElementById('emailSmtpNote');
  try {
    const response = await authFetch('/api/email-settings');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Ayarlar yüklenemedi');

    const s = data.settings || {};
    document.getElementById('emailEnabled').checked = Boolean(s.enabled);
    document.getElementById('emailTo').value = s.to || 'petfixltd@gmail.com';
    document.getElementById('emailInterval').value = s.checkIntervalMinutes || 5;
    document.getElementById('emailLookback').value = s.lookbackHours || 6;

    const smtpParts = [];
    if (data.smtpConfigured) {
      smtpParts.push('SMTP hazır');
      if (data.smtpFrom) smtpParts.push('Gönderen: ' + data.smtpFrom);
    } else {
      smtpParts.push('SMTP eksik — .env dosyasına Gmail uygulama şifresi ekleyin');
    }
    smtpNoteEl.textContent = smtpParts.join(' · ');

    const alerts = data.alerts || {};
    statusEl.textContent = buildEmailStatusText(s, alerts);
  } catch (error) {
    statusEl.textContent = 'E-posta ayarları yüklenemedi: ' + error.message;
  }
}

function buildEmailStatusText(settings, alerts) {
  const parts = [];
  parts.push(settings.enabled ? 'Bildirim açık' : 'Bildirim kapalı');
  if (alerts.lastCheckAt) parts.push('Son kontrol: ' + formatLocalTime(alerts.lastCheckAt));
  if (alerts.sentCount) parts.push('Gönderilen: ' + alerts.sentCount);
  if (alerts.lastError) parts.push('Son hata: ' + alerts.lastError);
  return parts.join(' · ');
}

function formatLocalTime(iso) {
  try {
    return new Date(iso).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
  } catch {
    return iso;
  }
}

function emailPayloadFromForm() {
  return {
    enabled: document.getElementById('emailEnabled').checked,
    to: document.getElementById('emailTo').value.trim(),
    checkIntervalMinutes: document.getElementById('emailInterval').value,
    lookbackHours: document.getElementById('emailLookback').value
  };
}

async function saveEmailSettings() {
  try {
    const response = await authFetch('/api/email-settings', {
      method: 'POST',
      body: JSON.stringify(emailPayloadFromForm())
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Kaydedilemedi');
    document.getElementById('emailStatus').textContent = buildEmailStatusText(data.settings || {}, data.alerts || {});
    showToast('E-posta ayarları kaydedildi.');
    loadEmailSettings();
  } catch (error) {
    showToast(error.message);
  }
}

async function testEmail() {
  try {
    await saveEmailSettings();
    const response = await authFetch('/api/email-test', { method: 'POST', body: '{}' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Test başarısız');
    showToast(data.message || 'Test e-postası gönderildi.');
    loadEmailSettings();
  } catch (error) {
    showToast(error.message);
  }
}

async function checkEmailNow() {
  try {
    const response = await authFetch('/api/email-check-now', { method: 'POST', body: '{}' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Kontrol başarısız');
    const count = (data.notified || []).length;
    showToast(count ? count + ' yeni zarar bildirimi gönderildi.' : 'Yeni zarar siparişi yok.');
    loadEmailSettings();
  } catch (error) {
    showToast(error.message);
  }
}
})();
