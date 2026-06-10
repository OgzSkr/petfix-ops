'use strict';

const MATCHING_UI_VERSION = '65';

function readMatchingBootstrap() {
  if (typeof window !== 'undefined' && window.__PANEL__ && typeof window.__PANEL__ === 'object') {
    return window.__PANEL__;
  }
  const bootEl = document.getElementById('bootstrap');
  if (bootEl?.textContent) {
    try {
      return JSON.parse(bootEl.textContent);
    } catch (err) {
      console.error('[matching-center] bootstrap parse failed:', err);
    }
  }
  return { authRequired: false, salesChannels: [], defaultTab: 'master' };
}

let bootstrap = readMatchingBootstrap();
const SALES_CHANNELS = bootstrap.salesChannels || [];
const CHANNEL_SHORT_LABELS = {
  'uber-eats': 'Uber',
  'trendyol-marketplace': 'Trendyol',
  getir: 'Getir',
  yemeksepeti: 'YemekSepeti',
  woocommerce: 'WooCommerce'
};
const MASTER_SORT_DEFAULT_DIR = {
  name: 'asc',
  barcode: 'asc',
  stock: 'desc',
  cost: 'desc',
  updated: 'desc'
};
const MASTER_SORT_LABELS = {
  name: 'Ürün',
  barcode: 'Barkod',
  stock: 'Stok',
  cost: 'Maliyet',
  updated: 'Son güncelleme'
};
const toastEl = document.getElementById('matchingToast');
let masterBody = document.getElementById('masterProductsBody');
let masterFooter = document.getElementById('masterFooter');
let uberBody = document.getElementById('uberProductsBody');
let uberFooter = document.getElementById('uberFooter');
let filterForm = document.getElementById('masterFilterForm');
let uberFilterForm = document.getElementById('uberFilterForm');
const mapModal = document.getElementById('mapModalBackdrop');

function refreshMatchingDomRefs() {
  masterBody = document.getElementById('masterProductsBody');
  masterFooter = document.getElementById('masterFooter');
  uberBody = document.getElementById('uberProductsBody');
  uberFooter = document.getElementById('uberFooter');
  filterForm = document.getElementById('masterFilterForm');
  uberFilterForm = document.getElementById('uberFilterForm');
}

let activeTab = 'master';
let mapTarget = null;
let uberPage = 1;
let uberTotalPages = 1;
let masterPage = 1;
let masterTotalPages = 1;
let masterRowsCache = [];
let masterEditTarget = null;
let masterDetailTarget = null;
let workbenchPage = 1;
let workbenchTotalPages = 1;
let workbenchView = 'pending';
const workbenchSelection = new Map();
let workbenchInboxQueue = [];
let workbenchInboxIndex = 0;
let workbenchInboxTotal = 0;
let workbenchInboxChannelCounts = {};
let channelQueueMeta = {};
let workbenchInboxSafeTotal = 0;
let workbenchInboxLoading = false;
let workbenchInboxFetchGen = 0;
const WORKBENCH_INBOX_PAGE_SIZE = 1;
const WORKBENCH_COL_COUNT = 5;
const WORKBENCH_INBOX_SAFE_CONFIDENCE = 88;
const QUALITY_FLAG_LABELS = {
  fiyat_uyusmazligi: 'Fiyat uyuşmazlığı',
  gramaj_farkli: 'Gramaj farklı',
  isim_uyusmazligi: 'İsim uyuşmazlığı',
  varyant_farkli: 'Varyant farklı',
  paket_tipi_farkli: 'Paket farklı'
};
let dqCategory = 'missing_name';
let dqPage = 1;
const MASTER_COL_COUNT = 8;

function getMasterColCount() {
  return window.MatchingMasterTable?.getColCount?.() || MASTER_COL_COUNT;
}
const UBER_PAGE_SIZE = 100;

const STATUS_LABELS = {
  unmapped: 'Eşleşmedi',
  auto_matched: 'Otomatik',
  manual_confirmed: 'Onaylı',
  pending: 'Bekliyor',
  review_required: 'Kontrol gerek',
  barcode_conflict: 'Çakışma',
  missing_master: 'Ana ürün yok',
  missing_channel: 'Kanal ürünü yok'
};

const MAPPING_LOG_LABELS = {
  manual_confirm: 'Manuel onay',
  workbench_bulk_confirm: 'Toplu onay',
  confirm: 'Onay',
  remove: 'Eşleştirme kaldırıldı',
  unmap: 'Eşleştirme kaldırıldı',
  remove_mapping: 'Eşleştirme kaldırıldı',
  auto_match: 'Otomatik eşleştirme',
  master_pool_bulk: 'Havuz toplu işlem',
  sync_audit: 'Senkron denetimi'
};

const MODE_LABELS = {
  hybrid: 'Esnek (hybrid)',
  strict: 'Katı (strict)',
  legacy: 'Eski (legacy)'
};

let trendyolCatalogQuery = '';
let woocommerceCatalogQuery = '';
let yemeksepetiCatalogQuery = '';
let pendingChannelHighlight = null;

function bootMatchingCenter() {
  if (window.__matchingCenterBooted) return;
  window.__matchingCenterBooted = true;
  bootstrap = readMatchingBootstrap();
  refreshMatchingDomRefs();
  const common = window.BuyBoxCommon;
  if (!common) {
    console.error('[matching-center] common.js yüklenmedi');
    showMatchingBootError('Ortak script yüklenemedi — lütfen sayfayı yenileyin (Cmd+Shift+R).');
    window.__matchingCenterBooted = false;
    return;
  }
  if (bootstrap.authRequired && !common.getStoredToken()) {
    common.redirectToLogin();
    window.__matchingCenterBooted = false;
    return;
  }
  try {
    common.initPlatformNav?.();
    bindEvents();
    initMasterFilterOptions();
    initMasterMappingStatusGate();
    initMasterColumnSort();
    initMasterToolbar();
    initWorkbenchFilters();
    initDqCategories();
    initMatchingChannelStrip();
    loadStatus();
    loadUberOps();
    loadMatchingSyncSchedule();
    if (bootstrap.defaultTab === 'workbench') {
      applyDeepLinkFromUrl().finally(() => loadOpsSummary());
    } else {
      loadOpsSummary();
      applyDeepLinkFromUrl();
      loadMasterProducts().catch((err) => {
        console.error('[matching-center] loadMasterProducts başlatılamadı:', err);
        showMatchingBootError('Ana ürün listesi yüklenemedi — sayfayı yenileyin.');
      });
    }
    updateMatchingPageContext(activeTab);
    updateMatchingChromeVisibility(activeTab);
    bindBackToMasterButtons();
    window.onPanelRefresh = refreshMatchingCenter;
    window.MatchingMasterTable?.integrate({
      esc,
      escAttr,
      formatMoney,
      showToast,
      SALES_CHANNELS,
      masterDisplayName,
      formatMasterUpdated,
      initMasterTableDelegation,
      initMasterColumnSort,
      updateMasterSortHeaders,
      loadMasterProducts,
      loadOpsSummary,
      clearMasterFilters,
      buildMasterFilterParams,
      exportMasterCsv,
      getMasterRowsCache: () => masterRowsCache,
      setMasterPage: (p) => { masterPage = p; }
    });
    const poolTabs = document.getElementById('masterPoolTabs');
    if (poolTabs && window.MatchingMasterTable?.renderPoolTabsHtml) {
      poolTabs.innerHTML = window.MatchingMasterTable.renderPoolTabsHtml();
    }
    window.MatchingPoolUi?.integrate({
      esc,
      escAttr,
      formatMoney,
      showToast,
      debounce,
      STATUS_LABELS,
      SALES_CHANNELS,
      masterDisplayName,
      formatMasterUpdated,
      initMasterTableDelegation,
      switchTab,
      openWorkbenchQueue,
      loadMasterProducts,
      loadOpsSummary,
      closeMasterDetailDrawer,
      openMasterEditModal,
      openChannelFromMaster,
      getMasterDetailTarget: () => masterDetailTarget,
      setMasterPage: (p) => { masterPage = p; },
      openMapModal: (row) => openMapModal(row.channelProductId, row.channelName, {
        masterProductId: row.suggestedMasterProductId,
        masterName: row.suggestedMasterName
      }, row.channelId)
    });
    window.MatchingInboxUi?.integrate({
      esc,
      escAttr,
      formatMoney,
      SALES_CHANNELS,
      CHANNEL_SHORT_LABELS,
      QUALITY_FLAG_LABELS,
      STATUS_LABELS,
      loadWorkbench,
      reloadWorkbench: () => {
        workbenchPage = 1;
        workbenchInboxIndex = 0;
        loadWorkbench();
      },
      applyInboxQueueMode: (mode) => {
        const select = document.getElementById('workbenchQueueMode');
        if (select) select.value = mode || 'all';
        syncWorkbenchQueueFromUi();
        workbenchPage = 1;
        workbenchInboxIndex = 0;
        refreshInboxToolbar();
        loadWorkbench();
      },
      getInboxIndex: () => workbenchInboxIndex,
      getInboxTotal: () => workbenchInboxTotal,
      refreshInboxBulkButtons
    });
  } catch (err) {
    console.error('[matching-center] bootMatchingCenter hatası:', err);
    showMatchingBootError('Sayfa başlatılamadı: ' + (err.message || String(err)));
    window.__matchingCenterBooted = false;
  }
}

function showMatchingBootError(message) {
  const body = document.getElementById('masterProductsBody');
  if (!body) return;
  const safe = String(message || 'Yüklenemedi').replace(/[<>&]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[ch]));
  body.innerHTML = '<tr><td colspan="' + getMasterColCount() + '" class="matching-loading matching-error">' + safe + '</td></tr>';
}

function matchingCenterNeedsDataLoad() {
  if (bootstrap.defaultTab === 'workbench' || activeTab === 'workbench') return false;
  const body = document.getElementById('masterProductsBody');
  if (!body) return true;
  const text = body.textContent || '';
  if (/Yükleniyor/i.test(text)) return true;
  if (/başlatılamadı|yüklenemedi|yenileyin/i.test(text)) return true;
  return body.querySelectorAll('tr.master-row-clickable').length === 0;
}

function scheduleMatchingCenterBoot() {
  const run = () => {
    try {
      if (window.__matchingCenterBooted) {
        if (matchingCenterNeedsDataLoad()) {
          loadMasterProducts().catch((err) => console.error('[matching-center] loadMasterProducts retry failed:', err));
        }
        return;
      }
      bootMatchingCenter();
    } catch (err) {
      console.error('[matching-center] schedule boot failed:', err);
      showMatchingBootError('Sayfa başlatılamadı: ' + (err.message || String(err)));
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    queueMicrotask(run);
  }
}

async function applyDeepLinkFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const initialTab = params.get('tab') || bootstrap.defaultTab;
  const initialStatus = params.get('status');
  const initialQuery = params.get('q') || params.get('barcode');
  const openMap = params.get('openMap') === '1';
  let tabId = initialTab === 'price-compare' ? 'uber-eats' : initialTab;
  let legacyWorkbenchQueue = '';
  if (tabId === 'missing-review') {
    tabId = 'workbench';
    legacyWorkbenchQueue = 'missing_master';
  }

  if (!tabId) return;

  switchTab(tabId, { skipLoad: tabId === 'workbench' });

  if (tabId === 'master' && initialQuery) {
    const masterSearch = document.getElementById('masterSearch');
    if (masterSearch) masterSearch.value = initialQuery;
    await loadMasterProducts();
    return;
  }

  if (tabId === 'uber-eats') {
    if (initialStatus) {
      const statusSelect = uberFilterForm.querySelector('[name="status"]');
      if (statusSelect) statusSelect.value = initialStatus;
    }
    if (initialQuery) {
      const uberSearch = document.getElementById('uberSearch');
      if (uberSearch) uberSearch.value = initialQuery;
    }
    await loadUberProducts();
    if (openMap && initialQuery) {
      openMapModal(initialQuery, initialQuery);
    }
    return;
  }

  if (tabId === 'workbench') {
    const queueSelect = document.getElementById('workbenchQueueMode');
    let queueMode = legacyWorkbenchQueue || params.get('queueMode') || '';
    if (!queueMode) {
      const status = params.get('status');
      const quality = params.get('quality');
      const view = params.get('view');
      if (view === 'suspicious' || params.get('queue') === 'confirmed' || quality === 'suspicious') {
        queueMode = 'suspicious';
      } else if (status === 'missing_master') {
        queueMode = 'missing_master';
      } else if (quality === 'confirmable') {
        queueMode = 'high_confidence';
      } else {
        queueMode = 'all';
      }
    }
    if (queueSelect) queueSelect.value = queueMode;
    syncWorkbenchQueueFromUi();
    const channelSelect = document.getElementById('workbenchInboxChannel');
    const channelId = params.get('channelId');
    if (channelSelect && channelId) {
      channelSelect.value = channelId;
      syncWorkbenchChannelStripActive();
    }
    if (initialQuery) {
      const wbSearch = document.getElementById('workbenchSearch');
      if (wbSearch) wbSearch.value = initialQuery;
    }
    const initialStatus = params.get('status');
    if (initialStatus && queueMode === 'pending') {
      const statusSelect = document.getElementById('workbenchStatus');
      if (statusSelect) statusSelect.value = initialStatus;
    }
    await loadWorkbench();
    return;
  }
}

function bindEvents() {
  if (window.__matchingEventsBound) return;
  window.__matchingEventsBound = true;
  bindMasterFilterEvents();
  document.getElementById('logoutBtn')?.addEventListener('click', () => window.BuyBoxCommon.logout());
  document.getElementById('syncMasterBtn')?.addEventListener('click', syncMaster);
  document.getElementById('syncUberCatalogBtn')?.addEventListener('click', syncUberCatalog);
  document.getElementById('runUberOpsBtn')?.addEventListener('click', () => runUberFullOps());
  document.getElementById('refreshUberOpsBtn')?.addEventListener('click', () => loadUberOps(true));
  document.getElementById('saveMatchingSyncBtn')?.addEventListener('click', saveMatchingSyncSchedule);
  document.getElementById('runMatchingSyncBtn')?.addEventListener('click', runMatchingSyncNow);
  document.getElementById('autoMatchBtn')?.addEventListener('click', runAutoMatch);
  initMatchingHeroMenu();
  document.getElementById('matchingInboxNudgeGo')?.addEventListener('click', () => switchTab('workbench'));
  document.getElementById('matchingInboxNudgeDismiss')?.addEventListener('click', () => {
    sessionStorage.setItem('petfix.inboxNudge.dismissed', '1');
    document.getElementById('matchingInboxNudge')?.classList.add('hidden');
  });
  document.getElementById('applyReviewSuggestionsBtn')?.addEventListener('click', applyReviewSuggestions);
  document.getElementById('missingReviewOnSaleFilter')?.addEventListener('change', loadMissingReview);
  document.getElementById('confirmAutoMatchedBulkBtn')?.addEventListener('click', confirmAutoMatchedBulk);
  document.getElementById('confirmMarkup25BulkBtn')?.addEventListener('click', confirmMarkup25Bulk);
  document.getElementById('uberPrevPage')?.addEventListener('click', () => {
    if (uberPage > 1) { uberPage -= 1; loadUberProducts(); }
  });
  document.getElementById('uberNextPage')?.addEventListener('click', () => {
    if (uberPage < uberTotalPages) { uberPage += 1; loadUberProducts(); }
  });

  document.getElementById('masterEditModalClose')?.addEventListener('click', closeMasterEditModal);
  document.getElementById('masterEditCancelBtn')?.addEventListener('click', closeMasterEditModal);
  document.getElementById('masterEditSaveBtn')?.addEventListener('click', saveMasterEdit);
  document.getElementById('masterEditModalBackdrop')?.addEventListener('click', (e) => {
    if (e.target?.id === 'masterEditModalBackdrop') closeMasterEditModal();
  });
  initMasterTableDelegation();

  document.addEventListener('keydown', (e) => {
    if (activeTab !== 'master' || e.key !== '/' || isTypingContext()) return;
    e.preventDefault();
    document.getElementById('masterSearch')?.focus();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const masterModal = document.getElementById('masterEditModalBackdrop');
    if (masterModal && !masterModal.hidden) closeMasterEditModal();
    if (document.body.classList.contains('master-detail-open')) closeMasterDetailDrawer();
  });

  uberFilterForm?.addEventListener('submit', (e) => { e.preventDefault(); uberPage = 1; loadUberProducts(); });
  uberFilterForm?.querySelectorAll('select').forEach((el) => {
    el.addEventListener('change', () => { uberPage = 1; loadUberProducts(); });
  });
  document.getElementById('uberSearch')?.addEventListener('input', debounce(() => {
    uberPage = 1;
    loadUberProducts();
  }, 350));

  document.querySelectorAll('.matching-tab').forEach((tab) => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });
  document.getElementById('matchingMoreTab')?.addEventListener('change', (e) => {
    const tab = e.target.value;
    if (!tab) return;
    if (tab === 'workbench-missing') {
      openWorkbenchQueue('missing_master');
    } else {
      switchTab(tab);
    }
    e.target.value = '';
  });

  document.getElementById('mapModalClose')?.addEventListener('click', closeMapModal);
  mapModal?.addEventListener('click', (e) => { if (e.target === mapModal) closeMapModal(); });
  document.getElementById('mapMasterSearch')?.addEventListener('input', debounce(searchMasters, 300));
}

function bindMasterFilterEvents() {
  if (!filterForm) return;
  filterForm.addEventListener('submit', (e) => {
    e.preventDefault();
    masterPage = 1;
    loadMasterProducts();
  });
  document.getElementById('masterPrevPage')?.addEventListener('click', () => {
    if (masterPage > 1) { masterPage -= 1; loadMasterProducts(); }
  });
  document.getElementById('masterNextPage')?.addEventListener('click', () => {
    if (masterPage < masterTotalPages) { masterPage += 1; loadMasterProducts(); }
  });
  document.getElementById('masterPageJump')?.addEventListener('change', jumpMasterPage);
  document.getElementById('masterPageJump')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      jumpMasterPage();
    }
  });
  filterForm.querySelectorAll('select').forEach((el) => {
    if (el.id === 'masterMappingChannel' || el.id === 'masterSort') return;
    el.addEventListener('change', () => { masterPage = 1; loadMasterProducts(); });
  });
  document.getElementById('masterSort')?.addEventListener('change', () => {
    const sort = masterField('sort')?.value || 'name';
    setMasterSortDir(MASTER_SORT_DEFAULT_DIR[sort] || 'asc');
    updateMasterSortHeaders();
    masterPage = 1;
    loadMasterProducts();
  });
  document.getElementById('masterMappingChannel')?.addEventListener('change', () => {
    syncMasterMappingStatusGate();
    masterPage = 1;
    loadMasterProducts();
  });
  filterForm.querySelectorAll('input[type="checkbox"]').forEach((el) => {
    el.addEventListener('change', () => { masterPage = 1; loadMasterProducts(); });
  });
  document.getElementById('masterSearch')?.addEventListener('input', debounce(() => {
    masterPage = 1;
    loadMasterProducts();
  }, 350));
  document.getElementById('masterDetailClose')?.addEventListener('click', closeMasterDetailDrawer);
  document.getElementById('masterDetailCloseBtn')?.addEventListener('click', closeMasterDetailDrawer);
  document.getElementById('masterDetailBackdrop')?.addEventListener('click', closeMasterDetailDrawer);
  document.getElementById('masterDetailEditBtn')?.addEventListener('click', () => {
    if (masterDetailTarget) {
      closeMasterDetailDrawer();
      openMasterEditModal(masterDetailTarget);
    }
  });
  document.getElementById('masterDetailConfirmBtn')?.addEventListener('click', async () => {
    if (!masterDetailTarget?.id) return;
    try {
      const pending = (masterDetailTarget.channelMappingDetails || []).find((m) =>
        ['auto_matched', 'pending', 'review_required'].includes(m.status));
      if (!pending) {
        showToast('Onaylanacak bekleyen eşleştirme yok.');
        return;
      }
      const response = await window.BuyBoxCommon.authFetch('/api/product-matching/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelProductId: pending.channelProductId, masterProductId: masterDetailTarget.id })
      });
      if (!response.ok) throw new Error('Onay başarısız');
      showToast('Eşleştirme onaylandı.');
      await openMasterDetailDrawer(masterDetailTarget);
      await loadMasterProducts();
      await loadOpsSummary();
    } catch (err) {
      showToast(err.message || 'Onay hatası');
    }
  });
  document.getElementById('masterDetailRuleBtn')?.addEventListener('click', () => {
    showToast('Eşleştirme kuralı oluşturma — yakında.');
  });
  document.getElementById('workbenchFilterForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    workbenchPage = 1;
    loadWorkbench();
  });
  document.getElementById('workbenchPrevPage')?.addEventListener('click', () => {
    if (workbenchPage > 1) { workbenchPage -= 1; loadWorkbenchListPage(); }
  });
  document.getElementById('workbenchNextPage')?.addEventListener('click', () => {
    if (workbenchPage < workbenchTotalPages) { workbenchPage += 1; loadWorkbenchListPage(); }
  });
  document.getElementById('workbenchSearch')?.addEventListener('input', debounce(() => {
    workbenchPage = 1;
    loadWorkbench();
  }, 350));
  document.getElementById('workbenchQueueMode')?.addEventListener('change', () => {
    workbenchPage = 1;
    workbenchInboxIndex = 0;
    clearWorkbenchSelection();
    syncWorkbenchQueueFromUi();
    refreshInboxToolbar();
    loadWorkbench();
  });
  document.getElementById('workbenchSelectAll')?.addEventListener('change', (e) => {
    toggleWorkbenchSelectAllPage(e.target.checked);
  });
  document.getElementById('workbenchBulkConfirmBtn')?.addEventListener('click', confirmWorkbenchBulk);
  document.getElementById('workbenchBulkUnmapBtn')?.addEventListener('click', unmapWorkbenchBulk);
  document.getElementById('workbenchBulkClearBtn')?.addEventListener('click', () => {
    clearWorkbenchSelection();
    updateWorkbenchBulkBar();
    syncWorkbenchSelectAllCheckbox();
  });
  document.getElementById('workbenchInboxReload')?.addEventListener('click', () => {
    workbenchPage = 1;
    workbenchInboxIndex = 0;
    loadWorkbench();
  });
  document.getElementById('workbenchListFallback')?.addEventListener('toggle', () => {
    const details = document.getElementById('workbenchListFallback');
    if (details?.open) loadWorkbenchListPage();
  });
  document.getElementById('workbenchInboxPrev')?.addEventListener('click', () => workbenchInboxGo(-1));
  document.getElementById('workbenchInboxSkip')?.addEventListener('click', () => workbenchInboxGo(1));
  document.getElementById('workbenchInboxConfirm')?.addEventListener('click', () => workbenchInboxConfirmCurrent());
  document.getElementById('workbenchInboxMap')?.addEventListener('click', () => workbenchInboxOpenMap());
  document.getElementById('workbenchInboxUnmap')?.addEventListener('click', () => workbenchInboxUnmapCurrent());
  document.getElementById('workbenchInboxReject')?.addEventListener('click', () => workbenchInboxRejectCurrent());
  document.getElementById('workbenchInboxBulkSafe')?.addEventListener('click', () => workbenchInboxBulkSafePreview());
  document.getElementById('workbenchInboxBulkAuto')?.addEventListener('click', () => workbenchInboxBulkAutoConfirm());
  document.addEventListener('keydown', handleWorkbenchInboxKeydown);
}

function getWorkbenchQueueMode() {
  const value = document.getElementById('workbenchQueueMode')?.value || '';
  // Eski deep-link / varsayılan "pending" artık geçerli filtre değil — tüm bekleyenler.
  if (!value || value === 'pending') return 'all';
  return value;
}

function openWorkbenchQueue(mode = 'all') {
  const select = document.getElementById('workbenchQueueMode');
  if (select) select.value = mode;
  workbenchPage = 1;
  workbenchInboxIndex = 0;
  syncWorkbenchQueueFromUi();
  switchTab('workbench');
}

function updateMatchingInboxNudge(pendingMatch) {
  const nudge = document.getElementById('matchingInboxNudge');
  if (!nudge) return;
  const count = Number(pendingMatch || 0);
  const dismissed = sessionStorage.getItem('petfix.inboxNudge.dismissed') === '1';
  if (activeTab === 'workbench' || count <= 0 || dismissed) {
    nudge.classList.add('hidden');
    return;
  }
  const countEl = document.getElementById('matchingInboxNudgeCount');
  if (countEl) countEl.textContent = count.toLocaleString('tr-TR');
  nudge.classList.remove('hidden');
}

function switchTab(tab, options = {}) {
  activeTab = tab;
  updateMatchingPageContext(tab);
  updateMatchingChromeVisibility(tab);
  document.querySelectorAll('.matching-tab').forEach((el) => {
    el.classList.toggle('active', el.dataset.tab === tab);
  });
  const moreSelect = document.getElementById('matchingMoreTab');
  if (moreSelect && ['reports', 'conflicts', 'missing-review', 'logs'].includes(tab)) {
    moreSelect.value = tab;
  } else if (moreSelect) {
    moreSelect.value = '';
  }

  const channel = SALES_CHANNELS.find((item) => item.id === tab);
  const isPlanned = channel?.status === 'planned';
  const isTrendyol = tab === 'trendyol-marketplace';
  const isWooCommerce = tab === 'woocommerce';
  const isYemeksepeti = tab === 'yemeksepeti';
  const isUber = tab === 'uber-eats';

  document.getElementById('tabMaster').hidden = tab !== 'master';
  document.getElementById('tabUber').hidden = !isUber;
  document.getElementById('tabChannelPlanned').hidden = !(isPlanned || isTrendyol || isWooCommerce || isYemeksepeti);
  document.getElementById('tabWorkbench').hidden = tab !== 'workbench';
  document.getElementById('tabCompare').hidden = tab !== 'compare';
  document.getElementById('tabDataQuality').hidden = tab !== 'data-quality';
  document.getElementById('tabReports').hidden = tab !== 'reports';
  document.getElementById('tabConflicts').hidden = tab !== 'conflicts';
  document.getElementById('tabMissingReview').hidden = tab !== 'missing-review';
  document.getElementById('tabLogs').hidden = tab !== 'logs';

  if (tab === 'workbench') {
    document.getElementById('matchingInboxNudge')?.classList.add('hidden');
  }

  if (isPlanned) {
    renderPlannedChannelPanel(channel);
    return;
  }

  if (isTrendyol) {
    renderTrendyolMatchingPanel();
    return;
  }

  if (isWooCommerce) {
    renderWooCommerceMatchingPanel();
    return;
  }

  if (isYemeksepeti) {
    renderYemeksepetiMatchingPanel();
    return;
  }

  if (tab === 'master') loadMasterProducts();
  if (tab === 'compare') window.MatchingPoolUi?.loadComparePage?.(1);
  if (tab === 'workbench' && !options.skipLoad) {
    syncWorkbenchQueueFromUi();
    initWorkbenchChannelStrip();
    loadWorkbench();
  }
  if (tab === 'data-quality') loadDataQuality();
  if (isUber) loadUberProducts();
  if (tab === 'reports') loadReports();
  if (tab === 'conflicts') loadConflicts();
  if (tab === 'missing-review') loadMissingReview();
  if (tab === 'logs') loadLogs();

  if (isUber) {
    renderChannelHeadLogo('uberChannelLogo', 'uber-eats');
    bindBackToMasterButtons(document.getElementById('tabUber'));
  }
}

function bindBackToMasterButtons(root) {
  (root || document).querySelectorAll('.matching-back-master[data-tab-jump="master"]').forEach((btn) => {
    if (btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => switchTab('master'));
  });
}

function renderChannelHeadLogo(containerId, channelId) {
  const el = document.getElementById(containerId);
  const logos = window.PetFixChannelLogos;
  if (!el || !logos || !channelId) return;
  el.innerHTML = logos.render(channelId, { size: 'lg' });
  el.removeAttribute('aria-hidden');
}

function channelOpsFoldHtml(panelId, summaryLabel, healthId, listId, progressId) {
  return '<details class="channel-ops-fold">' +
    `<summary class="channel-ops-fold-summary">${esc(summaryLabel)}</summary>` +
    `<section class="uber-ops-panel channel-ops-panel" id="${escAttr(panelId)}">` +
      '<div class="uber-ops-head">' +
        `<span class="uber-ops-progress muted" id="${escAttr(progressId)}">Yükleniyor…</span>` +
      '</div>' +
      `<div class="uber-ops-health" id="${escAttr(healthId)}"></div>` +
      `<ol class="uber-ops-checklist" id="${escAttr(listId)}"></ol>` +
    '</section></details>';
}

function catalogSearchToolbar(formId, inputId, placeholder, value) {
  return `<form id="${escAttr(formId)}" class="matching-toolbar matching-toolbar--channel" onsubmit="return false">` +
    `<input type="search" id="${escAttr(inputId)}" placeholder="${escAttr(placeholder)}" autocomplete="off" aria-label="Katalog ara" value="${escAttr(value || '')}">` +
    '</form>';
}

async function refreshMatchingCenter() {
  showToast('Yenileniyor…');
  try {
    await loadOpsSummary();
    await loadStatus();
    await loadMatchingSyncSchedule();
    if (activeTab === 'master') await loadMasterProducts();
    else if (activeTab === 'compare') await window.MatchingPoolUi?.loadComparePage?.(1);
    else if (activeTab === 'workbench') await loadWorkbench();
    else if (activeTab === 'data-quality') await loadDataQuality();
    else if (activeTab === 'uber-eats') await loadUberProducts();
    else if (activeTab === 'trendyol-marketplace') await loadTrendyolProducts();
    else if (activeTab === 'woocommerce') await loadWooCommerceProducts();
    else if (activeTab === 'yemeksepeti') await loadYemeksepetiProducts();
    else if (activeTab === 'reports') await loadReports();
    else if (activeTab === 'conflicts') await loadConflicts();
    else if (activeTab === 'missing-review') await loadMissingReview();
    else if (activeTab === 'logs') await loadLogs();
  } catch (err) {
    console.error('[matching-center] refresh failed:', err);
    showToast('Yenileme başarısız.');
  }
}

function updateMatchingChromeVisibility(tab) {
  const strip = document.getElementById('matchingChannelStrip');
  const kpi = document.getElementById('matchingKpiGrid');
  const syncMeta = document.getElementById('matchingSyncMetaLine');
  const tabs = document.getElementById('matchingTabs');
  const isPool = tab === 'master' || tab === 'workbench' || tab === 'compare' || tab === 'data-quality';
  const isCatalog = ['uber-eats', 'trendyol-marketplace', 'woocommerce', 'yemeksepeti'].includes(tab);
  if (strip) strip.hidden = tab !== 'master' && tab !== 'compare';
  if (kpi) kpi.hidden = !isPool;
  if (syncMeta) syncMeta.hidden = tab !== 'master';
  if (tabs) tabs.hidden = isCatalog;
  document.body.classList.toggle('matching-view-catalog', isCatalog);
}

function updateMatchingPageContext(tab) {
  const isMaster = tab === 'master';
  const isInbox = tab === 'workbench';
  const isCompare = tab === 'compare';
  document.body.classList.toggle('matching-focus-master', isMaster);
  document.body.classList.toggle('matching-focus-inbox', isInbox);
  document.body.classList.toggle('matching-focus-compare', isCompare);
  const heroTitle = document.getElementById('matchingHeroTitle');
  const heroLead = document.getElementById('matchingHeroLead');
  if (heroTitle) {
    const channel = SALES_CHANNELS.find((c) => c.id === tab);
    if (isMaster) heroTitle.textContent = 'Ana Ürün Havuzu';
    else if (isInbox) heroTitle.textContent = 'Gelen Kutusu';
    else if (isCompare) heroTitle.textContent = 'Karşılaştır ve Onayla';
    else if (tab === 'data-quality') heroTitle.textContent = 'Veri Kalitesi';
    else if (channel) heroTitle.textContent = channel.label;
    else heroTitle.textContent = 'Ürün Eşleştirme Merkezi';
  }
  if (heroLead) {
    heroLead.hidden = isMaster || isInbox || isCompare || tab === 'data-quality';
  }
}

function jumpMasterPage() {
  const input = document.getElementById('masterPageJump');
  if (!input) return;
  const next = Math.min(Math.max(Number(input.value) || 1, 1), masterTotalPages || 1);
  if (next === masterPage) {
    input.value = String(masterPage);
    return;
  }
  masterPage = next;
  loadMasterProducts();
}

function isTypingContext() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

function initMasterToolbar() {
  document.getElementById('masterExportBtn')?.addEventListener('click', exportMasterCsv);
  document.getElementById('masterExportTopBtn')?.addEventListener('click', exportMasterCsv);
}

function renderTrendyolMatchingPanel() {
  const title = document.getElementById('plannedChannelTitle');
  const desc = document.getElementById('plannedChannelDesc');
  const body = document.getElementById('plannedChannelBody');
  const actions = document.getElementById('plannedChannelActions');
  if (!title || !desc || !body || !actions) return;

  renderChannelHeadLogo('plannedChannelLogo', 'trendyol-marketplace');
  title.textContent = 'Trendyol Katalog';
  desc.textContent = 'Trendyol ürünlerini BenimPOS ana havuzuyla eşleştirin.';
  body.innerHTML =
    channelOpsFoldHtml('trendyolOpsPanel', 'Operasyon durumu', 'trendyolOpsHealth', 'trendyolOpsChecklist', 'trendyolOpsProgress') +
    catalogSearchToolbar('trendyolCatalogFilter', 'trendyolCatalogSearch', 'Barkod veya ürün adı ara…', trendyolCatalogQuery) +
    '<div class="matching-table-wrap matching-table-wrap--channel">' +
      '<table class="matching-table"><thead><tr>' +
        '<th>Ürün</th><th>Barkod</th><th>Durum</th><th>Ana ürün</th><th>İşlem</th>' +
      '</tr></thead><tbody id="trendyolProductsBody">' +
        '<tr><td colspan="5" class="matching-loading">Yükleniyor…</td></tr>' +
      '</tbody></table></div>' +
    '<div class="matching-footer" id="trendyolProductsFooter">—</div>';

  actions.innerHTML =
    '<button type="button" class="btn-brown btn-sm" id="syncTrendyolCatalogBtn">Katalog Sync</button>' +
    '<button type="button" class="btn-green btn-sm" id="trendyolAutoMatchBtn">Otomatik Eşleştir</button>' +
    '<button type="button" class="btn btn-ghost btn-sm" id="runTrendyolOpsBtn">Tam Sync</button>';

  document.getElementById('runTrendyolOpsBtn')?.addEventListener('click', () => runCatalogChannelOps('trendyol-marketplace'));
  document.getElementById('syncTrendyolCatalogBtn')?.addEventListener('click', syncTrendyolCatalog);
  document.getElementById('trendyolAutoMatchBtn')?.addEventListener('click', runTrendyolAutoMatch);
  document.getElementById('trendyolCatalogSearch')?.addEventListener('input', debounce(() => {
    trendyolCatalogQuery = document.getElementById('trendyolCatalogSearch')?.value || '';
    loadTrendyolProducts();
  }, 350));
  loadCatalogChannelOps('trendyol-marketplace', {
    health: 'trendyolOpsHealth',
    list: 'trendyolOpsChecklist',
    progress: 'trendyolOpsProgress'
  });
  bindBackToMasterButtons(document.getElementById('tabChannelPlanned'));
  loadTrendyolProducts();
}

async function loadTrendyolProducts() {
  const body = document.getElementById('trendyolProductsBody');
  const footer = document.getElementById('trendyolProductsFooter');
  if (!body) return;

  const params = new URLSearchParams({
    channelId: 'trendyol-marketplace',
    limit: '100'
  });
  const q = trendyolCatalogQuery.trim();
  if (q) params.set('q', q);

  const response = await window.BuyBoxCommon.authFetch('/api/product-matching/channel-products?' + params);
  if (!response.ok) {
    body.innerHTML = '<tr><td colspan="5" class="matching-loading">Liste yüklenemedi.</td></tr>';
    return;
  }

  const data = await response.json();
  const rows = data.rows || [];
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="5" class="matching-loading">' +
      (q ? 'Arama sonucu yok.' : 'Henüz Trendyol ürünü yok — önce katalog sync yapın.') +
      '</td></tr>';
    if (footer) footer.textContent = q ? '0 sonuç' : '0 ürün';
    applyPendingChannelHighlight('trendyol-marketplace');
    return;
  }

  body.innerHTML = rows.slice(0, 100).map((row) =>
    '<tr data-cp="' + escAttr(row.channelProductId) + '">' +
      '<td>' + esc(row.channelName || row.channelBarcode || '—') + '</td>' +
      '<td>' + esc(row.channelBarcode || '—') + '</td>' +
      '<td>' + esc(STATUS_LABELS[row.mappingStatus] || row.mappingStatus || 'unmapped') + '</td>' +
      '<td>' + esc(row.masterProductName || '—') + '</td>' +
      '<td><button type="button" class="btn-detail" data-map-id="' + escAttr(row.channelProductId) + '" data-map-name="' + escAttr(row.channelName || '') + '">Eşleştir</button></td>' +
    '</tr>'
  ).join('');

  body.querySelectorAll('[data-map-id]').forEach((btn) => {
    btn.addEventListener('click', () => openMapModal(btn.dataset.mapId, btn.dataset.mapName || btn.dataset.mapId));
  });

  if (footer) {
    footer.textContent = q
      ? `${rows.length} sonuç · ilk 100 gösteriliyor`
      : `${rows.length} ürün · ilk 100 gösteriliyor`;
  }
  applyPendingChannelHighlight('trendyol-marketplace');
}

async function syncTrendyolCatalog() {
  const btn = document.getElementById('syncTrendyolCatalogBtn');
  if (btn) btn.disabled = true;
  showToast('Trendyol katalog havuza aktarılıyor…');
  try {
    const response = await window.BuyBoxCommon.authFetch('/api/product-matching/sync-trendyol-catalog', { method: 'POST' });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { showToast(result.error || 'Katalog sync başarısız.'); return; }
    showToast(`Trendyol katalog: ${result.prepared ?? 0} ürün · DB ${result.totalInDb ?? 0} (+${result.added ?? 0})`);
    await loadStatus();
    await loadTrendyolProducts();
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function runTrendyolAutoMatch() {
  const btn = document.getElementById('trendyolAutoMatchBtn');
  if (btn) btn.disabled = true;
  showToast('Trendyol otomatik eşleştirme çalışıyor…');
  try {
    const response = await window.BuyBoxCommon.authFetch('/api/product-matching/run-auto-match', {
      method: 'POST',
      body: JSON.stringify({ channelId: 'trendyol-marketplace' })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { showToast(result.error || 'Eşleştirme başarısız.'); return; }
    showToast(`Trendyol: ${result.autoMatched} eşleşti, ${result.reviewRequired} kontrol, ${result.missingMaster} ana ürün yok`);
    await loadStatus();
    await loadTrendyolProducts();
  } finally {
    if (btn) btn.disabled = false;
  }
}

function renderWooCommerceMatchingPanel() {
  const title = document.getElementById('plannedChannelTitle');
  const desc = document.getElementById('plannedChannelDesc');
  const body = document.getElementById('plannedChannelBody');
  const actions = document.getElementById('plannedChannelActions');
  if (!title || !desc || !body || !actions) return;

  renderChannelHeadLogo('plannedChannelLogo', 'woocommerce');
  title.textContent = 'WooCommerce Katalog';
  desc.textContent = 'Mağaza kataloğunu BenimPOS ana havuzuyla eşleştirin.';
  body.innerHTML =
    channelOpsFoldHtml('woocommerceOpsPanel', 'Operasyon durumu', 'woocommerceOpsHealth', 'woocommerceOpsChecklist', 'woocommerceOpsProgress') +
    catalogSearchToolbar('woocommerceCatalogFilter', 'woocommerceCatalogSearch', 'SKU veya ürün adı ara…', woocommerceCatalogQuery) +
    '<div class="matching-table-wrap matching-table-wrap--channel">' +
      '<table class="matching-table"><thead><tr>' +
        '<th>Ürün</th><th>SKU</th><th>Durum</th><th>Ana ürün</th><th>İşlem</th>' +
      '</tr></thead><tbody id="woocommerceProductsBody">' +
        '<tr><td colspan="5" class="matching-loading">Yükleniyor…</td></tr>' +
      '</tbody></table></div>' +
    '<div class="matching-footer" id="woocommerceProductsFooter">—</div>';

  actions.innerHTML =
    '<button type="button" class="btn-brown btn-sm" id="syncWooCommerceCatalogBtn">Katalog Sync</button>' +
    '<button type="button" class="btn-green btn-sm" id="woocommerceAutoMatchBtn">Otomatik Eşleştir</button>' +
    '<button type="button" class="btn btn-ghost btn-sm" id="runWooCommerceOpsBtn">Tam Sync</button>';

  document.getElementById('runWooCommerceOpsBtn')?.addEventListener('click', () => runCatalogChannelOps('woocommerce'));
  document.getElementById('syncWooCommerceCatalogBtn')?.addEventListener('click', syncWooCommerceCatalog);
  document.getElementById('woocommerceAutoMatchBtn')?.addEventListener('click', runWooCommerceAutoMatch);
  document.getElementById('woocommerceCatalogSearch')?.addEventListener('input', debounce(() => {
    woocommerceCatalogQuery = document.getElementById('woocommerceCatalogSearch')?.value || '';
    loadWooCommerceProducts();
  }, 350));
  loadCatalogChannelOps('woocommerce', {
    health: 'woocommerceOpsHealth',
    list: 'woocommerceOpsChecklist',
    progress: 'woocommerceOpsProgress'
  });
  bindBackToMasterButtons(document.getElementById('tabChannelPlanned'));
  loadWooCommerceProducts();
}

async function loadWooCommerceProducts() {
  const body = document.getElementById('woocommerceProductsBody');
  const footer = document.getElementById('woocommerceProductsFooter');
  if (!body) return;

  const params = new URLSearchParams({
    channelId: 'woocommerce',
    limit: '100'
  });
  const q = woocommerceCatalogQuery.trim();
  if (q) params.set('q', q);

  const response = await window.BuyBoxCommon.authFetch('/api/product-matching/channel-products?' + params);
  const data = await response.json().catch(() => ({}));
  const rows = data.rows || [];

  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="5" class="matching-empty">' +
      (q ? 'Arama sonucu yok.' : 'Henüz WooCommerce ürünü yok — katalog sync çalıştırın.') +
      '</td></tr>';
    if (footer) footer.textContent = q ? '0 sonuç' : '0 ürün';
    applyPendingChannelHighlight('woocommerce');
    return;
  }

  body.innerHTML = rows.map((row) => {
    const status = STATUS_LABELS[row.mappingStatus] || row.mappingStatus || '—';
    const master = row.masterProductName || '—';
    const mapBtn = row.mappingStatus === 'manual_confirmed' || row.mappingStatus === 'auto_matched'
      ? `<button type="button" class="btn-link" data-map-id="${escAttr(row.channelProductId)}" data-map-name="${escAttr(row.channelDisplayName || row.channelName)}">Değiştir</button>`
      : `<button type="button" class="btn-link" data-map-id="${escAttr(row.channelProductId)}" data-map-name="${escAttr(row.channelDisplayName || row.channelName)}">Eşleştir</button>`;
    return `<tr data-cp="${escAttr(row.channelProductId)}">
      <td>${esc(row.channelDisplayName || row.channelName || '—')}</td>
      <td><code>${esc(row.channelBarcode || '—')}</code></td>
      <td>${esc(status)}</td>
      <td>${esc(master)}</td>
      <td>${mapBtn}</td>
    </tr>`;
  }).join('');

  body.querySelectorAll('[data-map-id]').forEach((btn) => {
    btn.addEventListener('click', () => openMapModal(btn.dataset.mapId, btn.dataset.mapName || btn.dataset.mapId));
  });

  if (footer) {
    footer.textContent = q
      ? `${rows.length} sonuç · ilk 100 gösteriliyor`
      : `${rows.length} ürün · ilk 100 gösteriliyor`;
  }
  applyPendingChannelHighlight('woocommerce');
}

async function syncWooCommerceCatalog() {
  const btn = document.getElementById('syncWooCommerceCatalogBtn');
  if (btn) btn.disabled = true;
  showToast('WooCommerce katalog çekiliyor (2369+ ürün birkaç dakika sürebilir)…');
  try {
    const response = await window.BuyBoxCommon.authFetch('/api/product-matching/sync-woocommerce-catalog', { method: 'POST' });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { showToast(result.error || 'Katalog sync başarısız.'); return; }
    showToast(`WooCommerce katalog: ${result.prepared ?? 0} ürün · DB ${result.totalInDb ?? 0} (+${result.added ?? 0})`);
    await loadStatus();
    await loadWooCommerceProducts();
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function runWooCommerceAutoMatch() {
  const btn = document.getElementById('woocommerceAutoMatchBtn');
  if (btn) btn.disabled = true;
  showToast('WooCommerce otomatik eşleştirme çalışıyor…');
  try {
    const response = await window.BuyBoxCommon.authFetch('/api/product-matching/run-auto-match', {
      method: 'POST',
      body: JSON.stringify({ channelId: 'woocommerce' })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { showToast(result.error || 'Eşleştirme başarısız.'); return; }
    showToast(`WooCommerce: ${result.autoMatched} eşleşti, ${result.reviewRequired} kontrol, ${result.missingMaster} ana ürün yok`);
    await loadStatus();
    await loadWooCommerceProducts();
  } finally {
    if (btn) btn.disabled = false;
  }
}

function renderYemeksepetiMatchingPanel() {
  const title = document.getElementById('plannedChannelTitle');
  const desc = document.getElementById('plannedChannelDesc');
  const body = document.getElementById('plannedChannelBody');
  const actions = document.getElementById('plannedChannelActions');
  if (!title || !desc || !body || !actions) return;

  renderChannelHeadLogo('plannedChannelLogo', 'yemeksepeti');
  title.textContent = 'Yemeksepeti Mahalle Katalog';
  desc.textContent = 'Assortment kataloğunu BenimPOS ana havuzuyla eşleştirin.';
  body.innerHTML =
    '<div class="matching-sales-gate matching-sales-gate--info channel-catalog-notice">' +
      '<strong>Katalog aktif</strong> · Sipariş API Partner Portal üzerinden yapılandırılır.' +
    '</div>' +
    channelOpsFoldHtml('yemeksepetiOpsPanel', 'Operasyon durumu', 'yemeksepetiOpsHealth', 'yemeksepetiOpsChecklist', 'yemeksepetiOpsProgress') +
    catalogSearchToolbar('yemeksepetiCatalogFilter', 'yemeksepetiCatalogSearch', 'SKU, barkod veya ürün adı ara…', yemeksepetiCatalogQuery) +
    '<div class="matching-table-wrap matching-table-wrap--channel">' +
      '<table class="matching-table"><thead><tr>' +
        '<th>Ürün</th><th>SKU / Barkod</th><th>Durum</th><th>Ana ürün</th><th>İşlem</th>' +
      '</tr></thead><tbody id="yemeksepetiProductsBody">' +
        '<tr><td colspan="5" class="matching-loading">Yükleniyor…</td></tr>' +
      '</tbody></table></div>' +
    '<div class="matching-footer" id="yemeksepetiProductsFooter">—</div>';

  actions.innerHTML =
    '<button type="button" class="btn-brown btn-sm" id="syncYemeksepetiCatalogBtn">Katalog Sync</button>' +
    '<button type="button" class="btn-green btn-sm" id="yemeksepetiAutoMatchBtn">Otomatik Eşleştir</button>' +
    '<button type="button" class="btn btn-ghost btn-sm" id="runYemeksepetiOpsBtn">Tam Sync</button>';

  document.getElementById('runYemeksepetiOpsBtn')?.addEventListener('click', () => runCatalogChannelOps('yemeksepeti'));
  document.getElementById('syncYemeksepetiCatalogBtn')?.addEventListener('click', syncYemeksepetiCatalog);
  document.getElementById('yemeksepetiAutoMatchBtn')?.addEventListener('click', runYemeksepetiAutoMatch);
  document.getElementById('yemeksepetiCatalogSearch')?.addEventListener('input', debounce(() => {
    yemeksepetiCatalogQuery = document.getElementById('yemeksepetiCatalogSearch')?.value || '';
    loadYemeksepetiProducts();
  }, 350));
  loadCatalogChannelOps('yemeksepeti', {
    health: 'yemeksepetiOpsHealth',
    list: 'yemeksepetiOpsChecklist',
    progress: 'yemeksepetiOpsProgress'
  });
  bindBackToMasterButtons(document.getElementById('tabChannelPlanned'));
  loadYemeksepetiProducts();
}

async function loadYemeksepetiProducts() {
  const body = document.getElementById('yemeksepetiProductsBody');
  const footer = document.getElementById('yemeksepetiProductsFooter');
  if (!body) return;

  const params = new URLSearchParams({
    channelId: 'yemeksepeti',
    limit: '100'
  });
  const q = yemeksepetiCatalogQuery.trim();
  if (q) params.set('q', q);

  const response = await window.BuyBoxCommon.authFetch('/api/product-matching/channel-products?' + params);
  const data = await response.json().catch(() => ({}));
  const rows = data.rows || [];

  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="5" class="matching-empty">' +
      (q ? 'Arama sonucu yok.' : 'Henüz Yemeksepeti ürünü yok — katalog sync çalıştırın.') +
      '</td></tr>';
    if (footer) footer.textContent = q ? '0 sonuç' : '0 ürün';
    applyPendingChannelHighlight('yemeksepeti');
    return;
  }

  body.innerHTML = rows.map((row) => {
    const status = STATUS_LABELS[row.mappingStatus] || row.mappingStatus || '—';
    const master = row.masterProductName || '—';
    const skuBarcode = [row.ysSku, row.channelBarcode].filter(Boolean).join(' · ') || '—';
    const mapBtn = row.mappingStatus === 'manual_confirmed' || row.mappingStatus === 'auto_matched'
      ? `<button type="button" class="btn-link" data-map-id="${escAttr(row.channelProductId)}" data-map-name="${escAttr(row.channelDisplayName || row.channelName)}">Değiştir</button>`
      : `<button type="button" class="btn-link" data-map-id="${escAttr(row.channelProductId)}" data-map-name="${escAttr(row.channelDisplayName || row.channelName)}">Eşleştir</button>`;
    return `<tr data-cp="${escAttr(row.channelProductId)}">
      <td>${esc(row.channelDisplayName || row.channelName || '—')}</td>
      <td><code>${esc(skuBarcode)}</code></td>
      <td>${esc(status)}</td>
      <td>${esc(master)}</td>
      <td>${mapBtn}</td>
    </tr>`;
  }).join('');

  body.querySelectorAll('[data-map-id]').forEach((btn) => {
    btn.addEventListener('click', () => openMapModal(btn.dataset.mapId, btn.dataset.mapName || btn.dataset.mapId));
  });

  if (footer) {
    footer.textContent = q
      ? `${rows.length} sonuç · ilk 100 gösteriliyor`
      : `${rows.length} ürün · ilk 100 gösteriliyor`;
  }
  applyPendingChannelHighlight('yemeksepeti');
}

async function syncYemeksepetiCatalog() {
  const btn = document.getElementById('syncYemeksepetiCatalogBtn');
  if (btn) btn.disabled = true;
  showToast('Yemeksepeti katalog çekiliyor (~1200 sayfa, sayfa sayfa kaydedilir — birkaç dakika sürebilir)…');
  try {
    const response = await window.BuyBoxCommon.authFetch('/api/product-matching/sync-yemeksepeti-catalog', {
      method: 'POST',
      body: JSON.stringify({ pageSize: 100 })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { showToast(result.error || 'Katalog sync başarısız.'); return; }
    const pageInfo = result.totalPages
      ? ` · ${result.fetchedPages || result.lastPage || '?'}/${result.totalPages} sayfa`
      : '';
    showToast(`Yemeksepeti katalog: ${result.prepared ?? 0} ürün · DB ${result.totalInDb ?? 0} (+${result.added ?? 0})${pageInfo}`);
    await loadStatus();
    await loadYemeksepetiProducts();
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function runYemeksepetiAutoMatch() {
  const btn = document.getElementById('yemeksepetiAutoMatchBtn');
  if (btn) btn.disabled = true;
  showToast('Yemeksepeti otomatik eşleştirme çalışıyor…');
  try {
    const response = await window.BuyBoxCommon.authFetch('/api/product-matching/run-auto-match', {
      method: 'POST',
      body: JSON.stringify({ channelId: 'yemeksepeti' })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { showToast(result.error || 'Eşleştirme başarısız.'); return; }
    showToast(`Yemeksepeti: ${result.autoMatched} eşleşti, ${result.reviewRequired} kontrol, ${result.missingMaster} ana ürün yok`);
    await loadStatus();
    await loadYemeksepetiProducts();
  } finally {
    if (btn) btn.disabled = false;
  }
}

function renderPlannedChannelPanel(channel) {
  const title = document.getElementById('plannedChannelTitle');
  const desc = document.getElementById('plannedChannelDesc');
  const body = document.getElementById('plannedChannelBody');
  const actions = document.getElementById('plannedChannelActions');
  if (!title || !desc || !body || !actions) return;

  renderChannelHeadLogo('plannedChannelLogo', channel.id);
  title.textContent = `${channel.label} — yakında`;
  desc.textContent = 'Bu kanalın sipariş satırları Ana Ürün Havuzundaki BenimPOS ürünleriyle eşleştirilecek.';
  body.innerHTML =
    '<p class="channel-catalog-notice muted">' +
    `${esc(channel.label)} entegrasyonu planlanıyor. Uber Eats (TGO) eşleştirmesi şu an aktif.` +
    '</p>';

  const links = [];
  if (channel.route) {
    links.push(`<a class="btn btn-primary btn-sm" href="${escAttr(channel.route)}">${esc(channel.label)} siparişleri</a>`);
  }
  actions.innerHTML = links.join('');
  bindBackToMasterButtons(document.getElementById('tabChannelPlanned'));
}

async function loadStatus() {
  const response = await window.BuyBoxCommon.authFetch('/api/product-matching/status');
  if (!response.ok) return;
  const data = await response.json();

  const modeLabelEl = document.getElementById('matchingModeLabel');
  if (modeLabelEl) {
    modeLabelEl.textContent = MODE_LABELS[data.mode] || data.mode || 'legacy';
    modeLabelEl.setAttribute('title', data.mode || 'legacy');
  }
  const statMasterCountEl = document.getElementById('statMasterCount');
  if (statMasterCountEl) statMasterCountEl.textContent = String(data.masterProductCount ?? '—');
  const statMasterSyncEl = document.getElementById('statMasterSync');
  if (statMasterSyncEl) statMasterSyncEl.textContent = formatSyncTime(data.masterSyncedAt);

  const uberTotal = data.uberEats?.total || 0;
  const uberConfirmed = (data.uberEats?.byStatus?.manual_confirmed || 0)
    + (data.uberEats?.byStatus?.auto_matched || 0);
  const statUberMapped = document.getElementById('statUberMapped');
  if (statUberMapped) statUberMapped.textContent = uberTotal ? `${uberConfirmed}/${uberTotal}` : '—';

  const manualConfirmed = data.uberEats?.byStatus?.manual_confirmed || 0;
  const autoMatched = data.uberEats?.byStatus?.auto_matched || 0;
  const statManualConfirmed = document.getElementById('statManualConfirmed');
  if (statManualConfirmed) statManualConfirmed.textContent = String(manualConfirmed);
  const statAutoMatched = document.getElementById('statAutoMatched');
  if (statAutoMatched) statAutoMatched.textContent = String(autoMatched);
  const confirmAutoMatchedBulkBtn = document.getElementById('confirmAutoMatchedBulkBtn');
  if (confirmAutoMatchedBulkBtn) confirmAutoMatchedBulkBtn.hidden = autoMatched <= 0;
  const markup25Review = data.uberEats?.markup25ReviewCount ?? 0;
  const markup25Btn = document.getElementById('confirmMarkup25BulkBtn');
  if (markup25Btn) markup25Btn.hidden = markup25Review <= 0;

  const pending = (data.uberEats?.byStatus?.pending || 0)
    + (data.uberEats?.byStatus?.review_required || 0)
    + (data.uberEats?.byStatus?.missing_master || 0)
    + (data.conflictCount || 0);
  const statPending = document.getElementById('statPending');
  if (statPending) statPending.textContent = String(pending);

  renderReviewProgress(data);
  renderChannelOverview(data);

  const missingCount = data.uberEats?.byStatus?.missing_master;
  const tabCount = document.getElementById('missingReviewTabCount');
  if (tabCount && missingCount != null) {
    tabCount.textContent = missingCount ? `(${missingCount})` : '';
  }

  loadSalesGateBanner();
  loadUberOps();
}

async function loadMatchingSyncSchedule() {
  const metaEl = document.getElementById('matchingSyncMeta');
  const enabledEl = document.getElementById('matchingSyncEnabled');
  const descEl = document.getElementById('matchingSyncDesc');
  if (!metaEl || !enabledEl) return;

  try {
    const response = await window.BuyBoxCommon.authFetch('/api/product-matching/sync-schedule');
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      metaEl.textContent = data.error || 'Sync ayarları yüklenemedi';
      return;
    }

    const settings = data.settings || {};
    enabledEl.checked = Boolean(settings.enabled);
    const channelBoxes = document.querySelectorAll('#matchingSyncChannels input[name="syncChannel"]');
    const activeChannels = new Set(settings.channels || []);
    channelBoxes.forEach((box) => {
      box.checked = activeChannels.size ? activeChannels.has(box.value) : true;
    });
    if (descEl) {
      descEl.textContent = `Her ${settings.intervalMinutes || 1440} dk · ${(settings.channels || []).join(', ') || '—'}`;
    }

    const lastRun = settings.lastRunAt
      ? new Date(settings.lastRunAt).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })
      : 'henüz yok';
    const status = settings.lastRunOk == null ? '—' : (settings.lastRunOk ? 'başarılı' : 'uyarı/hata');
    metaEl.textContent = `Son çalışma: ${lastRun} · ${status}${settings.lastError ? ' · ' + settings.lastError : ''}`;
  } catch (error) {
    metaEl.textContent = error.message || 'Bağlantı hatası';
  }
}

function getMatchingSyncChannelSelection() {
  return [...document.querySelectorAll('#matchingSyncChannels input[name="syncChannel"]:checked')]
    .map((el) => el.value)
    .filter(Boolean);
}

async function saveMatchingSyncSchedule() {
  const enabledEl = document.getElementById('matchingSyncEnabled');
  const btn = document.getElementById('saveMatchingSyncBtn');
  if (btn) btn.disabled = true;
  try {
    const channels = getMatchingSyncChannelSelection();
    const response = await window.BuyBoxCommon.authFetch('/api/product-matching/sync-schedule', {
      method: 'POST',
      body: JSON.stringify({
        enabled: Boolean(enabledEl?.checked),
        channels: channels.length ? channels : undefined
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      showToast(data.error || 'Kaydedilemedi');
      return;
    }
    showToast('Otomatik sync ayarı kaydedildi');
    await loadMatchingSyncSchedule();
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function runMatchingSyncNow() {
  const btn = document.getElementById('runMatchingSyncBtn');
  if (btn) btn.disabled = true;
  showToast('Zamanlanmış eşleştirme sync başlatıldı…');
  try {
    const response = await window.BuyBoxCommon.authFetch('/api/product-matching/run-scheduled-sync', { method: 'POST' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      showToast(data.error || 'Sync başarısız');
      return;
    }
    showToast(data.ok ? 'Sync tamamlandı' : 'Sync uyarılarla bitti');
    await loadStatus();
    await loadMatchingSyncSchedule();
    await loadUberOps(true);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function loadUberOps(showToastOnRefresh = false) {
  const healthEl = document.getElementById('uberOpsHealth');
  const listEl = document.getElementById('uberOpsChecklist');
  const progressEl = document.getElementById('uberOpsProgress');
  if (!healthEl || !listEl) return;

  try {
    const response = await window.BuyBoxCommon.authFetch('/api/channels/uber-eats/ops-status');
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      healthEl.innerHTML = `<p class="uber-ops-health-error">${esc(data.error || 'Operasyon durumu yüklenemedi')}</p>`;
      return;
    }

    if (showToastOnRefresh) showToast('Uber operasyon durumu güncellendi');

    const probe = data.probe || {};
    const badges = [];
    if (probe.orders?.ok) {
      badges.push(`<span class="status-badge status-badge--success">Sipariş ${esc(probe.orders.source || 'OK')}</span>`);
    } else if (data.configured) {
      badges.push('<span class="status-badge status-badge--warning">Sipariş API</span>');
    }
    if (probe.catalog?.ok) {
      badges.push(`<span class="status-badge status-badge--success">Katalog · şube ${esc(String(probe.catalog.storeId || '—'))}</span>`);
    } else if (data.configured) {
      badges.push('<span class="status-badge status-badge--warning">Katalog API</span>');
    }
    if (!data.configured) {
      badges.push('<span class="status-badge status-badge--warning">API Eksik</span>');
    }

    healthEl.innerHTML =
      `<div class="uber-ops-health-badges">${badges.join('')}</div>` +
      `<p class="muted">${esc(probe.catalog?.message || probe.orders?.message || '—')}</p>`;

    if (progressEl && data.progress) {
      progressEl.textContent = `${data.progress.completed}/${data.progress.total} adım · %${data.progress.pct}`;
    }

    listEl.innerHTML = (data.checklist || []).map((step) =>
      `<li class="uber-ops-step${step.done ? ' uber-ops-step--done' : ''}">` +
        `<span class="uber-ops-step-mark" aria-hidden="true">${step.done ? '✓' : '○'}</span>` +
        `<div class="uber-ops-step-body">` +
          `<strong>${esc(step.label)}</strong>` +
          `<p class="muted">${esc(step.detail || '')}</p>` +
        `</div>` +
        (step.done ? '' : `<button type="button" class="btn-mini uber-ops-step-btn" data-run="${escAttr(step.action)}">Çalıştır</button>`) +
      `</li>`
    ).join('');

    listEl.querySelectorAll('[data-run]').forEach((btn) => {
      btn.addEventListener('click', () => runUberOpsStep(btn.dataset.run));
    });
  } catch (error) {
    healthEl.innerHTML = `<p class="uber-ops-health-error">${esc(error.message || 'Bağlantı hatası')}</p>`;
  }
}

async function loadCatalogChannelOps(channelId, ids) {
  const healthEl = document.getElementById(ids.health);
  const listEl = document.getElementById(ids.list);
  const progressEl = document.getElementById(ids.progress);
  if (!healthEl || !listEl) return;

  try {
    const response = await window.BuyBoxCommon.authFetch(`/api/channels/${encodeURIComponent(channelId)}/matching-ops-status`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      healthEl.innerHTML = `<p class="uber-ops-health-error">${esc(data.error || 'Operasyon durumu yüklenemedi')}</p>`;
      return;
    }

    const queue = data.queue || {};
    healthEl.innerHTML =
      `<p class="muted">${esc(data.readiness?.blockers?.[0] || 'Eşleştirme pipeline durumu')}</p>` +
      (queue.queueTotal > 0
        ? `<p class="muted">Kuyruk: ${esc(String(queue.queueTotal))} · ${esc(String(queue.missingMaster || 0))} ana ürün yok</p>`
        : '<p class="muted">Kuyruk temiz görünüyor</p>');

    if (progressEl && data.progress) {
      progressEl.textContent = `${data.progress.completed}/${data.progress.total} adım · %${data.progress.pct}`;
    }

    listEl.innerHTML = (data.checklist || []).map((step) =>
      `<li class="uber-ops-step${step.done ? ' uber-ops-step--done' : ''}">` +
        `<span class="uber-ops-step-mark" aria-hidden="true">${step.done ? '✓' : '○'}</span>` +
        `<div class="uber-ops-step-body">` +
          `<strong>${esc(step.label)}</strong>` +
          `<p class="muted">${esc(step.detail || '')}</p>` +
        `</div>` +
        (step.done || step.action === 'confirm'
          ? ''
          : `<button type="button" class="btn-mini uber-ops-step-btn" data-channel="${escAttr(channelId)}" data-run="${escAttr(step.action)}">Çalıştır</button>`) +
      `</li>`
    ).join('');

    listEl.querySelectorAll('[data-run]').forEach((btn) => {
      btn.addEventListener('click', () => runCatalogChannelOpsStep(btn.dataset.channel, btn.dataset.run));
    });
  } catch (error) {
    healthEl.innerHTML = `<p class="uber-ops-health-error">${esc(error.message || 'Bağlantı hatası')}</p>`;
  }
}

async function runCatalogChannelOpsStep(channelId, action) {
  if (action === 'confirm') {
    window.location.href = `/products?tab=${encodeURIComponent(channelId)}&status=auto_matched`;
    return;
  }
  const steps = action ? [action] : undefined;
  showToast(`${channelId} — ${action} çalıştırılıyor…`);
  try {
    const response = await window.BuyBoxCommon.authFetch(`/api/channels/${encodeURIComponent(channelId)}/run-matching-ops`, {
      method: 'POST',
      body: JSON.stringify({ steps, stopOnError: true })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      showToast(result.error || result.errors?.[0]?.error || 'Operasyon başarısız.');
      return;
    }
    showToast(`${channelId} — ${action} tamamlandı`);
    await loadStatus();
    if (channelId === 'trendyol-marketplace') await loadTrendyolProducts();
    if (channelId === 'woocommerce') await loadWooCommerceProducts();
    await loadCatalogChannelOps(channelId, channelId === 'trendyol-marketplace'
      ? { health: 'trendyolOpsHealth', list: 'trendyolOpsChecklist', progress: 'trendyolOpsProgress' }
      : { health: 'woocommerceOpsHealth', list: 'woocommerceOpsChecklist', progress: 'woocommerceOpsProgress' });
  } catch (error) {
    showToast(error.message || 'Operasyon hatası');
  }
}

async function runCatalogChannelOps(channelId) {
  showToast(`${channelId} tam sync başlatılıyor…`);
  try {
    const response = await window.BuyBoxCommon.authFetch(`/api/channels/${encodeURIComponent(channelId)}/run-matching-ops`, {
      method: 'POST',
      body: JSON.stringify({ stopOnError: true })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      showToast(result.errors?.[0]?.error || result.error || 'Tam sync başarısız.');
      return;
    }
    showToast(`${channelId} tam sync tamamlandı`);
    await loadStatus();
    if (channelId === 'trendyol-marketplace') await loadTrendyolProducts();
    if (channelId === 'woocommerce') await loadWooCommerceProducts();
    await loadCatalogChannelOps(channelId, channelId === 'trendyol-marketplace'
      ? { health: 'trendyolOpsHealth', list: 'trendyolOpsChecklist', progress: 'trendyolOpsProgress' }
      : { health: 'woocommerceOpsHealth', list: 'woocommerceOpsChecklist', progress: 'woocommerceOpsProgress' });
  } catch (error) {
    showToast(error.message || 'Tam sync hatası');
  }
}

async function runUberOpsStep(action) {
  const stepMap = {
    probe: null,
    master: ['master'],
    catalog: ['catalog'],
    'auto-match': ['auto-match'],
    confirm: ['auto-match']
  };

  if (action === 'probe') {
    await loadUberOps(true);
    return;
  }

  if (action === 'confirm') {
    switchTab('uber-eats');
    uberFilterForm.querySelector('[name=status]').value = 'auto_matched';
    uberPage = 1;
    await loadUberProducts();
    return;
  }

  const steps = stepMap[action];
  if (steps) await runUberFullOps({ steps, quiet: true });
}

async function runUberFullOps(options = {}) {
  const btn = document.getElementById('runUberOpsBtn');
  const steps = options.steps || ['master', 'catalog', 'auto-match'];
  if (btn) btn.disabled = true;
  if (!options.quiet) showToast('Tam Uber sync çalışıyor… (birkaç dakika sürebilir)');
  try {
    const response = await window.BuyBoxCommon.authFetch('/api/channels/uber-eats/run-ops', {
      method: 'POST',
      body: JSON.stringify({ days: 90, steps, stopOnError: false })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok && !result.results) {
      showToast(result.error || 'Tam sync başarısız.');
      return;
    }
    const parts = [];
    if (result.results?.master) parts.push(`havuz ${result.results.master.totalInDb ?? '—'}`);
    if (result.results?.catalog) parts.push(`katalog +${result.results.catalog.added ?? 0}`);
    if (result.results?.orders) parts.push(`sipariş +${result.results.orders.added ?? 0}`);
    if (result.results?.autoMatch) parts.push(`eşleşme ${result.results.autoMatch.autoMatched ?? 0}`);
    if (result.errors?.length) {
      showToast(`Kısmi tamam: ${parts.join(' · ')} · hata: ${result.errors[0].step}`);
    } else {
      showToast(`Tam sync: ${parts.join(' · ') || 'bitti'}`);
    }
    uberPage = 1;
    await loadStatus();
    await loadUberOps();
    if (activeTab === 'uber-eats') await loadUberProducts();
  } finally {
    if (btn) btn.disabled = false;
  }
}

function initMatchingChannelStrip() {
  const strip = document.getElementById('matchingChannelStrip');
  if (!strip) return;
  if (strip.dataset.bound !== '1') {
    strip.dataset.bound = '1';
    strip.querySelectorAll('.matching-channel-strip-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.classList.contains('is-planned')) return;
        const channelId = btn.dataset.channel || '';
        const wasActive = btn.classList.contains('active') && channelId;
        if (wasActive) {
          switchTab(channelId);
          return;
        }
        const mappingEl = masterField('mappingChannel');
        if (mappingEl) mappingEl.value = channelId;
        syncMasterMappingStatusGate();
        masterPage = 1;
        syncMatchingChannelStripActive();
        if (activeTab !== 'master') switchTab('master');
        else loadMasterProducts();
      });
    });
  }
  syncMatchingChannelStripActive();
}

function syncMatchingChannelStripActive() {
  const strip = document.getElementById('matchingChannelStrip');
  if (!strip) return;
  const current = masterField('mappingChannel')?.value || '';
  strip.querySelectorAll('.matching-channel-strip-item').forEach((el) => {
    el.classList.toggle('active', (el.dataset.channel || '') === current);
  });
}

function renderChannelOverview(data) {
  const box = document.getElementById('matchingChannelOverview');
  if (!box) return;

  const logos = window.PetFixChannelLogos;
  const cards = (data.salesChannels || SALES_CHANNELS).map((channel) => {
    const stats = data.channelStats?.[channel.id] || {};
    const total = stats.productCount || 0;
    const confirmed = stats.confirmedCount || 0;
    const isActive = channel.status === 'active';
    const progress = total ? `${confirmed}/${total}` : (isActive ? '0/0' : '—');
    const stateClass = isActive ? 'matching-channel-card--active' : 'matching-channel-card--planned';
    const logoHtml = logos ? logos.render(channel.id, { size: 'md', state: isActive ? 'ok' : 'wait' }) : '';
    return `<button type="button" class="matching-channel-card ${stateClass}" data-tab-jump="${escAttr(channel.id)}">
      ${logoHtml}
      <span class="matching-channel-card-label">${esc(channelShortLabel(channel.id))}</span>
      <strong class="matching-channel-card-stat">${esc(progress)}</strong>
      <span class="matching-channel-card-meta">${isActive ? 'eşleşme' : 'yakında'}</span>
    </button>`;
  }).join('');

  box.innerHTML = cards;
  box.querySelectorAll('[data-tab-jump]').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tabJump));
  });
}

function channelShortLabel(channelId) {
  return CHANNEL_SHORT_LABELS[channelId] || channelId;
}

function renderMasterChannelStats(data) {
  const el = document.getElementById('masterChannelStats');
  if (!el) return;

  const channels = data.salesChannels || SALES_CHANNELS;
  const logos = window.PetFixChannelLogos;
  const cards = channels.map((channel) => {
    const stats = data.channelStats?.[channel.id] || {};
    const total = stats.productCount || 0;
    const confirmed = stats.confirmedCount || 0;
    const isActive = channel.status === 'active';
    const pct = total ? Math.round((confirmed / total) * 100) : 0;
    const needs = Math.max(0, total - confirmed);
    const logoHtml = logos ? logos.render(channel.id, { size: 'sm' }) : '';

    if (!isActive) {
      return `<div class="master-channel-stat master-channel-stat--planned">
        ${logoHtml}
        <span class="master-channel-stat-label">${esc(channelShortLabel(channel.id))}</span>
        <strong>—</strong>
        <span class="muted">yakında</span>
      </div>`;
    }

    return `<button type="button" class="master-channel-stat" data-filter-channel="${escAttr(channel.id)}" title="${escAttr(channel.label)} — aksiyon gerekenleri listele">
      ${logoHtml}
      <span class="master-channel-stat-label">${esc(channelShortLabel(channel.id))}</span>
      <strong>${confirmed}/${total}</strong>
      <span class="muted">${pct}% onaylı${needs ? ` · ${needs} bekliyor` : ''}</span>
    </button>`;
  }).join('');

  el.innerHTML = cards || '—';
  el.querySelectorAll('[data-filter-channel]').forEach((btn) => {
    btn.addEventListener('click', () => {
      masterField('mappingChannel').value = btn.dataset.filterChannel;
      syncMasterMappingStatusGate();
      masterField('mappingStatus').value = 'needs_action';
      masterPage = 1;
      loadMasterProducts();
    });
  });
}

function renderReviewProgress(data) {
  const box = document.getElementById('matchingReviewProgress');
  if (!box) return;

  const total = data.uberChannelProductCount || 0;
  const manualConfirmed = data.uberEats?.byStatus?.manual_confirmed || 0;
  const reviewRequired = data.uberEats?.reviewRequired ?? data.uberEats?.byStatus?.review_required ?? 0;
  const missingMaster = data.uberEats?.missingMaster ?? data.uberEats?.byStatus?.missing_master ?? 0;
  const markup25 = data.uberEats?.markup25ReviewCount ?? 0;
  const autoMatched = data.uberEats?.byStatus?.auto_matched || 0;
  const pct = data.uberEats?.readyForSalesPct ?? (total ? Math.round((manualConfirmed / total) * 100) : 0);

  if (!total || pct >= 100) {
    box.hidden = true;
    return;
  }

  box.hidden = false;
  const pctEl = document.getElementById('reviewProgressPct');
  const fill = document.getElementById('reviewProgressFill');
  const hint = document.getElementById('reviewProgressHint');
  const actions = document.getElementById('reviewProgressActions');
  const bar = box.querySelector('.matching-review-progress-bar');

  if (pctEl) pctEl.textContent = `${pct}%`;
  if (fill) fill.style.width = `${Math.min(100, pct)}%`;
  if (bar) {
    bar.setAttribute('aria-valuenow', String(pct));
    bar.setAttribute('aria-valuetext', `${manualConfirmed} / ${total} manuel onaylı`);
  }
  if (hint) {
    hint.textContent = `${manualConfirmed} / ${total} Uber ürünü manuel onaylı · ${pendingRemaining(reviewRequired, missingMaster, autoMatched)} kalem kaldı`;
  }

  if (!actions) return;
  const chips = [];
  if (reviewRequired) {
    chips.push(`<button type="button" class="matching-quick-chip matching-quick-chip--warn" data-review-action="review_required">Kontrol gerek (${reviewRequired})</button>`);
  }
  if (markup25) {
    chips.push(`<button type="button" class="matching-quick-chip" data-review-action="markup_25">Tam %25 fark (${markup25})</button>`);
  }
  if (missingMaster) {
    chips.push(`<button type="button" class="matching-quick-chip" data-review-action="missing_master">BenimPOS'ta yok (${missingMaster})</button>`);
  }
  if (autoMatched) {
    chips.push(`<button type="button" class="matching-quick-chip" data-review-action="auto_matched">Onay bekleyen (${autoMatched})</button>`);
  }
  chips.push(`<button type="button" class="matching-quick-chip matching-quick-chip--primary" data-review-action="uber-tab">Uber listesine git →</button>`);
  actions.innerHTML = chips.join('');

  actions.querySelectorAll('[data-review-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.reviewAction;
      switchTab('uber-eats');
      if (action === 'uber-tab') {
        loadUberProducts();
        return;
      }
      if (action === 'missing_master') {
        openWorkbenchQueue('missing_master');
        return;
      }
      const form = uberFilterForm;
      form.querySelector('[name=status]').value = action === 'markup_25' ? 'review_required' : action;
      if (action === 'markup_25') form.querySelector('[name=diff]').value = 'markup_25';
      else form.querySelector('[name=diff]').value = '';
      uberPage = 1;
      loadUberProducts();
    });
  });
}

function pendingRemaining(review, missing, auto) {
  const parts = [];
  if (review) parts.push(`${review} kontrol`);
  if (missing) parts.push(`${missing} eksik`);
  if (auto) parts.push(`${auto} otomatik`);
  return parts.join(' · ') || '0';
}

async function loadSalesGateBanner() {
  const gate = document.getElementById('matchingSalesGate');
  if (!gate) return;
  try {
    const response = await window.BuyBoxCommon.authFetch('/api/product-matching/queue');
    if (!response.ok) return;
    const data = await response.json();
    const blocked = (data.channels || []).filter(
      (row) => !row.readyForSales && Number(row.productCount) > 0
    );
    if (!blocked.length) {
      gate.hidden = true;
      gate.innerHTML = '';
      return;
    }
    gate.hidden = false;
    const channelCards = blocked.map((row) =>
      `<div class="matching-sales-gate-channel">` +
        `<div class="matching-sales-gate-channel-head">` +
          `<strong>${esc(row.label)}</strong>` +
          `<span class="matching-sales-gate-channel-pct">${Number(row.readyPct) || 0}% hazır</span>` +
        `</div>` +
        `<p class="muted">${esc(row.blockers?.[0] || 'Eşleştirme tamamlanmadı')}</p>` +
        `<div class="matching-sales-gate-actions">` +
          `<a class="btn-mini" href="${escAttr(row.href)}">Gelen kutusu →</a>` +
          (row.autoPendingConfirm > 0
            ? `<a class="btn-mini ghost" href="${escAttr(row.hrefAutoMatched || row.href)}">Otomatik onay (${row.autoPendingConfirm})</a>`
            : '') +
          (row.needsReview > 0
            ? `<a class="btn-mini ghost" href="${escAttr(row.hrefReview || row.href)}">Manuel kontrol (${row.needsReview})</a>`
            : '') +
        `</div>` +
      `</div>`
    ).join('');
    gate.innerHTML =
      '<div class="matching-sales-gate-inner matching-sales-gate-inner--multi">' +
        `<strong>BenimPOS satış kapısı — ${blocked.length} kanal henüz hazır değil</strong>` +
        '<p>Gerçek satış için eşleştirmeler tamamlanmalı. Aşağıdaki kanallardan devam edin.</p>' +
        `<div class="matching-sales-gate-channels">${channelCards}</div>` +
      '</div>';
  } catch (err) {
    console.warn('[matching-center] sales gate banner failed:', err);
  }
}

async function loadMasterProducts() {
  refreshMatchingDomRefs();
  if (!filterForm || !masterBody) {
    console.error('[matching-center] masterFilterForm veya masterProductsBody bulunamadı');
    showMatchingBootError('Sayfa bileşenleri yüklenemedi — lütfen tam yenileme yapın.');
    return;
  }
  const params = buildMasterFilterParams();
  masterBody.innerHTML = '<tr><td colspan="' + getMasterColCount() + '" class="matching-loading">Yükleniyor…</td></tr>';

  let response;
  try {
    response = await window.BuyBoxCommon.authFetch('/api/product-matching/master-products?' + params);
  } catch (err) {
    const msg = err?.message?.includes('Oturum')
      ? 'Oturum süresi doldu — yeniden giriş yapın.'
      : 'Ana ürün listesi yüklenemedi. Sayfayı yenileyin veya tekrar deneyin.';
    masterBody.innerHTML = '<tr><td colspan="' + getMasterColCount() + '" class="matching-loading matching-error">' + esc(msg) + '</td></tr>';
    console.error('[matching-center] loadMasterProducts failed:', err);
    return;
  }
  if (!response.ok) {
    const errText = response.status === 403 ? 'Bu işlem için yetkiniz yok.' : 'Sunucu hatası (HTTP ' + response.status + ').';
    masterBody.innerHTML = '<tr><td colspan="' + getMasterColCount() + '" class="matching-loading matching-error">' + esc(errText) + '</td></tr>';
    console.error('[matching-center] loadMasterProducts HTTP', response.status);
    return;
  }
  let data;
  try {
    data = await response.json();
    masterTotalPages = data.totalPages || 1;
    if (masterPage > masterTotalPages) {
      masterPage = masterTotalPages;
      return loadMasterProducts();
    }
    masterRowsCache = data.rows || [];
    populateMasterBrandOptions(data.brands || []);
    renderMasterSummary(data.summary, data.syncedAt);
    renderMasterRows(masterRowsCache);
    renderMasterActiveFilters();
    updateMasterSortHeaders();
    updateMasterPagination(data);
    syncMatchingChannelStripActive();
    window.MatchingMasterTable?.afterListLoad?.(data);
    window.MatchingMasterTable?.syncUrlFromForm?.();
  } catch (err) {
    masterBody.innerHTML = '<tr><td colspan="' + getMasterColCount() + '" class="matching-loading matching-error">Liste işlenemedi — sayfayı yenileyin.</td></tr>';
    console.error('[matching-center] loadMasterProducts render failed:', err);
  }
}

function initMasterFilterOptions() {
  /* mappingChannel hidden input — kanal seçimi logo şeridinden */
}

function initMasterMappingStatusGate() {
  syncMasterMappingStatusGate();
}

function syncMasterMappingStatusGate() {
  const statusSelect = document.getElementById('masterMappingStatus');
  if (!statusSelect) return;
  statusSelect.removeAttribute('disabled');
  statusSelect.title = '';
  statusSelect.classList.remove('master-filter-gated');
}

function getMasterSortDir() {
  const raw = String(masterField('sortDir')?.value || '').toLowerCase();
  if (raw === 'asc' || raw === 'desc') return raw;
  const sort = masterField('sort')?.value || 'name';
  return MASTER_SORT_DEFAULT_DIR[sort] || 'asc';
}

function setMasterSortDir(dir) {
  const el = masterField('sortDir');
  if (el) el.value = dir === 'desc' ? 'desc' : 'asc';
}

function updateMasterSortHeaders() {
  const sort = masterField('sort')?.value || 'name';
  const sortDir = getMasterSortDir();
  document.querySelectorAll('.master-sort-btn').forEach((btn) => {
    const key = btn.dataset.sortKey;
    const active = key === sort;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-sort', active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none');
    const indicator = btn.querySelector('.master-sort-indicator');
    if (indicator) indicator.dataset.dir = active ? sortDir : '';
  });
}

function applyMasterColumnSort(sortKey) {
  const currentSort = masterField('sort')?.value || 'name';
  let sortDir;
  if (sortKey === currentSort) {
    sortDir = getMasterSortDir() === 'asc' ? 'desc' : 'asc';
  } else {
    sortDir = MASTER_SORT_DEFAULT_DIR[sortKey] || 'asc';
  }
  const sortSelect = masterField('sort');
  if (sortSelect) sortSelect.value = sortKey;
  setMasterSortDir(sortDir);
  updateMasterSortHeaders();
  masterPage = 1;
  loadMasterProducts();
}

function initMasterColumnSort() {
  const root = document.getElementById('masterTableHeadRow')?.closest('thead') || document.querySelector('.matching-table--master thead');
  if (!root || root.dataset.sortReady === '1') return;
  root.dataset.sortReady = '1';
  root.addEventListener('click', (event) => {
    const btn = event.target.closest('.master-sort-btn');
    if (!btn) return;
    const key = btn.dataset.sortKey;
    if (key) applyMasterColumnSort(key);
  });
  updateMasterSortHeaders();
}

function buildMasterFilterParams() {
  const params = new URLSearchParams();
  const q = masterField('q')?.value?.trim();
  if (q) params.set('q', q);
  const stock = masterField('stock')?.value;
  if (stock) params.set('stock', stock);
  const cost = masterField('cost')?.value;
  if (cost) params.set('cost', cost);
  const brand = masterField('brand')?.value;
  if (brand) params.set('brand', brand);
  params.set('sort', masterField('sort')?.value || 'name');
  params.set('sortDir', getMasterSortDir());
  params.set('limit', masterField('limit')?.value || '50');
  const poolTab = document.getElementById('masterPoolTab')?.value;
  if (poolTab && poolTab !== 'all') params.set('poolTab', poolTab);
  const stockCode = masterField('stockCode')?.value?.trim();
  if (stockCode) params.set('stockCode', stockCode);
  const channelCode = masterField('channelCode')?.value?.trim();
  if (channelCode) params.set('channelCode', channelCode);
  const category = masterField('category')?.value;
  if (category) params.set('category', category);
  const dataQuality = masterField('dataQuality')?.value;
  if (dataQuality) params.set('dataQuality', dataQuality);
  const variant = masterField('variant')?.value?.trim();
  if (variant) params.set('variant', variant);
  const weightMin = masterField('weightMin')?.value;
  if (weightMin) params.set('weightMin', weightMin);
  const weightMax = masterField('weightMax')?.value;
  if (weightMax) params.set('weightMax', weightMax);
  const updatedSince = masterField('updatedSince')?.value;
  if (updatedSince) params.set('updatedSince', updatedSince);
  const matchAggregate = masterField('matchAggregate')?.value;
  if (matchAggregate) params.set('matchAggregate', matchAggregate);
  if (document.getElementById('masterNegativeStock')?.checked) params.set('negativeStock', '1');
  const mappingChannel = masterField('mappingChannel')?.value;
  if (mappingChannel) params.set('mappingChannel', mappingChannel);
  const mappingStatus = masterField('mappingStatus')?.value;
  if (mappingStatus) params.set('mappingStatus', mappingStatus);
  if (masterField('online')?.checked) params.set('online', '1');
  if (masterField('missingMeta')?.checked) params.set('missingMeta', '1');
  const priceGap = masterField('priceGap')?.value;
  if (priceGap) params.set('priceGap', priceGap);
  const lowProfit = masterField('lowProfit')?.value;
  if (lowProfit) params.set('lowProfit', lowProfit);
  const missingChannelPrice = masterField('missingChannelPrice')?.value;
  if (missingChannelPrice) params.set('missingChannelPrice', missingChannelPrice);
  const actionFilter = document.getElementById('masterActionFilter')?.value;
  if (actionFilter) params.set('actionFilter', actionFilter);
  params.set('page', String(masterPage));
  return params;
}

function initMatchingHeroMenu() {
  const btn = document.getElementById('matchingHeroMenuBtn');
  const panel = document.getElementById('matchingHeroMenuPanel');
  if (!btn || !panel) return;

  const close = () => {
    panel.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  };

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = panel.hidden;
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  panel.querySelectorAll('.matching-hero-menu-item').forEach((item) => {
    item.addEventListener('click', () => close());
  });

  document.getElementById('openMatchingSyncFoldBtn')?.addEventListener('click', () => {
    const fold = document.getElementById('matchingSyncFold');
    if (fold) {
      fold.open = true;
      fold.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    close();
  });
  document.getElementById('openUberOpsFoldBtn')?.addEventListener('click', () => {
    const fold = document.getElementById('uberOpsFold');
    if (fold) {
      fold.open = true;
      fold.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    close();
  });

  document.addEventListener('click', (e) => {
    if (!panel.hidden && !panel.contains(e.target) && e.target !== btn) close();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
}

function clearMasterFilters(reload = true) {
  filterForm.reset();
  document.getElementById('masterPageSize').value = '50';
  const pageSizeSelect = document.getElementById('masterPageSizeSelect');
  if (pageSizeSelect) pageSizeSelect.value = '50';
  document.getElementById('masterPoolTab').value = 'all';
  document.getElementById('masterActionFilter').value = '';
  setMasterSortDir('asc');
  syncMasterMappingStatusGate();
  syncMatchingChannelStripActive();
  updateMasterSortHeaders();
  window.MatchingMasterTable?.setPoolTab?.('all', { reload: false });
  masterPage = 1;
  if (reload) loadMasterProducts();
}

function populateMasterBrandOptions(brands) {
  const select = document.getElementById('masterBrandFilter');
  if (!select || select.tagName !== 'SELECT') return;
  const current = select.value;
  select.innerHTML = '<option value="">Tüm markalar</option>' +
    brands.map((brand) => `<option value="${escAttr(brand)}">${esc(brand)}</option>`).join('');
  if (current && brands.includes(current)) select.value = current;
}

function masterField(name) {
  if (!filterForm) filterForm = document.getElementById('masterFilterForm');
  if (!filterForm) return null;
  return filterForm.elements?.namedItem?.(name) || filterForm.querySelector(`[name="${name}"]`);
}

function renderMasterSummary(summary, syncedAt) {
  const el = document.getElementById('masterSummaryStrip');
  if (!el || !summary) return;
  const syncLabel = syncedAt
    ? new Date(syncedAt).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })
    : '';
  const maliyetsiz = Math.max(0, (summary.filtered || 0) - (summary.withCost || 0));
  const channelId = masterField('mappingChannel')?.value;
  let channelPart = '';
  if (channelId) {
    const logos = window.PetFixChannelLogos;
    const ch = SALES_CHANNELS.find((c) => c.id === channelId);
    const logo = logos ? logos.render(channelId, { size: 'sm' }) : '';
    channelPart = `<span class="master-summary-channel">${logo}<span>${esc(ch?.label || channelId)}</span></span>`;
  }
  el.innerHTML =
    (channelPart || '') +
    `<span><strong>${summary.filtered}</strong> / ${summary.poolTotal} ürün</span>` +
    `<span>Stoklu: <strong>${summary.inStock}</strong></span>` +
    (maliyetsiz ? `<span class="master-summary-warn">Maliyetsiz: <strong>${maliyetsiz}</strong></span>` : '') +
    (syncLabel ? `<span class="muted">BenimPOS sync: ${esc(syncLabel)}</span>` : '');
}

function renderMasterActiveFilters() {
  const el = document.getElementById('masterActiveFilters');
  if (!el) return;
  const chips = [];
  const q = masterField('q')?.value?.trim();
  if (q) chips.push({ key: 'q', text: `Arama: ${q}` });
  if (masterField('brand')?.value) chips.push({ key: 'brand', text: `Marka: ${masterField('brand').value}` });
  if (masterField('stock')?.value === 'in') chips.push({ key: 'stock', text: 'Stoklu' });
  if (masterField('stock')?.value === 'out') chips.push({ key: 'stock', text: 'Stoksuz' });
  if (masterField('cost')?.value === 'has') chips.push({ key: 'cost', text: 'Maliyetli' });
  if (masterField('cost')?.value === 'missing') chips.push({ key: 'cost', text: 'Maliyetsiz' });
  if (masterField('mappingChannel')?.value) {
    const channel = SALES_CHANNELS.find((c) => c.id === masterField('mappingChannel').value);
    chips.push({ key: 'mappingChannel', text: `Kanal: ${channel?.label || masterField('mappingChannel').value}` });
  }
  if (masterField('mappingStatus')?.value) {
    chips.push({
      key: 'mappingStatus',
      text: `Eşleştirme: ${STATUS_LABELS[masterField('mappingStatus').value] || masterField('mappingStatus').value}`
    });
  }
  if (masterField('online')?.checked) chips.push({ key: 'online', text: 'Online' });
  if (masterField('missingMeta')?.checked) chips.push({ key: 'missingMeta', text: 'Gramaj/varyant eksik' });
  if (masterField('priceGap')?.value === 'high') chips.push({ key: 'priceGap', text: 'Kanal farkı ≥ %10' });
  if (masterField('priceGap')?.value === 'markup25_miss') chips.push({ key: 'priceGap', text: 'Uber +25% dışı' });
  if (masterField('lowProfit')?.value === '1') chips.push({ key: 'lowProfit', text: 'Düşük kâr' });
  if (masterField('missingChannelPrice')?.value) {
    const channel = SALES_CHANNELS.find((c) => c.id === masterField('missingChannelPrice').value);
    chips.push({ key: 'missingChannelPrice', text: `${channel?.label || masterField('missingChannelPrice').value} fiyatı yok` });
  }
  const sort = masterField('sort')?.value || 'name';
  const sortDir = getMasterSortDir();
  if (sort !== 'name' || sortDir !== 'asc') {
    const arrow = sortDir === 'asc' ? '↑' : '↓';
    chips.push({ key: 'sort', text: `Sıra: ${MASTER_SORT_LABELS[sort] || sort} ${arrow}` });
  }
  if (!chips.length) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  el.hidden = false;
  el.innerHTML = chips.map((chip) =>
    `<button type="button" class="matching-filter-chip matching-filter-chip--dismiss" data-clear="${escAttr(chip.key)}" title="Filtreyi kaldır">${esc(chip.text)} ×</button>`
  ).join('') +
    `<button type="button" class="matching-filter-chip matching-filter-chip--clear" id="masterClearAllFilters">Tümünü temizle</button>`;
  el.querySelectorAll('[data-clear]').forEach((btn) => {
    btn.addEventListener('click', () => clearMasterFilterKey(btn.dataset.clear));
  });
  document.getElementById('masterClearAllFilters')?.addEventListener('click', () => clearMasterFilters(true));
}

function clearMasterFilterKey(key) {
  switch (key) {
    case 'q':
      if (masterField('q')) masterField('q').value = '';
      break;
    case 'brand':
      if (masterField('brand')) masterField('brand').value = '';
      break;
    case 'stock':
      if (masterField('stock')) masterField('stock').value = '';
      break;
    case 'cost':
      if (masterField('cost')) masterField('cost').value = '';
      break;
    case 'mappingChannel':
      if (masterField('mappingChannel')) masterField('mappingChannel').value = '';
      syncMasterMappingStatusGate();
      syncMatchingChannelStripActive();
      break;
    case 'mappingStatus':
      if (masterField('mappingStatus')) masterField('mappingStatus').value = '';
      break;
    case 'online':
      if (masterField('online')) masterField('online').checked = false;
      break;
    case 'missingMeta':
      if (masterField('missingMeta')) masterField('missingMeta').checked = false;
      break;
    case 'priceGap':
      if (masterField('priceGap')) masterField('priceGap').value = '';
      break;
    case 'lowProfit':
      if (masterField('lowProfit')) masterField('lowProfit').value = '';
      break;
    case 'missingChannelPrice':
      if (masterField('missingChannelPrice')) masterField('missingChannelPrice').value = '';
      break;
    case 'sort':
      if (masterField('sort')) masterField('sort').value = 'name';
      setMasterSortDir('asc');
      updateMasterSortHeaders();
      break;
    default:
      break;
  }
  masterPage = 1;
  loadMasterProducts();
}

function updateMasterPagination(data) {
  const meta = document.getElementById('masterFooterMeta');
  if (meta) {
    meta.textContent = `${data.total} kayıt · sayfa ${data.page}/${data.totalPages}`;
  }
  const prev = document.getElementById('masterPrevPage');
  const next = document.getElementById('masterNextPage');
  if (prev) prev.disabled = (data.page || 1) <= 1;
  if (next) next.disabled = (data.page || 1) >= (data.totalPages || 1);
  const jump = document.getElementById('masterPageJump');
  const jumpTotal = document.getElementById('masterPageJumpTotal');
  if (jump) {
    jump.max = String(data.totalPages || 1);
    jump.value = String(data.page || 1);
  }
  if (jumpTotal) jumpTotal.textContent = `/ ${data.totalPages || 1}`;
}

function renderMasterPrices(row) {
  const lines = [];
  const buy = Number(row.buyingPrice);
  const sale = Number(row.salePrice1);
  const compareBasis = sale > 1 ? 'sale' : (buy > 0 ? 'cost' : 'none');
  const profitPct = masterProfitPctOnCost(buy, sale);

  if (sale > 0) {
    lines.push(renderMasterPriceLine('BenimPOS', sale, profitPct, { kind: 'master' }));
  }

  const channelPrices = row.channelPrices?.length
    ? row.channelPrices
    : buildMasterChannelPricesFallback(row);

  for (const item of channelPrices) {
    const channel = SALES_CHANNELS.find((c) => c.id === item.channelId);
    if (!channel || channel.status === 'planned') continue;
    const label = channelShortLabel(item.channelId);
    const pending = item.barcodeMatchOnly && !item.hasConfirmedMapping;
    const hasPrice = Number(item.channelPrice) > 0;
    const status = item.mappingStatus || row.channelMappings?.[item.channelId] || '';
    const hasChannelProduct = Boolean(item.channelProductId);
    const showChannel = hasPrice || item.hasConfirmedMapping || pending
      || (hasChannelProduct && status && status !== 'unmapped');
    if (!showChannel) continue;

    lines.push(renderMasterPriceLine(
      label,
      item.channelPrice,
      item.saleDiffPct,
      {
        kind: 'channel',
        channelId: item.channelId,
        pending,
        missing: !hasPrice,
        compareBasis: item.compareBasis || compareBasis,
        onSale: item.onSale,
        channelLink: masterPriceChannelDataset(row, item)
      }
    ));
  }

  if (!lines.length) return '<span class="muted">—</span>';
  return `<div class="master-price-list">${lines.join('')}</div>`;
}

function buildMasterChannelPricesFallback(row) {
  return (row.channelMappingDetails || []).map((detail) => ({
    channelId: detail.channelId,
    channelPrice: detail.channelSalePrice,
    saleDiffPct: null,
    barcodeMatchOnly: false,
    hasConfirmedMapping: detail.status === 'manual_confirmed' || detail.status === 'auto_matched',
    compareBasis: 'sale',
    onSale: null
  }));
}

function masterPriceChannelDataset(row, item) {
  const detail = (row.channelMappingDetails || []).find((d) => d.channelId === item.channelId);
  const status = item.mappingStatus || row.channelMappings?.[item.channelId] || 'unmapped';
  if (detail) {
    return `data-channel-id="${escAttr(item.channelId)}" data-channel-product-id="${escAttr(detail.channelProductId)}" data-barcode="${escAttr(row.benimposBarcode)}" data-status="${escAttr(status)}"`;
  }
  return `data-channel-id="${escAttr(item.channelId)}" data-barcode="${escAttr(row.benimposBarcode)}" data-status="${escAttr(status)}"`;
}

function renderMasterPriceLine(label, price, diffPct, opts = {}) {
  const hasPrice = Number.isFinite(price) && price > 0;
  const secondary = opts.kind === 'secondary';
  const pending = opts.pending;
  const missing = opts.missing && !hasPrice;
  const diffHtml = hasPrice && diffPct != null
    ? (opts.kind === 'master'
      ? formatMasterProfitDiff(diffPct)
      : (opts.kind === 'channel' ? formatMasterPriceDiff(diffPct, opts.compareBasis) : ''))
    : '';
  const offSale = opts.onSale === false ? ' <span class="master-price-offsale" title="Kanalda satışta değil">⏸</span>' : '';
  const valueHtml = hasPrice
    ? formatMoney(price)
    : '<span class="master-price-missing" title="Eşleşme yok veya kanal fiyatı yok">!</span>';
  const lineClass =
    `master-price-line${secondary ? ' master-price-line--secondary' : ''}` +
    `${pending ? ' master-price-line--pending' : ''}` +
    `${missing ? ' master-price-line--missing' : ''}`;
  let labelPart;
  if (opts.kind === 'channel' && opts.channelId && window.PetFixChannelLogos) {
    labelPart = window.PetFixChannelLogos.render(opts.channelId, { size: 'sm' });
  } else if (opts.kind === 'master' && window.PetFixChannelLogos) {
    labelPart = window.PetFixChannelLogos.render('benimpos', { size: 'sm' });
  } else {
    labelPart = `<span class="master-price-label-text">${esc(label)}</span>`;
  }
  const inner =
    `<span class="master-price-label">${labelPart}${offSale}</span>` +
    `<span class="master-price-values">` +
      `<span class="master-price-value">${valueHtml}</span>` +
      (diffHtml ? `<span class="master-price-diff">${diffHtml}</span>` : '') +
    `</span>`;

  if (missing && opts.channelLink) {
    return `<button type="button" class="${lineClass} master-price-channel-link" ${opts.channelLink} title="${escAttr(label)} — eşleştir">${inner}</button>`;
  }
  return `<div class="${lineClass}">${inner}</div>`;
}

function initMasterTableDelegation() {
  if (!masterBody || masterBody.dataset.delegationBound) return;
  masterBody.dataset.delegationBound = '1';
  masterBody.addEventListener('click', (e) => {
    const editBtn = e.target.closest('.btn-master-edit');
    const inspectBtn = e.target.closest('.btn-master-inspect');
    const actionBtn = e.target.closest('[data-master-action]');
    if (actionBtn) {
      e.stopPropagation();
      const row = masterRowsCache.find((item) => item.id === actionBtn.dataset.masterId);
      const action = actionBtn.dataset.masterAction;
      if (action === 'inspect' && row) openMasterDetailDrawer(row);
      else if (action === 'edit' && row) openMasterEditModal(row);
      else if (action === 'map' && row) openWorkbenchQueue('all');
      else showToast('Bu işlem yakında bağlanacak.');
      return;
    }
    if (inspectBtn) {
      e.stopPropagation();
      openMasterDetailDrawer(masterRowsCache.find((item) => item.id === inspectBtn.dataset.masterId) || { id: inspectBtn.dataset.masterId });
      return;
    }
    if (editBtn) {
      e.stopPropagation();
      const row = masterRowsCache.find((item) => item.id === editBtn.dataset.masterId);
      if (row) openMasterEditModal(row);
      else showToast('Ürün bulunamadı — sayfayı yenileyin.');
      return;
    }
    const channelLink = e.target.closest('.master-price-channel-link');
    if (channelLink) {
      e.stopPropagation();
      openChannelFromMaster(channelLink.dataset);
      return;
    }
    const barcodeBtn = e.target.closest('.master-barcode-btn');
    if (barcodeBtn) {
      e.stopPropagation();
      copyText(barcodeBtn.dataset.barcode, 'Barkod kopyalandı');
      return;
    }
    const tr = e.target.closest('tr[data-master-id]');
    if (!tr || e.target.closest('button, a, input, summary, .master-row-menu, details')) return;
    const row = masterRowsCache.find((item) => item.id === tr.dataset.masterId);
    if (row) openMasterDetailDrawer(row);
  });
}

function masterProfitPctOnCost(buy, sale) {
  const cost = Number(buy);
  const price = Number(sale);
  if (!Number.isFinite(cost) || cost <= 0 || !Number.isFinite(price) || price <= 0) return null;
  return Math.round(((price - cost) / cost) * 1000) / 10;
}

function formatMasterProfitDiff(value) {
  if (value == null || Number.isNaN(value)) return '';
  const cls = value < 0
    ? 'price-pct price-pct--warn'
    : (value >= 15 ? 'price-pct price-pct--profit' : 'price-pct');
  const sign = value > 0 ? '+' : '';
  return `<span class="${cls}" title="Maliyete göre kâr oranı">kâr ${sign}${Number(value).toFixed(1)}%</span>`;
}

function formatMasterPriceDiff(value, compareBasis) {
  if (value == null || Number.isNaN(value)) return '';
  const isMarkup25 = compareBasis === 'sale' && Math.abs(value - 25) <= 0.1;
  const cls = isMarkup25
    ? 'price-pct price-pct--markup'
    : (Math.abs(value) >= 10 ? 'price-pct price-pct--warn' : 'price-pct');
  const sign = value > 0 ? '+' : '';
  const basis = compareBasis === 'cost'
    ? '<span class="price-basis-tag" title="Satış ≤₺1 — fark alışa göre">alış</span>'
    : '';
  return `<span class="${cls}">${sign}${Number(value).toFixed(1)}%</span>${basis}`;
}

async function loadMatchingQueueMeta() {
  try {
    const response = await window.BuyBoxCommon.authFetch('/api/product-matching/queue');
    if (!response.ok) return;
    const data = await response.json();
    channelQueueMeta = Object.fromEntries(
      (data.channels || []).map((row) => [row.channelId, row])
    );
  } catch (err) {
    if (!String(err?.message || '').includes('Oturum')) {
      console.warn('[matching-center] queue meta failed:', err);
    }
  }
}

async function loadOpsSummary() {
  const setKpiError = (message) => {
    for (const id of ['kpiPendingMatch', 'kpiNotInBenimpos', 'kpiMultiCandidate', 'kpiDataIssues', 'kpiBulkConfirmable']) {
      const el = document.getElementById(id);
      if (el) {
        el.textContent = '—';
        el.title = message;
      }
    }
  };
  try {
    const [summaryRes] = await Promise.all([
      window.BuyBoxCommon.authFetch('/api/product-matching/ops-summary'),
      loadMatchingQueueMeta()
    ]);
    const response = summaryRes;
    if (!response.ok) {
      setKpiError('Özet yüklenemedi (HTTP ' + response.status + ')');
      console.error('[matching-center] loadOpsSummary HTTP', response.status);
      return;
    }
    const data = await response.json();
    window.MatchingPoolUi?.updateActionKpis?.(data);
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) {
        el.textContent = val ?? '—';
        el.removeAttribute('title');
      }
    };
    set('kpiMasterSync', formatSyncTime(data.masterSyncedAt));
    updateMatchingInboxNudge(data.pendingMatch);
    initWorkbenchChannelStrip();
  } catch (err) {
    if (!String(err?.message || '').includes('Oturum')) {
      setKpiError('Özet yüklenemedi');
      console.error('[matching-center] loadOpsSummary failed:', err);
    }
  }
}

function syncWorkbenchQueueFromUi() {
  const mode = getWorkbenchQueueMode();
  workbenchView = mode === 'suspicious' ? 'suspicious' : 'pending';
}

function initWorkbenchFilters() {
  syncWorkbenchQueueFromUi();
  initWorkbenchChannelStrip();
}

function initWorkbenchChannelStrip() {
  refreshInboxToolbar();
}

function refreshInboxToolbar() {
  const channelId = document.getElementById('workbenchInboxChannel')?.value || '';
  window.MatchingInboxUi?.updateChannelStrip?.(
    workbenchInboxChannelCounts,
    workbenchInboxTotal,
    channelId,
    channelQueueMeta
  );
  window.MatchingInboxUi?.updateInboxQuickFilters?.(
    channelQueueMeta,
    channelId,
    getWorkbenchQueueMode()
  );
  refreshInboxBulkButtons();
  window.MatchingInboxUi?.updateSummary?.(workbenchInboxTotal, workbenchInboxSafeTotal, channelQueueMeta);
}

function refreshInboxBulkButtons() {
  const autoBtn = document.getElementById('workbenchInboxBulkAuto');
  if (!autoBtn) return;
  const channelId = document.getElementById('workbenchInboxChannel')?.value?.trim() || '';
  const pendingAuto = channelId
    ? Number(channelQueueMeta[channelId]?.autoPendingConfirm || 0)
    : Object.values(channelQueueMeta).reduce((sum, row) => sum + (row.autoPendingConfirm || 0), 0);
  autoBtn.hidden = pendingAuto <= 0;
  if (!autoBtn.hidden) {
    autoBtn.textContent = channelId
      ? `Otomatik Onayları Toplu Onayla (${pendingAuto.toLocaleString('tr-TR')})`
      : `Tüm Otomatik Onayları Toplu Onayla (${pendingAuto.toLocaleString('tr-TR')})`;
  }
}

function syncWorkbenchChannelStripActive() {
  const strip = document.getElementById('workbenchChannelStrip');
  const input = document.getElementById('workbenchInboxChannel');
  if (!strip || !input) return;
  const current = input.value || '';
  strip.querySelectorAll('.matching-channel-strip-item').forEach((el) => {
    el.classList.toggle('active', (el.dataset.channel || '') === current);
  });
}

const DQ_CATEGORIES = [
  { id: 'missing_name', label: 'Ürün adı eksik' },
  { id: 'negative_stock', label: 'Negatif stok' },
  { id: 'missing_cost', label: 'Maliyetsiz' },
  { id: 'barcode_conflicts', label: 'Barkod çakışması' },
  { id: 'channel_not_in_master', label: 'Kanalda var · BenimPOS yok' },
  { id: 'duplicate_suspects', label: 'Tekrarlı kayıt şüphesi' }
];

function initDqCategories() {
  const root = document.getElementById('dqCategoryTabs');
  if (!root || root.dataset.ready === '1') return;
  root.dataset.ready = '1';
  for (const cat of DQ_CATEGORIES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dq-category-tab' + (cat.id === dqCategory ? ' active' : '');
    btn.dataset.category = cat.id;
    btn.textContent = cat.label;
    btn.addEventListener('click', () => {
      dqCategory = cat.id;
      dqPage = 1;
      root.querySelectorAll('.dq-category-tab').forEach((el) => {
        el.classList.toggle('active', el.dataset.category === dqCategory);
      });
      loadDataQuality();
    });
    root.appendChild(btn);
  }
}

function buildWorkbenchFetchParams(page = 1, limit = 100) {
  const mode = getWorkbenchQueueMode();
  workbenchView = mode === 'suspicious' ? 'suspicious' : 'pending';
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('limit', String(limit));
  if (mode === 'suspicious') {
    params.set('queue', 'confirmed');
    params.set('quality', 'suspicious');
  } else {
    params.set('queue', 'action');
    if (mode === 'missing_master') {
      params.set('status', 'missing_master');
    } else if (mode && mode !== 'all') {
      params.set('inboxFilter', mode);
    }
  }
  const q = document.getElementById('workbenchSearch')?.value?.trim();
  const channelId = document.getElementById('workbenchInboxChannel')?.value?.trim();
  if (q) params.set('q', q);
  if (channelId) params.set('channelId', channelId);
  return params;
}

function isWorkbenchInboxSafeRow(row) {
  if (workbenchView === 'suspicious') return false;
  if (!isWorkbenchRowConfirmable(row)) return false;
  if (row.masterLinkConflict) return false;
  const score = Number(row.confidenceScore);
  if (!Number.isFinite(score) || score < WORKBENCH_INBOX_SAFE_CONFIDENCE) return false;
  if ((row.qualityFlags || []).length) return false;
  return true;
}

function getWorkbenchInboxCurrentRow() {
  return workbenchInboxQueue[0] || null;
}

async function fetchWorkbenchInboxPage(index, limit = WORKBENCH_INBOX_PAGE_SIZE) {
  const page = Math.max(1, index + 1);
  const params = buildWorkbenchFetchParams(page, limit);
  const response = await window.BuyBoxCommon.authFetch('/api/product-matching/workbench?' + params);
  if (!response.ok) {
    throw new Error('workbench HTTP ' + response.status);
  }
  return response.json();
}

async function applyWorkbenchInboxMeta(data) {
  workbenchInboxTotal = Number(data.total) || 0;
  workbenchInboxChannelCounts = data.summary?.channelCounts || {};
  workbenchInboxSafeTotal = data.summary?.safeConfirmable || 0;
  window.MatchingInboxUi?.updateSummary?.(workbenchInboxTotal, workbenchInboxSafeTotal, channelQueueMeta);
  refreshInboxToolbar();
}

async function loadWorkbenchInboxRow(index, { updateMeta = false } = {}) {
  const generation = ++workbenchInboxFetchGen;
  workbenchInboxLoading = true;
  window.MatchingInboxUi?.showSkeleton?.();
  renderWorkbenchInbox({
    row: null,
    index: workbenchInboxIndex,
    queueLength: workbenchInboxTotal,
    total: workbenchInboxTotal,
    safeCount: workbenchInboxSafeTotal,
    workbenchView,
    canConfirm: false,
    canUnmap: false,
    loading: true
  });

  let loadError = null;
  try {
    const data = await fetchWorkbenchInboxPage(index, WORKBENCH_INBOX_PAGE_SIZE);
    if (generation !== workbenchInboxFetchGen) return false;
    if (updateMeta) await applyWorkbenchInboxMeta(data);
    const row = data.rows?.[0] || null;
    workbenchInboxQueue = row ? [row] : [];
    if (workbenchInboxIndex >= workbenchInboxTotal) {
      workbenchInboxIndex = Math.max(0, workbenchInboxTotal - 1);
    }
  } catch (err) {
    if (generation !== workbenchInboxFetchGen) return false;
    loadError = err;
    console.error('[matching-center] loadWorkbenchInboxRow failed:', err);
    workbenchInboxQueue = [];
  } finally {
    if (generation !== workbenchInboxFetchGen) return false;
    workbenchInboxLoading = false;
    if (loadError) {
      window.MatchingInboxUi?.hideSkeleton?.();
      const grid = document.getElementById('workbenchInboxGrid');
      if (grid) {
        grid.innerHTML = '<div class="inbox-decision-empty"><p>Kayıt yüklenemedi.</p><p class="muted">↻ Yenile ile tekrar deneyin.</p></div>';
      }
      renderWorkbenchInbox();
    } else {
      renderWorkbenchInbox();
    }
  }
  return !loadError;
}

async function workbenchInboxGo(delta) {
  if (workbenchInboxLoading || !workbenchInboxTotal) return;
  const next = workbenchInboxIndex + delta;
  if (next < 0 || next >= workbenchInboxTotal) return;
  workbenchInboxIndex = next;
  await loadWorkbenchInboxRow(workbenchInboxIndex);
}

function removeWorkbenchInboxAtIndex(index) {
  if (index !== workbenchInboxIndex) return;
  workbenchInboxQueue = [];
  workbenchInboxTotal = Math.max(0, workbenchInboxTotal - 1);
  if (workbenchInboxIndex >= workbenchInboxTotal) {
    workbenchInboxIndex = Math.max(0, workbenchInboxTotal - 1);
  }
}

function renderWorkbenchInbox() {
  const row = getWorkbenchInboxCurrentRow();
  const safeCount = workbenchInboxSafeTotal || workbenchInboxQueue.filter(isWorkbenchInboxSafeRow).length;
  const canConfirm = workbenchView === 'pending' && isWorkbenchRowConfirmable(row);
  const canUnmap = workbenchView === 'suspicious' || Boolean(row?.mappingId || row?.mappingStatus === 'manual_confirmed');

  window.MatchingInboxUi?.renderWorkbenchInbox?.({
    row,
    index: workbenchInboxIndex,
    queueLength: workbenchInboxTotal,
    total: workbenchInboxTotal,
    safeCount,
    workbenchView,
    canConfirm,
    canUnmap,
    loading: workbenchInboxLoading
  });
}

async function fetchWorkbenchInboxSafeRows(maxItems = 500, { useCurrentFilter = false } = {}) {
  const items = [];
  let page = 1;
  let totalPages = 1;
  while (page <= totalPages && items.length < maxItems) {
    const params = buildWorkbenchFetchParams(page, 100);
    if (!useCurrentFilter) {
      params.set('inboxFilter', 'high_confidence');
    }
    const response = await window.BuyBoxCommon.authFetch('/api/product-matching/workbench?' + params);
    if (!response.ok) break;
    const data = await response.json();
    totalPages = Math.max(1, Number(data.totalPages) || 1);
    for (const row of data.rows || []) {
      if (!isWorkbenchInboxSafeRow(row)) continue;
      items.push(row);
      if (items.length >= maxItems) break;
    }
    page += 1;
  }
  return items;
}

function workbenchInboxBulkUsesCurrentFilter() {
  const mode = getWorkbenchQueueMode();
  return mode === 'manual_review' || mode === 'all' || mode === 'high_confidence';
}

async function loadWorkbench() {
  syncWorkbenchQueueFromUi();
  const prog = document.getElementById('workbenchInboxProgress');
  if (prog) delete prog.dataset.loaded;

  if (workbenchInboxIndex >= workbenchInboxTotal && workbenchInboxTotal > 0) {
    workbenchInboxIndex = Math.max(0, workbenchInboxTotal - 1);
  }

  await loadWorkbenchInboxRow(workbenchInboxIndex, { updateMeta: true });
  window.MatchingInboxUi?.resetInboxScrollPosition?.();
  const listOpen = document.getElementById('workbenchListFallback')?.open;
  if (listOpen) await loadWorkbenchListPage();
}

async function loadWorkbenchListPage() {
  const body = document.getElementById('workbenchBody');
  if (!body) return;
  body.innerHTML = `<tr><td colspan="${WORKBENCH_COL_COUNT}" class="matching-loading">Yükleniyor…</td></tr>`;
  const params = buildWorkbenchFetchParams(workbenchPage, 50);
  let response;
  try {
    response = await window.BuyBoxCommon.authFetch('/api/product-matching/workbench?' + params);
  } catch {
    return;
  }
  if (!response.ok) {
    body.innerHTML = `<tr><td colspan="${WORKBENCH_COL_COUNT}" class="matching-loading">Yüklenemedi.</td></tr>`;
    return;
  }
  const data = await response.json();
  workbenchTotalPages = data.totalPages || 1;
  renderWorkbenchRows(data.rows || []);
  const meta = document.getElementById('workbenchFooterMeta');
  if (meta) meta.textContent = `${data.total} kayıt · sayfa ${data.page}/${data.totalPages}`;
  const label = document.getElementById('workbenchPageLabel');
  if (label) label.textContent = `Sayfa ${data.page} / ${data.totalPages}`;
  const prev = document.getElementById('workbenchPrevPage');
  const next = document.getElementById('workbenchNextPage');
  if (prev) prev.disabled = data.page <= 1;
  if (next) next.disabled = data.page >= data.totalPages;
  updateWorkbenchBulkBar();
  syncWorkbenchSelectAllCheckbox();
}

function handleWorkbenchInboxKeydown(event) {
  if (activeTab !== 'workbench') return;
  const tag = (event.target?.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || event.target?.isContentEditable) {
    if (event.key === '/' && tag !== 'select') {
      event.preventDefault();
      document.getElementById('workbenchSearch')?.focus();
    }
    return;
  }
  if (event.key === 'ArrowRight' && !event.shiftKey) {
    event.preventDefault();
    workbenchInboxGo(1);
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault();
    workbenchInboxGo(-1);
  } else if (event.key === 'Enter') {
    const row = getWorkbenchInboxCurrentRow();
    if (row && workbenchView === 'pending' && isWorkbenchRowConfirmable(row)) {
      event.preventDefault();
      workbenchInboxConfirmCurrent();
    }
  } else if (event.key === 'f' || event.key === 'F') {
    event.preventDefault();
    workbenchInboxOpenMap();
  } else if (event.key === 'a' || event.key === 'A') {
    event.preventDefault();
    workbenchInboxGo(1);
  } else if (event.key === 'r' || event.key === 'R') {
    event.preventDefault();
    workbenchInboxRejectCurrent();
  }
}

async function workbenchInboxConfirmCurrent() {
  const row = getWorkbenchInboxCurrentRow();
  if (!row) return;
  if (!isWorkbenchRowConfirmable(row) || !row.suggestedMasterProductId) {
    showToast('Onay için önerilen ana ürün gerekli — farklı ürün seçin.');
    return;
  }
  const btn = document.getElementById('workbenchInboxConfirm');
  if (btn) btn.disabled = true;
  try {
    const response = await window.BuyBoxCommon.authFetch('/api/product-matching/confirm', {
      method: 'POST',
      body: JSON.stringify({
        channelId: row.channelId,
        channelProductId: row.channelProductId,
        masterProductId: row.suggestedMasterProductId
      })
    });
    if (!response.ok) {
      showToast('Onaylanamadı.');
      return;
    }
    showToast('Eşleştirme onaylandı.');
    removeWorkbenchInboxAtIndex(workbenchInboxIndex);
    workbenchInboxSafeTotal = Math.max(0, workbenchInboxSafeTotal - (isWorkbenchInboxSafeRow(row) ? 1 : 0));
    await loadWorkbenchInboxRow(workbenchInboxIndex, { updateMeta: true });
    await loadOpsSummary();
    loadSalesGateBanner();
    if (document.getElementById('workbenchListFallback')?.open) {
      await loadWorkbenchListPage();
    }
  } finally {
    if (btn) btn.disabled = !isWorkbenchRowConfirmable(getWorkbenchInboxCurrentRow());
  }
}

function workbenchInboxOpenMap() {
  const row = getWorkbenchInboxCurrentRow();
  if (!row) return;
  openMapModal(
    row.channelProductId,
    row.channelName || row.channelProductId,
    row.suggestedMasterProductId
      ? { masterProductId: row.suggestedMasterProductId, masterName: row.suggestedMasterName || '' }
      : null,
    row.channelId
  );
}

async function workbenchInboxUnmapCurrent() {
  const row = getWorkbenchInboxCurrentRow();
  if (!row) return;
  if (!confirm('Bu eşleştirmeyi kaldırmak istediğinize emin misiniz?')) return;
  const response = await window.BuyBoxCommon.authFetch('/api/product-matching/remove-mapping', {
    method: 'POST',
    body: JSON.stringify({ channelId: row.channelId, channelProductId: row.channelProductId })
  });
  if (!response.ok) {
    showToast('Kaldırılamadı.');
    return;
  }
  showToast('Eşleştirme kaldırıldı.');
  removeWorkbenchInboxAtIndex(workbenchInboxIndex);
  await loadWorkbenchInboxRow(workbenchInboxIndex, { updateMeta: true });
  await loadOpsSummary();
  if (document.getElementById('workbenchListFallback')?.open) {
    await loadWorkbenchListPage();
  }
}

async function workbenchInboxRejectCurrent() {
  const row = getWorkbenchInboxCurrentRow();
  if (!row) return;
  if (!confirm('Bu eşleştirme önerisini reddetmek istiyor musunuz?')) return;
  const response = await window.BuyBoxCommon.authFetch('/api/product-matching/remove-mapping', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelId: row.channelId, channelProductId: row.channelProductId })
  });
  if (!response.ok) {
    showToast('Reddedilemedi.');
    return;
  }
  showToast('Eşleştirme reddedildi.');
  removeWorkbenchInboxAtIndex(workbenchInboxIndex);
  workbenchInboxSafeTotal = Math.max(0, workbenchInboxSafeTotal - (isWorkbenchInboxSafeRow(row) ? 1 : 0));
  await loadWorkbenchInboxRow(workbenchInboxIndex, { updateMeta: true });
  await loadOpsSummary();
  if (document.getElementById('workbenchListFallback')?.open) {
    await loadWorkbenchListPage();
  }
}

function workbenchInboxBulkSafePreview() {
  if (!workbenchInboxSafeTotal) {
    showToast('Güvenli toplu onay için uygun kayıt yok.');
    return;
  }
  const btn = document.getElementById('workbenchInboxBulkSafe');
  if (btn) btn.disabled = true;
  showToast('Güvenli kayıtlar hazırlanıyor…');
  fetchWorkbenchInboxSafeRows(500, { useCurrentFilter: workbenchInboxBulkUsesCurrentFilter() }).then((items) => {
    if (btn) btn.disabled = false;
    if (!items.length) {
      showToast('Güvenli toplu onay için uygun kayıt yok.');
      return;
    }
    window.MatchingInboxUi?.openBulkPreview?.(
      items,
      items,
      () => workbenchInboxBulkSafeConfirm(items)
    );
  }).catch((err) => {
    if (btn) btn.disabled = false;
    console.error('[matching-center] bulk safe preview failed:', err);
    showToast('Toplu onay listesi yüklenemedi.');
  });
}

async function workbenchInboxBulkSafeConfirm(items) {
  const payload = (items || workbenchInboxQueue.filter(isWorkbenchInboxSafeRow)).map((row) => ({
    channelId: row.channelId,
    channelProductId: row.channelProductId,
    masterProductId: row.suggestedMasterProductId
  }));
  if (!payload.length) {
    showToast('Güvenli toplu onay için uygun kayıt yok.');
    return;
  }
  const btn = document.getElementById('workbenchInboxBulkSafe');
  if (btn) btn.disabled = true;
  showToast('Toplu onay çalışıyor…');
  try {
    const response = await window.BuyBoxCommon.authFetch('/api/product-matching/confirm-mappings-bulk', {
      method: 'POST',
      body: JSON.stringify({ items: payload, confirmedBy: 'inbox_safe_bulk' })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      showToast(result.error || 'Toplu onay başarısız.');
      return;
    }
    const skippedNote = result.skipped ? ` · ${result.skipped} atlandı` : '';
    showToast(`${result.confirmed || 0} eşleştirme onaylandı${skippedNote}.`);
    workbenchInboxIndex = 0;
    await loadMatchingQueueMeta();
    await loadWorkbench();
    await loadOpsSummary();
    loadSalesGateBanner();
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function workbenchInboxBulkAutoConfirm() {
  const channelId = document.getElementById('workbenchInboxChannel')?.value?.trim() || '';
  const channelIds = channelId
    ? [channelId]
    : Object.entries(channelQueueMeta)
      .filter(([, row]) => (row.autoPendingConfirm || 0) > 0)
      .map(([id]) => id);
  const pendingAuto = channelIds.reduce(
    (sum, id) => sum + Number(channelQueueMeta[id]?.autoPendingConfirm || 0),
    0
  );
  if (!pendingAuto || !channelIds.length) {
    showToast('Toplu onaylanacak otomatik eşleşme yok.');
    return;
  }
  const label = channelId
    ? (SALES_CHANNELS.find((c) => c.id === channelId)?.label || channelId)
    : 'tüm kanallar';
  if (!confirm(`${pendingAuto.toLocaleString('tr-TR')} otomatik eşleşmeyi (${label}) toplu onaylamak istiyor musunuz?`)) {
    return;
  }
  const btn = document.getElementById('workbenchInboxBulkAuto');
  if (btn) btn.disabled = true;
  showToast('Otomatik eşleşmeler onaylanıyor…');
  try {
    let totalConfirmed = 0;
    let totalSkipped = 0;
    for (const id of channelIds) {
      const response = await window.BuyBoxCommon.authFetch('/api/product-matching/confirm-auto-matched-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: id })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(result.error || 'Toplu onay başarısız.');
        return;
      }
      totalConfirmed += Number(result.confirmed || 0);
      totalSkipped += Number(result.skipped || 0);
    }
    const skippedNote = totalSkipped ? ` · ${totalSkipped} atlandı` : '';
    showToast(`${totalConfirmed} otomatik eşleşme onaylandı${skippedNote}.`);
    workbenchInboxIndex = 0;
    await loadMatchingQueueMeta();
    await loadWorkbench();
    await loadOpsSummary();
    loadSalesGateBanner();
  } finally {
    if (btn) btn.disabled = false;
  }
}

function workbenchRowKey(channelId, channelProductId) {
  return `${channelId}::${channelProductId}`;
}

function isWorkbenchRowConfirmable(row) {
  if (!row) return false;
  if (row.canConfirm != null) return Boolean(row.canConfirm);
  return Boolean(
    row.suggestedMasterProductId
    && !row.masterLinkConflict
    && row.mappingStatus !== 'manual_confirmed'
  );
}

function isWorkbenchRowSelectable(row) {
  if (workbenchView === 'suspicious') {
    return Boolean(row.mappingId || row.mappingStatus === 'manual_confirmed');
  }
  return isWorkbenchRowConfirmable(row);
}

function forgetWorkbenchRow(channelId, channelProductId) {
  workbenchSelection.delete(workbenchRowKey(channelId, channelProductId));
}

function setWorkbenchRowSelected(channelId, channelProductId, masterProductId, selected) {
  const key = workbenchRowKey(channelId, channelProductId);
  if (selected) {
    workbenchSelection.set(key, { channelId, channelProductId, masterProductId: masterProductId || '' });
  } else {
    workbenchSelection.delete(key);
  }
}

function clearWorkbenchSelection() {
  workbenchSelection.clear();
  document.querySelectorAll('.workbench-row-select').forEach((el) => {
    el.checked = false;
  });
}

function getWorkbenchPageSelectableRows() {
  return [...document.querySelectorAll('#workbenchBody tr[data-wb-channel]')].map((tr) => ({
    channelId: tr.dataset.wbChannel,
    channelProductId: tr.dataset.wbCp,
    masterProductId: tr.dataset.wbMaster || '',
    selectable: tr.dataset.wbSelectable === '1'
  }));
}

function toggleWorkbenchSelectAllPage(checked) {
  for (const row of getWorkbenchPageSelectableRows()) {
    if (!row.selectable) continue;
    setWorkbenchRowSelected(row.channelId, row.channelProductId, row.masterProductId, checked);
  }
  document.querySelectorAll('.workbench-row-select').forEach((el) => {
    if (el.disabled) return;
    el.checked = checked;
  });
  updateWorkbenchBulkBar();
}

function syncWorkbenchSelectAllCheckbox() {
  const selectAll = document.getElementById('workbenchSelectAll');
  if (!selectAll) return;
  const selectable = getWorkbenchPageSelectableRows().filter((row) => row.selectable);
  if (!selectable.length) {
    selectAll.checked = false;
    selectAll.indeterminate = false;
    selectAll.disabled = true;
    return;
  }
  selectAll.disabled = false;
  const selectedOnPage = selectable.filter((row) =>
    workbenchSelection.has(workbenchRowKey(row.channelId, row.channelProductId))
  ).length;
  selectAll.checked = selectedOnPage > 0 && selectedOnPage === selectable.length;
  selectAll.indeterminate = selectedOnPage > 0 && selectedOnPage < selectable.length;
}

function updateWorkbenchBulkBar() {
  const bar = document.getElementById('workbenchBulkBar');
  const meta = document.getElementById('workbenchBulkMeta');
  const confirmBtn = document.getElementById('workbenchBulkConfirmBtn');
  const unmapBtn = document.getElementById('workbenchBulkUnmapBtn');
  const count = workbenchSelection.size;
  const suspiciousView = workbenchView === 'suspicious';
  if (bar) bar.hidden = count <= 0;
  if (meta) {
    meta.textContent = count === 1 ? '1 ürün seçili' : `${count} ürün seçili`;
  }
  if (confirmBtn) {
    confirmBtn.hidden = suspiciousView;
    confirmBtn.disabled = count <= 0;
    confirmBtn.textContent = count <= 1 ? 'Seçileni onayla' : `Seçilenleri onayla (${count})`;
  }
  if (unmapBtn) {
    unmapBtn.hidden = !suspiciousView;
    unmapBtn.disabled = count <= 0;
    unmapBtn.textContent = count <= 1 ? 'Seçileni kaldır' : `Seçilenleri kaldır (${count})`;
  }
}

async function unmapWorkbenchBulk() {
  const items = [...workbenchSelection.values()].map(({ channelId, channelProductId }) => ({
    channelId,
    channelProductId
  }));
  if (!items.length) {
    showToast('Kaldırılacak eşleştirme seçilmedi.');
    return;
  }
  const label = items.length === 1 ? '1 eşleştirmeyi' : `${items.length} eşleştirmeyi`;
  if (!confirm(`${label} kaldırmak istediğinize emin misiniz?`)) return;

  const btn = document.getElementById('workbenchBulkUnmapBtn');
  if (btn) btn.disabled = true;
  showToast('Toplu kaldırma çalışıyor…');
  try {
    const response = await window.BuyBoxCommon.authFetch('/api/product-matching/remove-channel-mappings-bulk', {
      method: 'POST',
      body: JSON.stringify({ items, source: 'workbench_bulk' })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      showToast(result.error || 'Toplu kaldırma başarısız.');
      return;
    }
    const notFoundNote = result.notFound ? ` · ${result.notFound} bulunamadı` : '';
    showToast(`${result.removed || 0} eşleştirme kaldırıldı${notFoundNote}.`);
    clearWorkbenchSelection();
    await loadWorkbench();
    await loadOpsSummary();
    loadSalesGateBanner();
  } finally {
    if (btn) btn.disabled = false;
    updateWorkbenchBulkBar();
  }
}

async function confirmWorkbenchBulk() {
  const items = [...workbenchSelection.values()];
  if (!items.length) {
    showToast('Onaylanacak ürün seçilmedi.');
    return;
  }
  const label = items.length === 1 ? '1 eşleştirmeyi' : `${items.length} eşleştirmeyi`;
  if (!confirm(`${label} manuel onaylı yapmak istiyor musunuz?`)) return;

  const btn = document.getElementById('workbenchBulkConfirmBtn');
  if (btn) btn.disabled = true;
  showToast('Toplu onay çalışıyor…');
  try {
    const response = await window.BuyBoxCommon.authFetch('/api/product-matching/confirm-mappings-bulk', {
      method: 'POST',
      body: JSON.stringify({ items })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      showToast(result.error || 'Toplu onay başarısız.');
      return;
    }
    const skippedNote = result.skipped ? ` · ${result.skipped} atlandı` : '';
    showToast(`${result.confirmed || 0} eşleştirme onaylandı${skippedNote}.`);
    clearWorkbenchSelection();
    await loadWorkbench();
    await loadOpsSummary();
    loadSalesGateBanner();
  } finally {
    if (btn) btn.disabled = false;
    updateWorkbenchBulkBar();
  }
}

function renderWorkbenchStatusCell(row) {
  if (row.masterLinkConflict) {
    return '<span class="matching-badge barcode_conflict">Barkod çakışması</span>';
  }
  if (workbenchView === 'suspicious') {
    const uber = Number(row.salePrice);
    const master = Number(row.masterComparePrice);
    const diff = row.priceDiffPct;
    let priceLine = '';
    if (uber > 0 && master > 0 && diff != null) {
      const sign = diff > 0 ? '+' : '';
      priceLine = `<div class="workbench-price-compare muted">Uber ${formatMoney(uber)} · Havuz ${formatMoney(master)} (${sign}${Math.round(diff)}%)</div>`;
    }
    const flag = Array.isArray(row.qualityFlags) && row.qualityFlags[0]
      ? `<div class="muted workbench-status-note">${esc(QUALITY_FLAG_LABELS[row.qualityFlags[0]] || row.qualityFlags[0])}</div>`
      : '';
    return `<span class="matching-badge manual_confirmed">Fiyat sapması</span>${priceLine}${flag}`;
  }
  const label = row.suggestionReason || STATUS_LABELS[row.mappingStatus] || row.mappingStatus;
  const recovered = row.suggestionRecovered ? ' matching-badge--recovered' : '';
  return `<span class="matching-badge ${escAttr(row.mappingStatus)}${recovered}">${esc(label)}</span>`;
}

function renderWorkbenchRows(rows) {
  const body = document.getElementById('workbenchBody');
  const emptyMessage = workbenchView === 'suspicious'
    ? 'Şüpheli onaylı eşleştirme yok.'
    : 'Bekleyen eşleştirme yok.';
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="${WORKBENCH_COL_COUNT}" class="matching-loading">${emptyMessage}</td></tr>`;
    return;
  }
  body.innerHTML = rows.map((row) => {
    const selectable = isWorkbenchRowSelectable(row);
    const selected = workbenchSelection.has(workbenchRowKey(row.channelId, row.channelProductId));
    const selectTitle = selectable
      ? (workbenchView === 'suspicious' ? 'Toplu kaldırma için seç' : 'Toplu onay için seç')
      : 'Manuel eşleştirme gerekli';
    const selectCell = selectable
      ? `<td class="col-wb-select"><input type="checkbox" class="workbench-row-select" aria-label="Seç" title="${escAttr(selectTitle)}" ${selected ? 'checked' : ''}></td>`
      : `<td class="col-wb-select"><input type="checkbox" class="workbench-row-select" disabled aria-label="Seçilemez"></td>`;
    const channelMeta = [
      row.channelLabel,
      row.channelBarcode || row.channelProductId
    ].filter(Boolean).join(' · ');
    const masterCell = row.suggestedMasterName
      ? `<div class="matching-product-name">${esc(row.suggestedMasterName)}</div>${row.linkedMasterBarcode ? `<div class="matching-barcode muted">${esc(row.linkedMasterBarcode)}</div>` : ''}`
      : '<span class="muted">—</span>';
    const rowClass = row.suspicious && workbenchView === 'suspicious' ? ' workbench-row--suspicious' : '';
    return `<tr class="${rowClass.trim()}" data-wb-channel="${escAttr(row.channelId)}" data-wb-cp="${escAttr(row.channelProductId)}" data-wb-master="${escAttr(row.suggestedMasterProductId || '')}" data-wb-selectable="${selectable ? '1' : '0'}">
      ${selectCell}
      <td><div class="matching-product-name">${esc(row.channelName)}</div><div class="matching-product-meta muted">${esc(channelMeta)}</div></td>
      <td>${masterCell}</td>
      <td>${renderWorkbenchStatusCell(row)}</td>
      <td class="matching-actions-cell">${renderWorkbenchActions(row)}</td>
    </tr>`;
  }).join('');
  body.querySelectorAll('tr[data-wb-channel]').forEach((tr) => {
    const checkbox = tr.querySelector('.workbench-row-select');
    if (!checkbox || checkbox.disabled) return;
    checkbox.addEventListener('change', () => {
      setWorkbenchRowSelected(
        tr.dataset.wbChannel,
        tr.dataset.wbCp,
        tr.dataset.wbMaster,
        checkbox.checked
      );
      updateWorkbenchBulkBar();
      syncWorkbenchSelectAllCheckbox();
    });
  });
  body.querySelectorAll('[data-wb-action]').forEach((btn) => {
    btn.addEventListener('click', () => handleWorkbenchAction(btn.dataset));
  });
}

function renderWorkbenchActions(row) {
  const base = `data-wb-action data-channel-id="${escAttr(row.channelId)}" data-channel-product-id="${escAttr(row.channelProductId)}" data-channel-name="${escAttr(row.channelName || '')}"`;
  const masterAttr = row.suggestedMasterProductId
    ? ` data-master-id="${escAttr(row.suggestedMasterProductId)}" data-master-name="${escAttr(row.suggestedMasterName || '')}"`
    : '';
  const parts = [];
  if (workbenchView === 'pending') {
    if (isWorkbenchRowConfirmable(row)) {
      parts.push(`<button type="button" class="btn-mini btn-brown" ${base}${masterAttr} data-action="confirm">Onayla</button>`);
    } else {
      parts.push(`<button type="button" class="btn-mini btn-brown" ${base} data-action="map">Eşleştir</button>`);
    }
  }
  if (row.mappingId || row.mappingStatus === 'manual_confirmed') {
    parts.push(`<button type="button" class="btn-mini ghost" ${base} data-action="unmap">Kaldır</button>`);
  }
  return parts.join(' ');
}

async function handleWorkbenchAction(dataset) {
  const { action, channelId, channelProductId, masterId, masterName, channelName } = dataset;
  if (action === 'map') {
    openMapModal(
      channelProductId,
      channelName || channelProductId,
      masterId ? { masterProductId: masterId, masterName: masterName || '' } : null,
      channelId
    );
    return;
  }
  if (action === 'confirm') {
    if (!masterId) {
      showToast('Önerilen ana ürün yok — manuel eşleştirin.');
      return;
    }
    const response = await window.BuyBoxCommon.authFetch('/api/product-matching/confirm', {
      method: 'POST',
      body: JSON.stringify({ channelId, channelProductId, masterProductId: masterId })
    });
    if (response.ok) {
      forgetWorkbenchRow(channelId, channelProductId);
      showToast('Eşleştirme onaylandı.');
      await loadWorkbench();
      await loadOpsSummary();
    } else {
      showToast('Onaylanamadı.');
    }
    return;
  }
  if (action === 'unmap') {
    if (!confirm('Eşleştirmeyi kaldırmak istediğinize emin misiniz?')) return;
    const response = await window.BuyBoxCommon.authFetch('/api/product-matching/remove-mapping', {
      method: 'POST',
      body: JSON.stringify({ channelId, channelProductId })
    });
    if (response.ok) {
      showToast('Eşleştirme kaldırıldı.');
      await loadWorkbench();
      await loadOpsSummary();
    }
    return;
  }
}

async function loadDataQuality() {
  const body = document.getElementById('dqBody');
  if (!body) return;
  body.innerHTML = '<tr><td colspan="5" class="matching-loading">Yükleniyor…</td></tr>';
  const params = new URLSearchParams({ category: dqCategory, page: String(dqPage), limit: '50' });
  let response;
  try {
    response = await window.BuyBoxCommon.authFetch('/api/product-matching/data-quality?' + params);
  } catch {
    return;
  }
  if (!response.ok) {
    body.innerHTML = '<tr><td colspan="5" class="matching-loading">Yüklenemedi.</td></tr>';
    return;
  }
  const data = await response.json();
  if (data.counts) {
    document.querySelectorAll('.dq-category-tab').forEach((btn) => {
      const count = data.counts[btn.dataset.category];
      const base = DQ_CATEGORIES.find((c) => c.id === btn.dataset.category)?.label || btn.dataset.category;
      btn.textContent = count ? `${base} (${count})` : base;
    });
  }
  renderDataQualityRows(data);
  const footer = document.getElementById('dqFooter');
  if (footer) footer.textContent = `${data.total} kayıt · ${DQ_CATEGORIES.find((c) => c.id === dqCategory)?.label || dqCategory}`;
}

function renderDataQualityRows(data) {
  const body = document.getElementById('dqBody');
  const cat = data.category;
  const rows = data.rows || [];
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="5" class="matching-loading">Bu kategoride kayıt yok.</td></tr>';
    return;
  }
  if (cat === 'missing_name' || cat === 'negative_stock' || cat === 'missing_cost') {
    body.innerHTML = rows.map((row) =>
      `<tr><td>${esc(masterDisplayName(row))}</td><td class="matching-barcode">${esc(row.benimposBarcode)}</td>
       <td class="${Number(row.stock) < 0 ? 'cell-warn' : ''}">${esc(row.stock)}</td>
       <td>${Number(row.buyingPrice) > 0 ? formatMoney(row.buyingPrice) : '—'}</td>
       <td><button type="button" class="btn-mini btn-master-inspect" data-master-id="${escAttr(row.id)}">İncele</button></td></tr>`
    ).join('');
  } else if (cat === 'barcode_conflicts') {
    body.innerHTML = rows.map((row) =>
      `<tr><td colspan="2">${esc(row.barcode)}</td><td colspan="2">${esc(row.reason)} · ${esc(row.candidates || '')}</td>
       <td><button type="button" class="btn-mini ghost" data-dq-goto="conflicts">Çakışmalar</button></td></tr>`
    ).join('');
  } else if (cat === 'channel_not_in_master') {
    body.innerHTML = rows.map((row) =>
      `<tr><td>${esc(row.channelName)}</td><td>${esc(row.channelBarcode || '—')}</td><td>${esc(row.channelId)}</td><td>—</td>
       <td><button type="button" class="btn-mini btn-brown" data-wb-action data-action="map" data-channel-id="${escAttr(row.channelId)}" data-channel-product-id="${escAttr(row.channelProductId)}">Eşleştir</button></td></tr>`
    ).join('');
  } else {
    body.innerHTML = rows.map((row) =>
      `<tr><td colspan="3">${esc(row.names || row.barcode)}</td><td>${row.count || '—'}</td>
       <td class="matching-barcode">${esc(row.barcode || '')}</td></tr>`
    ).join('');
  }
  body.querySelectorAll('[data-dq-goto]').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.dqGoto));
  });
  body.querySelectorAll('.btn-master-inspect').forEach((btn) => {
    btn.addEventListener('click', () => openMasterDetailById(btn.dataset.masterId));
  });
  body.querySelectorAll('[data-wb-action]').forEach((btn) => {
    btn.addEventListener('click', () => handleWorkbenchAction(btn.dataset));
  });
}

function renderMasterChannelBadges(row) {
  const logos = window.PetFixChannelLogos;
  const flags = row.qualityFlags || {};
  const hasPosIssue = flags.missingName || flags.negativeStock || flags.missingCost;
  return SALES_CHANNELS.map((channel) => {
    if (!logos) return '';
    if (channel.status === 'planned') {
      return logos.render(channel.id, { state: 'wait', title: `${channel.label}: yakında` });
    }
    if (hasPosIssue) {
      return logos.render(channel.id, { state: 'warn', title: 'Merkez veri sorunu' });
    }
    const status = row.channelMappings?.[channel.id] || 'unmapped';
    const hasCp = (row.channelMappingDetails || []).some((d) => d.channelId === channel.id);
    if (status === 'manual_confirmed') {
      return logos.render(channel.id, { state: 'ok', title: `${channel.label}: onaylı` });
    }
    if (status === 'auto_matched') {
      return logos.render(channel.id, { state: 'warn', title: `${channel.label}: otomatik onay bekliyor` });
    }
    if (['pending', 'review_required', 'barcode_conflict', 'missing_master'].includes(status)) {
      return logos.render(channel.id, { state: 'danger', title: `${channel.label}: eşleştirme gerek` });
    }
    if (!hasCp) {
      return logos.render(channel.id, { state: 'none', title: `${channel.label}: kanalda ürün yok` });
    }
    return logos.render(channel.id, { state: 'danger', title: `${channel.label}: eşleşmedi` });
  }).join('');
}

function renderMasterProfitCell(row) {
  const profit = row.profitPct;
  const flags = row.qualityFlags || {};
  const warnings = [];
  if (flags.missingName) warnings.push('Ad eksik');
  if (flags.negativeStock) warnings.push('Negatif stok');
  if (flags.missingCost) warnings.push('Maliyetsiz');
  if (flags.missingMeta) warnings.push('Gramaj/varyant eksik');
  const profitHtml = profit != null
    ? formatMasterProfitDiff(profit)
    : '<span class="muted">—</span>';
  const warnHtml = warnings.length
    ? `<div class="master-warn-tags">${warnings.map((w) => `<span class="master-warn-tag">${esc(w)}</span>`).join('')}</div>`
    : '';
  return profitHtml + warnHtml;
}

function formatMasterUpdated(row) {
  const ts = row.syncedAt || row.updatedAt;
  if (!ts) return '<span class="muted">—</span>';
  return esc(new Date(ts).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' }));
}

async function openMasterDetailById(masterId) {
  const cached = masterRowsCache.find((r) => r.id === masterId);
  let response;
  try {
    response = await window.BuyBoxCommon.authFetch('/api/product-matching/master-products/' + encodeURIComponent(masterId));
  } catch {
    return;
  }
  if (!response.ok) {
    showToast('Ürün detayı yüklenemedi.');
    return;
  }
  const data = await response.json();
  masterDetailTarget = data.master;
  document.getElementById('masterDetailTitle').textContent = masterDisplayName(data.master);
  renderMasterDetailHeaderLogos(data.master);
  renderMasterDetailBody(data.master, data);
}

function renderMasterDetailHeaderLogos(row) {
  const el = document.getElementById('masterDetailChannelRow');
  if (!el || !row) return;
  el.innerHTML = `<div class="master-channel-badges">${renderMasterChannelBadges(row)}</div>`;
}

function openMasterDetailDrawer(row, detailPayload = null) {
  masterDetailTarget = row;
  const drawer = document.getElementById('masterDetailDrawer');
  const backdrop = document.getElementById('masterDetailBackdrop');
  if (!drawer || !backdrop) {
    openMasterEditModal(row);
    return;
  }
  document.getElementById('masterDetailTitle').textContent = masterDisplayName(row);
  renderMasterDetailHeaderLogos(row);
  drawer.hidden = false;
  backdrop.hidden = false;
  document.body.classList.add('master-detail-open');
  if (detailPayload) {
    renderMasterDetailBody(row, detailPayload);
  } else {
    document.getElementById('masterDetailBody').innerHTML = '<p class="matching-loading">Yükleniyor…</p>';
    openMasterDetailById(row.id);
  }
}

function closeMasterDetailDrawer() {
  masterDetailTarget = null;
  const drawer = document.getElementById('masterDetailDrawer');
  const backdrop = document.getElementById('masterDetailBackdrop');
  if (drawer) drawer.hidden = true;
  if (backdrop) backdrop.hidden = true;
  document.body.classList.remove('master-detail-open');
}

function formatMappingLogAction(action) {
  const key = String(action || '').trim();
  return MAPPING_LOG_LABELS[key] || key.replace(/_/g, ' ') || 'İşlem';
}

function channelLabelById(channelId) {
  const hit = SALES_CHANNELS.find((c) => c.id === channelId);
  return hit?.label || channelId || '—';
}

function renderMasterMappingHistory(history = []) {
  if (!history.length) {
    return '<p class="muted">Bu ürün için eşleştirme geçmişi kaydı yok.</p>';
  }
  return `<ol class="master-detail-timeline">${history.map((log) => {
    const statusBefore = log.before?.status ? STATUS_LABELS[log.before.status] || log.before.status : '';
    const statusAfter = log.after?.status ? STATUS_LABELS[log.after.status] || log.after.status : '';
    const delta = statusBefore && statusAfter && statusBefore !== statusAfter
      ? `<span class="master-detail-timeline-delta">${esc(statusBefore)} → ${esc(statusAfter)}</span>`
      : '';
    return `<li class="master-detail-timeline-item">` +
      `<time class="master-detail-timeline-time">${formatSyncTime(log.at)}</time>` +
      `<div class="master-detail-timeline-body">` +
      `<strong>${esc(formatMappingLogAction(log.action))}</strong>` +
      `${log.channelId ? `<span class="muted"> · ${esc(channelLabelById(log.channelId))}</span>` : ''}` +
      `${delta}` +
      `${log.actor && log.actor !== 'system' ? `<div class="muted">${esc(log.actor)}</div>` : ''}` +
      `</div></li>`;
  }).join('')}</ol>`;
}

function renderMasterChannelPricesTable(prices = []) {
  const rows = (prices || []).filter((p) => p.channelId);
  if (!rows.length) return '';
  return `<table class="master-detail-price-table"><thead><tr>` +
    `<th>Kanal</th><th>Fiyat</th><th>BenimPOS farkı</th></tr></thead><tbody>` +
    rows.map((p) => {
      const diff = p.saleDiffPct;
      const diffHtml = diff != null
        ? `<span class="${Math.abs(diff) >= 10 ? 'master-price-warn' : ''}">${diff > 0 ? '+' : ''}${diff}%</span>`
        : '<span class="muted">—</span>';
      return `<tr><td>${esc(channelLabelById(p.channelId))}</td>` +
        `<td>${Number(p.channelPrice) > 0 ? formatMoney(p.channelPrice) : '<span class="muted">Yok</span>'}</td>` +
        `<td>${diffHtml}</td></tr>`;
    }).join('') +
    `</tbody></table>`;
}

function renderMasterDetailBody(master, payload) {
  const body = document.getElementById('masterDetailBody');
  if (!body) return;
  const flags = payload.master?.qualityFlags || master.qualityFlags || {};
  const qualityItems = [];
  if (flags.missingName) qualityItems.push('Ürün adı eksik veya geçersiz');
  if (flags.negativeStock) qualityItems.push('Negatif stok');
  if (flags.missingCost) qualityItems.push('Maliyet tanımlı değil');
  if (flags.missingMeta) qualityItems.push('Gramaj / varyant eksik');
  const qualityHtml = qualityItems.length
    ? `<ul class="master-detail-warnings">${qualityItems.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`
    : '<p class="muted">Veri kalitesi uyarısı yok.</p>';
  const logos = window.PetFixChannelLogos;
  const channels = (payload.channelSlots || []).map((slot) => {
    const m = slot.mapping;
    const status = slot.mappingStatus || 'unmapped';
    const price = m?.channelSalePrice;
    const logoHtml = logos ? `<div class="master-detail-channel-logo">${logos.render(slot.channelId, { size: 'md' })}</div>` : '';
    return `<div class="master-detail-channel-row">
      ${logoHtml}
      <div class="master-detail-channel-body">
        <div class="master-detail-channel-main">
          <strong>${esc(slot.channelLabel)}</strong>
          <span class="matching-badge ${escAttr(status)}">${esc(STATUS_LABELS[status] || status)}</span>
        </div>
        <div class="muted">${m ? esc(m.channelName || m.channelProductId) : 'Bağlı kanal ürünü yok'}</div>
        <div class="master-detail-channel-meta">
          ${m?.channelBarcode ? `Barkod: ${esc(m.channelBarcode)} · ` : ''}
          ${price > 0 ? formatMoney(price) : 'Fiyat yok'}
          ${m?.lastSeenAt ? ` · ${formatSyncTime(m.lastSeenAt)}` : ''}
        </div>
        <div class="master-detail-channel-actions">
        ${m
    ? `<button type="button" class="btn-mini btn-master-channel-edit" data-channel-id="${escAttr(slot.channelId)}" data-channel-product-id="${escAttr(m.channelProductId)}" data-barcode="${escAttr(master.benimposBarcode)}" data-status="${escAttr(status)}">Eşleştirmeyi düzenle</button>
           <button type="button" class="btn-mini btn-master-channel-unmap" data-channel-id="${escAttr(slot.channelId)}" data-channel-product-id="${escAttr(m.channelProductId)}">Eşleştirmeyi kaldır</button>`
    : `<button type="button" class="btn-mini btn-master-channel-search" data-channel-id="${escAttr(slot.channelId)}" data-barcode="${escAttr(master.benimposBarcode)}">Kanalda ara</button>`}
        </div>
      </div>
    </div>`;
  }).join('');
  const agg = payload.master?.matchAggregate || master.matchAggregate;
  const aggHtml = agg
    ? `<p class="master-detail-aggregate"><span class="matching-badge ${escAttr(agg.code || '')}">${esc(agg.label || agg.code || '—')}</span>` +
      `${agg.detail ? `<span class="muted"> · ${esc(agg.detail)}</span>` : ''}</p>`
    : '';
  const barcode = String(master.benimposBarcode || '').trim();
  const heroHtml = barcode
    ? `<div class="master-detail-hero">` +
      `<img class="master-detail-hero-img" src="/api/product-thumb-img?barcode=${escAttr(barcode)}" alt="" loading="lazy" ` +
      `onerror="this.classList.add('master-detail-hero-img--broken')">` +
      `<div class="master-detail-hero-meta">` +
      `<div class="master-detail-hero-name">${esc(masterDisplayName(master))}</div>` +
      `${master.brand ? `<div class="muted">${esc(master.brand)}</div>` : ''}` +
      `${aggHtml}` +
      `</div></div>`
    : '';
  body.innerHTML =
    `${heroHtml}` +
    `<section class="master-detail-section">
      <h4>BenimPOS bilgileri</h4>
      <dl class="master-detail-dl">
        <dt>Barkod</dt><dd>${esc(master.benimposBarcode)}</dd>
        <dt>Stok kodu</dt><dd>${esc(master.stockCode || '—')}</dd>
        <dt>Stok</dt><dd>${esc(master.stock)}</dd>
        <dt>Maliyet</dt><dd>${Number(master.buyingPrice) > 0 ? formatMoney(master.buyingPrice) : '—'}</dd>
        <dt>BenimPOS satış</dt><dd>${formatMoney(master.salePrice1)}</dd>
      </dl>
    </section>
    <section class="master-detail-section">
      <h4>Veri kalitesi</h4>
      ${qualityHtml}
    </section>
    <section class="master-detail-section">
      <h4>Kanal eşleştirmeleri</h4>
      <div class="master-detail-channels">${channels || '<p class="muted">—</p>'}</div>
    </section>` +
    (payload.channelPrices?.length
      ? `<section class="master-detail-section"><h4>Kanal fiyat karşılaştırması</h4>${renderMasterChannelPricesTable(payload.channelPrices)}</section>`
      : '') +
    `<section class="master-detail-section">
      <h4>Eşleştirme geçmişi</h4>
      ${renderMasterMappingHistory(payload.mappingHistory || [])}
    </section>`;
  body.querySelectorAll('.btn-master-channel-edit').forEach((btn) => {
    btn.addEventListener('click', () => {
      closeMasterDetailDrawer();
      openChannelFromMaster(btn.dataset);
    });
  });
  body.querySelectorAll('.btn-master-channel-search').forEach((btn) => {
    btn.addEventListener('click', () => {
      closeMasterDetailDrawer();
      openChannelFromMaster({ ...btn.dataset, channelProductId: '', status: 'unmapped' });
    });
  });
  body.querySelectorAll('.btn-master-channel-unmap').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Bu kanal eşleştirmesini kaldırmak istiyor musunuz?')) return;
      try {
        const response = await window.BuyBoxCommon.authFetch('/api/product-matching/remove-mapping', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channelId: btn.dataset.channelId,
            channelProductId: btn.dataset.channelProductId
          })
        });
        if (!response.ok) throw new Error('Kaldırılamadı');
        showToast('Eşleştirme kaldırıldı.');
        await openMasterDetailById(master.id);
        await loadMasterProducts();
      } catch (err) {
        showToast(err.message || 'Kaldırma hatası');
      }
    });
  });
  syncMasterDetailFoot(master, payload);
  window.MatchingPoolUi?.enhanceDetailBody?.(master, payload);
}

function syncMasterDetailFoot(master, payload) {
  const confirmBtn = document.getElementById('masterDetailConfirmBtn');
  if (!confirmBtn) return;
  const slots = payload?.channelSlots || [];
  const pending = slots.find((slot) =>
    ['auto_matched', 'pending', 'review_required'].includes(slot.mappingStatus));
  confirmBtn.disabled = !pending;
  confirmBtn.title = pending ? '' : 'Onaylanacak bekleyen eşleştirme yok';
}

function masterDisplayName(row) {
  const name = String(row.name || '').trim();
  if (name && name !== '.' && name.length > 1) return name;
  return String(row.brand || row.categoryName || row.benimposBarcode || '—').trim();
}

function renderMasterRows(rows) {
  if (window.MatchingMasterTable?.renderRows) {
    window.MatchingMasterTable.renderRows(rows);
    return;
  }
  if (window.MatchingPoolUi?.renderMasterRows) {
    window.MatchingPoolUi.renderMasterRows(rows);
    return;
  }
  if (!rows.length) {
    masterBody.innerHTML = '<tr><td colspan="' + getMasterColCount() + '" class="matching-loading">Kayıt yok.</td></tr>';
  }
}

function openMasterEditModal(row) {
  const backdrop = document.getElementById('masterEditModalBackdrop');
  if (!backdrop) {
    showToast('Sayfa güncel değil — lütfen Cmd+Shift+R ile tam yenileyin.');
    return;
  }
  masterEditTarget = row;
  document.getElementById('masterEditMeta').innerHTML =
    `<strong>${esc(row.name)}</strong><br>` +
    `<span class="muted">Barkod ${esc(row.benimposBarcode)} · Stok ${esc(row.stock)} · BenimPOS ${formatMoney(row.salePrice1)}</span>`;
  document.getElementById('masterEditWeight').value = row.normalizedWeightG ?? '';
  document.getElementById('masterEditVariant').value = row.variantKey || '';
  document.getElementById('masterEditNotes').value = row.notes || '';
  renderMasterEditMappings(row);
  backdrop.removeAttribute('hidden');
}

function renderMasterEditMappings(row) {
  const box = document.getElementById('masterEditMappings');
  if (!box) return;
  const details = row.channelMappingDetails || [];
  const activeChannels = SALES_CHANNELS.filter((c) => c.status !== 'planned');
  if (!activeChannels.length) {
    box.textContent = 'Aktif kanal yok.';
    return;
  }
  box.innerHTML = activeChannels.map((channel) => {
    const hit = details.find((item) => item.channelId === channel.id);
    const status = hit?.status || row.channelMappings?.[channel.id] || 'unmapped';
    const label = STATUS_LABELS[status] || status;
    const name = hit?.channelName || '—';
    return `<div class="master-edit-mapping-row">
      <div>
        <strong>${esc(channel.label)}</strong>
        <span class="matching-badge ${escAttr(status)}">${esc(label)}</span>
        <div class="muted">${esc(name)}</div>
      </div>
      <button type="button" class="btn-mini btn-master-channel-edit"
        data-channel-id="${escAttr(channel.id)}"
        data-channel-product-id="${escAttr(hit?.channelProductId || '')}"
        data-barcode="${escAttr(row.benimposBarcode)}"
        data-status="${escAttr(status)}">${hit ? 'Eşleştirmeyi aç' : 'Kanalda ara'}</button>
    </div>`;
  }).join('');
  box.querySelectorAll('.btn-master-channel-edit').forEach((btn) => {
    btn.addEventListener('click', () => {
      closeMasterEditModal();
      openChannelFromMaster(btn.dataset);
    });
  });
}

function closeMasterEditModal() {
  masterEditTarget = null;
  const backdrop = document.getElementById('masterEditModalBackdrop');
  if (backdrop) backdrop.setAttribute('hidden', '');
}

async function saveMasterEdit() {
  if (!masterEditTarget?.id) return;
  const btn = document.getElementById('masterEditSaveBtn');
  btn.disabled = true;
  try {
    const response = await window.BuyBoxCommon.authFetch('/api/product-matching/update-master', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        masterProductId: masterEditTarget.id,
        normalizedWeightG: document.getElementById('masterEditWeight').value,
        variantKey: document.getElementById('masterEditVariant').value,
        notes: document.getElementById('masterEditNotes').value
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      showToast(result.error || 'Kaydedilemedi.');
      return;
    }
    showToast('Ana ürün güncellendi.');
    closeMasterEditModal();
    await loadMasterProducts();
  } finally {
    btn.disabled = false;
  }
}

function openChannelFromMaster(dataset) {
  const channelId = dataset.channelId || 'uber-eats';
  const barcode = dataset.barcode || '';
  const channelProductId = dataset.channelProductId || '';
  const status = dataset.status || '';

  if (channelId === 'uber-eats') {
    switchTab('uber-eats');
    if (barcode) document.getElementById('uberSearch').value = barcode;
    if (status && uberFilterForm.querySelector('[name=status]')) {
      uberFilterForm.querySelector('[name=status]').value =
        ['unmapped', 'pending', 'review_required', 'auto_matched', 'manual_confirmed', 'missing_master'].includes(status)
          ? status
          : '';
    }
    uberPage = 1;
    loadUberProducts().then(() => {
      if (channelProductId) highlightChannelRow(channelProductId);
    });
    return;
  }

  if (channelId === 'trendyol-marketplace') {
    pendingChannelHighlight = channelProductId ? { channelId, channelProductId } : null;
    trendyolCatalogQuery = barcode || '';
    switchTab('trendyol-marketplace');
    return;
  }

  if (channelId === 'woocommerce') {
    pendingChannelHighlight = channelProductId ? { channelId, channelProductId } : null;
    woocommerceCatalogQuery = barcode || '';
    switchTab('woocommerce');
    return;
  }

  if (channelId === 'yemeksepeti') {
    pendingChannelHighlight = channelProductId ? { channelId, channelProductId } : null;
    yemeksepetiCatalogQuery = barcode || '';
    switchTab('yemeksepeti');
    return;
  }

  switchTab(channelId);
}

function applyPendingChannelHighlight(channelId) {
  if (!pendingChannelHighlight || pendingChannelHighlight.channelId !== channelId) return;
  const id = pendingChannelHighlight.channelProductId;
  pendingChannelHighlight = null;
  if (id) highlightChannelRow(id);
}

function highlightChannelRow(channelProductId) {
  const row = document.querySelector(`[data-cp="${CSS.escape(channelProductId)}"]`);
  row?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  row?.classList.add('row-highlight');
  setTimeout(() => row?.classList.remove('row-highlight'), 2500);
}

function highlightUberRow(channelProductId) {
  highlightChannelRow(channelProductId);
}

function copyText(value, message) {
  const text = String(value || '').trim();
  if (!text) return;
  navigator.clipboard?.writeText(text).then(() => showToast(message)).catch(() => showToast(text));
}

async function loadUberProducts() {
  const params = new URLSearchParams(new FormData(uberFilterForm));
  params.set('channelId', 'uber-eats');
  params.set('limit', String(UBER_PAGE_SIZE));
  params.set('page', String(uberPage));
  uberBody.innerHTML = '<tr><td colspan="8" class="matching-loading">Yükleniyor…</td></tr>';

  const response = await window.BuyBoxCommon.authFetch('/api/product-matching/price-compare?' + params);
  if (!response.ok) {
    uberBody.innerHTML = '<tr><td colspan="8" class="matching-loading">Yüklenemedi.</td></tr>';
    return;
  }
  const data = await response.json();
  uberTotalPages = data.totalPages || 1;
  if (uberPage > uberTotalPages) {
    uberPage = uberTotalPages;
    return loadUberProducts();
  }
  renderUberSummary(data.summary);
  renderUberRows(data.rows || [], data.searchHint);
  renderUberMultiGroups(data.masterMultiUber || [], data.summary);
  renderUberActiveFilters();
  const markup25Btn = document.getElementById('confirmMarkup25BulkBtn');
  if (markup25Btn) markup25Btn.hidden = !(data.summary?.markup25ReviewCount > 0);
  uberFooter.textContent =
    `${data.total} ürün · medyan fark ${formatPct(data.summary?.medianSaleDiffPct)} · sayfa ${data.page}/${data.totalPages}`;
  updateUberPagination(data);
}

const UBER_FILTER_LABELS = {
  status: {
    auto_matched: 'Otomatik eşleşti',
    manual_confirmed: 'Manuel onaylı',
    review_required: 'Kontrol gerek',
    barcode_conflict: 'Barkod çakışması',
    missing_master: 'BenimPOS\'ta yok',
    unmapped: 'Eşleşmedi'
  },
  match: {
    barcode: 'Barkod eşleşen',
    mapped: 'Eşleştirilmiş',
    unmapped: 'Barkod var · eşleşmemiş',
    no_master: 'BenimPOS\'ta yok',
    split_recommended: '1→N ayrılmalı'
  },
  diff: {
    high: 'Fark ≥ %10',
    meaningful: 'Gerçek satış farkı ≥ %10',
    suspicious_sale: 'Satış ≤ ₺1',
    missing_price: 'Fiyat eksik',
    markup_25: 'Tam %25 fark (Uber marjı)'
  },
  onSale: {
    on: 'Uber\'de satışta',
    off: 'Uber\'de satışta değil',
    unknown: 'Satış durumu bilinmiyor'
  },
  sort: {
    sale_diff_desc: 'Satış farkı ↓',
    sale_diff_asc: 'Fark ↑',
    margin_desc: 'Marj / alış',
    uber_price: 'Uber fiyat',
    name: 'Ada göre'
  }
};

function renderUberActiveFilters() {
  const el = document.getElementById('uberActiveFilters');
  if (!el || !uberFilterForm) return;
  const fd = new FormData(uberFilterForm);
  const chips = [];
  const q = String(fd.get('q') || '').trim();
  if (q) chips.push(`Arama: “${q}”`);
  for (const key of ['status', 'match', 'diff', 'onSale']) {
    const val = String(fd.get(key) || '').trim();
    if (val) chips.push(UBER_FILTER_LABELS[key]?.[val] || val);
  }
  const sort = String(fd.get('sort') || '').trim();
  if (sort && sort !== 'sale_diff_desc') {
    chips.push(`Sıra: ${UBER_FILTER_LABELS.sort[sort] || sort}`);
  }
  if (!chips.length) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  el.hidden = false;
  el.innerHTML = `<span class="matching-active-filters-label">Aktif filtre:</span> ${chips.map((c) => `<span class="matching-filter-chip">${esc(c)}</span>`).join(' ')}`;
}

const REASON_LABELS = {
  isim_uyusmazligi: 'İsim uyuşmaz',
  isim_dusuk_benzerlik: 'Düşük isim benzerliği',
  gramaj_farkli: 'Gramaj farklı',
  varyant_farkli: 'Varyant farklı',
  paket_tipi_farkli: 'Paket tipi farklı',
  barkod_yok: 'Barkod yok',
  benimpos_barkod_yok: 'BenimPOS\'ta yok',
  'aynı_barkod_birden_fazla_ana_urun': 'Barkod çakışması'
};

function bindQuickFilterClicks() {
  document.getElementById('uberActiveFilters')?.querySelectorAll('[data-quick-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const { status, diff, match, onSale } = btn.dataset;
      const form = uberFilterForm;
      if (status != null) form.querySelector('[name=status]').value = status;
      if (diff != null) form.querySelector('[name=diff]').value = diff;
      if (match != null) form.querySelector('[name=match]').value = match;
      if (onSale != null) form.querySelector('[name=onSale]').value = onSale;
      uberPage = 1;
      loadUberProducts();
    });
  });
}

function renderUberSummary(summary) {
  const el = document.getElementById('uberPriceSummary');
  if (!el || !summary) return;
  el.innerHTML =
    `<span class="price-stat">Uber: <strong>${summary.totalUber}</strong></span>` +
    `<span class="price-stat">Onaylı: <strong>${summary.manualConfirmed ?? summary.mapped ?? '—'}</strong>` +
    (summary.readyForSalesPct != null ? ` <small>(${summary.readyForSalesPct}%)</small>` : '') + `</span>` +
    `<span class="price-stat">Medyan fark: <strong>${formatPct(summary.medianSaleDiffPct)}</strong></span>` +
    `<span class="price-stat">Satışta: <strong>${summary.onSaleCount ?? '—'}</strong></span>` +
    `<span class="price-stat">Satışta değil: <strong>${summary.notOnSaleCount ?? '—'}</strong></span>`;

  const quickHost = document.getElementById('uberActiveFilters');
  if (!quickHost) return;
  const chips = [];
  if (summary.reviewRequired) {
    chips.push(`<button type="button" class="matching-quick-chip matching-quick-chip--warn" data-quick-filter data-status="review_required">Kontrol gerek (${summary.reviewRequired})</button>`);
  }
  if (summary.notOnSaleCount) {
    chips.push(`<button type="button" class="matching-quick-chip" data-quick-filter data-on-sale="off">Satışta değil (${summary.notOnSaleCount})</button>`);
  }
  if (summary.missingMaster) {
    chips.push(`<button type="button" class="matching-quick-chip" data-quick-filter data-status="missing_master">BenimPOS\'ta yok (${summary.missingMaster})</button>`);
  }
  if (summary.highDiffCount) {
    chips.push(`<button type="button" class="matching-quick-chip" data-quick-filter data-diff="meaningful">Satış farkı ≥%10 (${summary.highDiffCount})</button>`);
  }
  if (summary.suspiciousSaleCount) {
    chips.push(`<button type="button" class="matching-quick-chip matching-quick-chip--warn" data-quick-filter data-diff="suspicious_sale">Satış ≤₺1 (${summary.suspiciousSaleCount})</button>`);
  }
  if (summary.markup25ReviewCount) {
    chips.push(`<button type="button" class="matching-quick-chip" data-quick-filter data-diff="markup_25" data-status="review_required">Tam %25 fark (${summary.markup25ReviewCount})</button>`);
  }
  if (summary.splitRecommendedGroups) {
    chips.push(`<button type="button" class="matching-quick-chip matching-quick-chip--warn" data-quick-filter data-match="split_recommended">1→N ayrılmalı (${summary.splitRecommendedGroups})</button>`);
  }
  quickHost.hidden = !chips.length;
  quickHost.innerHTML = chips.length
    ? `<span class="matching-quick-label">Hızlı filtre:</span>${chips.join('')}`
    : '';
  bindQuickFilterClicks();
}

let pendingUberMultiGroups = null;

function initUberMultiPanel() {
  const panel = document.getElementById('uberMultiPanel');
  if (!panel || panel.dataset.bound) return;
  panel.dataset.bound = '1';
  if (sessionStorage.getItem('uberMultiPanelOpen') === '1') {
    panel.open = true;
  }
  panel.addEventListener('toggle', () => {
    sessionStorage.setItem('uberMultiPanelOpen', panel.open ? '1' : '0');
    if (panel.open && pendingUberMultiGroups) {
      paintUberMultiGroups(pendingUberMultiGroups.groups);
    }
  });
}

function updateUberMultiSummary(groups, summary = {}) {
  const panel = document.getElementById('uberMultiPanel');
  const summaryEl = document.getElementById('uberMultiSummary');
  const count = groups.length || summary.masterMultiUberGroups || 0;
  const splitCount = summary.splitRecommendedGroups
    || groups.filter((g) => g.recommendation?.strategy === 'split_recommended').length;

  if (summaryEl) {
    let label = count
      ? `Çoklu Uber eşleşmeleri (${count} ana ürün)`
      : 'Çoklu Uber eşleşmesi yok';
    if (splitCount) {
      label += ` · ${splitCount} ayrılmalı`;
    }
    summaryEl.textContent = label;
  }

  if (panel) {
    panel.hidden = count === 0;
  }
}

function paintUberMultiGroups(groups) {
  const box = document.getElementById('uberMultiGroups');
  if (!box) return;

  if (!groups.length) {
    box.innerHTML = '';
    return;
  }

  box.innerHTML = groups.map((g) => {
    const warn = g.recommendation?.strategy === 'split_recommended';
    return `<div class="price-multi-card${warn ? ' price-multi-card--warn' : ''}">` +
      `<div class="price-multi-head"><strong>${esc(g.masterName)}</strong> · ${esc(g.masterBarcode)} · ${g.uberCount} Uber listesi</div>` +
      `<p class="muted">${esc(g.recommendation?.summary || '')}</p>` +
      `<ul class="price-multi-list">${(g.uberItems || []).map((u) =>
        `<li>${u.salesPrimary ? '★ ' : ''}${esc(u.channelDisplayName || u.channelName || u.channelBarcode)} · Uber ${formatMoney(u.uberPrice)} · Ana havuz ${formatMoney(g.masterSalePrice)}` +
        `${!u.salesPrimary ? ` <button type="button" class="btn-mini btn-set-primary" data-master="${escAttr(g.masterProductId)}" data-cp="${escAttr(u.channelProductId)}" title="Eşleştirme yapmaz">Birincil yap</button>` : ' <span class="matching-badge manual_confirmed">Birincil</span>'}` +
        `</li>`
      ).join('')}</ul>` +
    `</div>`;
  }).join('');

  box.querySelectorAll('.btn-set-primary').forEach((btn) => {
    btn.addEventListener('click', () => setPrimaryMapping(btn.dataset.master, btn.dataset.cp));
  });
}

function renderUberMultiGroups(groups, summary = {}) {
  initUberMultiPanel();
  pendingUberMultiGroups = { groups, summary };
  updateUberMultiSummary(groups, summary);

  const panel = document.getElementById('uberMultiPanel');
  const box = document.getElementById('uberMultiGroups');
  if (!box) return;

  if (panel?.open) {
    paintUberMultiGroups(groups);
    return;
  }

  box.innerHTML = '';
}

function renderUberProductCell(row) {
  const brand = String(row.uberBrand || row.channelBrand || '').trim();
  const rawName = String(row.channelName || '—').trim();
  const nameHtml = brand
    ? `<span class="product-brand-tag product-brand-tag--uber">${esc(brand)}</span><span class="product-name-rest">${esc(rawName)}</span>`
    : esc(rawName);
  return `<div class="matching-product-name matching-product-name--branded">${nameHtml}</div>` +
    `<div class="matching-product-meta">${esc(row.channelBarcode)}</div>`;
}

function renderMasterProductCell(row) {
  if (!row.masterName) return '<span class="muted">—</span>';
  const equiv = row.barcodeEquivalentOnly
    ? ' <span class="matching-barcode-equiv" title="Barkodlar yalnızca baştaki 0 farkıyla eşleşiyor">≈ barkod</span>'
    : '';
  return `<div class="matching-product-name">${esc(row.masterName)}</div>` +
    `<div class="matching-product-meta">${esc(row.masterBarcode)}${equiv}</div>`;
}

function isMappedRow(row) {
  const status = row.mappingStatus || 'unmapped';
  return Boolean(row.hasMappedMaster)
    || status === 'manual_confirmed'
    || status === 'auto_matched';
}

function renderUberEmptyState(searchHint) {
  if (!searchHint) {
    return '<tr><td colspan="8" class="matching-empty-state">Kayıt yok. Filtreleri gevşetin veya <strong>Uber Katalog</strong> / <strong>Tam Uber Sync</strong> ile kataloğu güncelleyin.</td></tr>';
  }

  if (searchHint.uberInCatalog) {
    const status = searchHint.mappingStatus || 'unmapped';
    return `<tr><td colspan="8" class="matching-empty-state matching-empty-state--hint">
      <strong>${esc(searchHint.masterName)}</strong> (${esc(searchHint.masterBarcode)}) BenimPOS'ta var.
      Uber katalog kaydı: <em>${esc(searchHint.uberProductName || '—')}</em> — eşleştirme durumu: ${badge(status)}.
      Filtreleri temizleyip barkodu tekrar arayın veya eşleştirmeyi onaylayın.
    </td></tr>`;
  }

  const related = (searchHint.relatedUber || []).map((item) =>
    `<button type="button" class="linkish uber-empty-related" data-barcode="${escAttr(item.channelBarcode)}">${esc(item.channelBarcode)} · ${esc(item.channelName)}</button>`
  ).join('');

  return `<tr><td colspan="8" class="matching-empty-state matching-empty-state--hint">
    <strong>${esc(searchHint.masterName)}</strong> (${esc(searchHint.masterBarcode)}, stok ${esc(searchHint.masterStock)}) BenimPOS'ta var;
    ancak <strong>son Uber katalog sync'inde bu barkod yok</strong>.
    Uber panelinde görünse bile API listesine girmemiş olabilir — <strong>Tam Uber Sync</strong> çalıştırın.
    ${related ? `<div class="uber-empty-related-wrap"><span class="muted">Aynı marka / seride Uber'deki yakın ürünler:</span> ${related}</div>` : ''}
    <div class="uber-empty-actions">
      <button type="button" class="btn-mini" id="uberEmptyRunSyncBtn">Tam Uber Sync</button>
      <button type="button" class="btn-mini ghost" id="uberEmptyOpenMasterBtn" data-master-id="${escAttr(searchHint.masterProductId)}">Ana havuzda aç</button>
    </div>
  </td></tr>`;
}

function bindUberEmptyStateActions() {
  document.getElementById('uberEmptyRunSyncBtn')?.addEventListener('click', () => runUberFullOps());
  document.getElementById('uberEmptyOpenMasterBtn')?.addEventListener('click', (e) => {
    switchTab('master');
    const masterSearch = document.getElementById('masterSearch');
    if (masterSearch) masterSearch.value = e.currentTarget.dataset.masterId ? '' : '';
    const barcode = document.getElementById('uberSearch')?.value?.trim();
    if (masterSearch && barcode) masterSearch.value = barcode;
    masterPage = 1;
    loadMasterProducts();
  });
  uberBody.querySelectorAll('.uber-empty-related').forEach((btn) => {
    btn.addEventListener('click', () => {
      const uberSearch = document.getElementById('uberSearch');
      if (uberSearch) uberSearch.value = btn.dataset.barcode || '';
      uberPage = 1;
      loadUberProducts();
    });
  });
}

function renderUberRows(rows, searchHint = null) {
  if (!rows.length) {
    uberBody.innerHTML = renderUberEmptyState(searchHint);
    bindUberEmptyStateActions();
    return;
  }
  uberBody.innerHTML = rows.map((row) => {
    const status = row.mappingStatus || 'unmapped';
    const saleDiff = formatDiffCell(row);
    const reasonHtml = renderReasonChips(row.mappingReasons);
    const mapped = isMappedRow(row);
    const canQuickMap = !mapped && row.hasBarcodeMaster && row.masterProductId;
    const suggestAttrs = row.masterProductId
      ? ` data-suggest-master="${escAttr(row.masterProductId)}" data-suggest-name="${escAttr(row.masterName || '')}" data-suggest-barcode="${escAttr(row.masterBarcode || row.channelBarcode)}" data-channel-brand="${escAttr(row.channelBrand || '')}"`
      : ` data-channel-brand="${escAttr(row.channelBrand || '')}"`;
    return `<tr>
      <td>${renderUberProductCell(row)}</td>
      <td>${renderMasterProductCell(row)}</td>
      <td class="price-col-uber" data-col="uber-sale">${row.uberPrice ? formatMoney(row.uberPrice) : '—'}</td>
      <td class="price-col-master" data-col="master-sale">${formatMasterSalePrice(row)}</td>
      <td class="price-col-buy muted" data-col="master-buy">${row.masterBuyingPrice ? formatMoney(row.masterBuyingPrice) : '—'}</td>
      <td>${saleDiff}</td>
      <td>${badge(status)}${formatUberOnSaleBadge(row.uberOnSale)}${row.salesPrimary ? ' <span class="matching-badge manual_confirmed">Birincil</span>' : ''}${reasonHtml}</td>
      <td class="matching-actions">
        ${status === 'review_required' && row.masterProductId
          ? `<button type="button" class="btn-mini btn-review-confirm" data-cp="${escAttr(row.channelProductId)}" data-master="${escAttr(row.masterProductId)}">Kontrol sonrası onayla</button>`
          : ''}
        ${!mapped && status === 'auto_matched' && row.masterProductId
          ? `<button type="button" class="btn-mini btn-confirm-auto" data-cp="${escAttr(row.channelProductId)}" data-master="${escAttr(row.masterProductId)}">Onayla</button>`
          : ''}
        ${canQuickMap
          ? `<button type="button" class="btn-mini btn-price-map" data-cp="${escAttr(row.channelProductId)}" data-master="${escAttr(row.masterProductId)}">Öneriyi onayla</button>`
          : ''}
        ${status === 'review_required'
          ? `<button type="button" class="btn-mini ghost" data-map="${escAttr(row.channelProductId)}" data-name="${escAttr(row.channelName)}"${suggestAttrs}>Yeniden eşleştir</button>`
          : ''}
        ${!mapped && !canQuickMap && status !== 'auto_matched' && status !== 'review_required'
          ? `<button type="button" class="btn-mini" data-map="${escAttr(row.channelProductId)}" data-name="${escAttr(row.channelName)}"${suggestAttrs}>Eşleştir</button>`
          : ''}
        ${row.hasMappedMaster && !row.salesPrimary
          ? `<button type="button" class="btn-mini ghost btn-set-primary-row" data-master="${escAttr(row.masterProductId)}" data-cp="${escAttr(row.channelProductId)}" title="Eşleştirme yapmaz — yalnızca birincil Uber SKU işareti">Birincil yap</button>`
          : ''}
        ${row.mappingId ? `<button type="button" class="btn-mini ghost" data-unmap="${escAttr(row.channelProductId)}">Kaldır</button>` : ''}
      </td>
    </tr>`;
  }).join('');

  uberBody.querySelectorAll('[data-map]').forEach((btn) => {
    btn.addEventListener('click', () => openMapModal(btn.dataset.map, btn.dataset.name, {
      masterProductId: btn.dataset.suggestMaster || null,
      masterName: btn.dataset.suggestName || null,
      masterBarcode: btn.dataset.suggestBarcode || null,
      channelBrand: btn.dataset.channelBrand || null
    }));
  });
  uberBody.querySelectorAll('[data-unmap]').forEach((btn) => {
    btn.addEventListener('click', () => removeMapping(btn.dataset.unmap));
  });
  uberBody.querySelectorAll('.btn-review-confirm').forEach((btn) => {
    btn.addEventListener('click', () => confirmReviewRow(btn));
  });
  uberBody.querySelectorAll('.btn-confirm-auto').forEach((btn) => {
    btn.addEventListener('click', () => confirmAutoMatchedRow(btn));
  });
  uberBody.querySelectorAll('.btn-price-map').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const response = await window.BuyBoxCommon.authFetch('/api/product-matching/confirm', {
        method: 'POST',
        body: JSON.stringify({
          channelId: 'uber-eats',
          channelProductId: btn.dataset.cp,
          masterProductId: btn.dataset.master
        })
      });
      if (!response.ok) { showToast('Eşleştirme kaydedilemedi.'); return; }
      showToast('Eşleştirme onaylandı.');
      await loadStatus();
      await loadUberProducts();
    });
  });
  uberBody.querySelectorAll('.btn-set-primary-row').forEach((btn) => {
    btn.addEventListener('click', () => setPrimaryMapping(btn.dataset.master, btn.dataset.cp));
  });
}

function updateUberPagination(data) {
  const nav = document.getElementById('uberPagination');
  const label = document.getElementById('uberPageLabel');
  const prev = document.getElementById('uberPrevPage');
  const next = document.getElementById('uberNextPage');
  if (!nav) return;
  const totalPages = data.totalPages || 1;
  nav.hidden = totalPages <= 1;
  if (label) label.textContent = `Sayfa ${data.page} / ${totalPages}`;
  if (prev) prev.disabled = data.page <= 1;
  if (next) next.disabled = data.page >= totalPages;
}

async function confirmAutoMatchedRow(btn) {
  const channelProductId = btn.dataset.cp;
  const masterProductId = btn.dataset.master;
  if (!channelProductId || !masterProductId) return;
  btn.disabled = true;
  const response = await window.BuyBoxCommon.authFetch('/api/product-matching/confirm', {
    method: 'POST',
    body: JSON.stringify({ channelId: 'uber-eats', channelProductId, masterProductId })
  });
  if (!response.ok) {
    showToast('Onaylanamadı.');
    btn.disabled = false;
    return;
  }
  showToast('Eşleştirme manuel onaylandı.');
  await loadStatus();
  await loadUberProducts();
  loadSalesGateBanner();
}

async function confirmMarkup25Bulk() {
  const markup25Review = (await (await window.BuyBoxCommon.authFetch('/api/product-matching/status')).json())
    ?.uberEats?.markup25ReviewCount ?? 0;
  if (markup25Review <= 0) {
    showToast('Onaylanacak %25 farklı ürün yok.');
    return;
  }
  if (!confirm(`${markup25Review} ürün tam %25 fiyat farkına sahip — Ana Havuz +%25 Uber marjı kuralına uyuyor. Hepsini manuel onaylı yapmak istiyor musunuz?`)) return;

  const btn = document.getElementById('confirmMarkup25BulkBtn');
  if (btn) btn.disabled = true;
  try {
    const response = await window.BuyBoxCommon.authFetch('/api/product-matching/confirm-markup-25-bulk', {
      method: 'POST',
      body: JSON.stringify({ channelId: 'uber-eats' })
    });
    if (!response.ok) { showToast('Toplu onay başarısız.'); return; }
    const result = await response.json();
    showToast(`${result.confirmed || 0} eşleştirme onaylandı${result.remaining ? ` · ${result.remaining} kaldı` : ''}.`);
    await loadStatus();
    await loadUberProducts();
    loadSalesGateBanner();
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function confirmAutoMatchedBulk() {
  const autoCount = Number(document.getElementById('statAutoMatched')?.textContent || 0);
  if (!autoCount) {
    showToast('Onay bekleyen otomatik eşleşme yok.');
    return;
  }
  if (!confirm(`${autoCount} otomatik eşleşmeyi manuel onaylı yapmak istiyor musunuz? Bu işlem geri alınamaz.`)) return;

  const btn = document.getElementById('confirmAutoMatchedBulkBtn');
  btn.disabled = true;
  showToast('Toplu onay çalışıyor…');
  try {
    const response = await window.BuyBoxCommon.authFetch('/api/product-matching/confirm-auto-matched-bulk', {
      method: 'POST',
      body: JSON.stringify({ channelId: 'uber-eats' })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      showToast(result.error || 'Toplu onay başarısız.');
      return;
    }
    showToast(`${result.confirmed || 0} eşleştirme onaylandı${result.remaining ? ` · ${result.remaining} kaldı` : ''}.`);
    await loadStatus();
    await loadUberProducts();
    loadSalesGateBanner();
  } finally {
    btn.disabled = false;
  }
}

async function setPrimaryMapping(masterProductId, channelProductId) {
  const response = await window.BuyBoxCommon.authFetch('/api/product-matching/set-primary-mapping', {
    method: 'POST',
    body: JSON.stringify({ channelId: 'uber-eats', masterProductId, channelProductId })
  });
  if (!response.ok) { showToast('Birincil atanamadı.'); return; }
  showToast('Birincil Uber SKU işaretlendi.');
  await loadUberProducts();
}

function formatMasterSalePrice(row) {
  const price = Number(row.masterSalePrice);
  if (!Number.isFinite(price) || price <= 0) return '<span class="muted">—</span>';
  if (price <= 1 && Number(row.uberPrice) > 10) {
    return `<span class="price-suspect" title="Ana havuz satış fiyatı muhtemelen hatalı (₺1)">${formatMoney(price)} ⚠</span>`;
  }
  return formatMoney(price);
}

async function confirmReviewRow(btn) {
  const channelProductId = btn.dataset.cp;
  const masterProductId = btn.dataset.master;
  if (!channelProductId || !masterProductId) return;
  if (!confirm('Kontrol gerek uyarılarına rağmen bu eşleştirmeyi manuel onaylamak istiyor musunuz?')) return;
  btn.disabled = true;
  const response = await window.BuyBoxCommon.authFetch('/api/product-matching/confirm', {
    method: 'POST',
    body: JSON.stringify({ channelId: 'uber-eats', channelProductId, masterProductId })
  });
  if (!response.ok) { showToast('Onaylanamadı.'); btn.disabled = false; return; }
  showToast('Eşleştirme manuel onaylandı.');
  await loadStatus();
  await loadUberProducts();
  loadSalesGateBanner();
}

function renderReasonChips(reasons) {
  if (!reasons?.length) return '';
  return `<div class="matching-reason-chips">${reasons.slice(0, 3).map((r) =>
    `<span class="matching-reason-chip">${esc(REASON_LABELS[r] || r)}</span>`
  ).join('')}</div>`;
}

function formatDiffCell(row) {
  const value = row.priceDiffPct ?? row.uberVsMasterSalePct;
  if (value == null || Number.isNaN(value)) return '<span class="muted">—</span>';
  const isMarkup25 = row.compareBasis === 'sale' && Math.abs(value - 25) <= 0.1;
  const cls = isMarkup25
    ? 'price-pct price-pct--markup'
    : (Math.abs(value) >= 10 ? 'price-pct price-pct--warn' : 'price-pct');
  const sign = value > 0 ? '+' : '';
  const basis = row.compareBasis === 'cost'
    ? '<span class="price-basis-tag" title="Satış ≤₺1 — fark alış fiyatına göre">alış</span>'
    : '';
  return `<span class="${cls}">${sign}${Number(value).toFixed(1)}%</span>${basis}`;
}

function formatPctCell(value) {
  if (value == null || Number.isNaN(value)) return '<span class="muted">—</span>';
  const cls = Math.abs(value) >= 10 ? 'price-pct price-pct--warn' : 'price-pct';
  const sign = value > 0 ? '+' : '';
  return `<span class="${cls}">${sign}${Number(value).toFixed(1)}%</span>`;
}

function formatPct(value) {
  if (value == null || Number.isNaN(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${Number(value).toFixed(1)}%`;
}

async function loadReports() {
  const response = await window.BuyBoxCommon.authFetch('/api/product-matching/reports?channelId=uber-eats');
  if (!response.ok) return;
  const data = await response.json();

  document.getElementById('reportMissingCount').textContent = String(data.missingOnChannel.total);
  document.getElementById('reportExtraCount').textContent = String(data.extraOnChannel.total);

  const breakdown = data.missingOnChannel.breakdown;
  const breakdownEl = document.getElementById('reportMissingBreakdown');
  if (breakdownEl && breakdown) {
    breakdownEl.textContent =
      `${breakdown.notInCatalog} ürün Uber katalog sync'inde yok · ${breakdown.inCatalogUnmapped} ürün katalogda var · eşleştirme onaylı değil`;
  }

  const missingBody = document.getElementById('reportMissingBody');
  const extraBody = document.getElementById('reportExtraBody');

  missingBody.innerHTML = (data.missingOnChannel.rows || []).slice(0, 100).map((r) => {
    const stateLabel = r.catalogState === 'not_in_catalog' ? 'Katalog yok' : 'Eşleşme yok';
    const stateClass = r.catalogState === 'not_in_catalog' ? 'report-state--catalog-miss' : 'report-state--unmap';
    return `<tr class="report-row-clickable" data-barcode="${escAttr(r.benimposBarcode)}" data-catalog="${escAttr(r.catalogState || '')}" title="Ana havuzda aç">` +
      `<td>${esc(r.name)}</td>` +
      `<td class="matching-barcode">${esc(r.benimposBarcode)}</td>` +
      `<td>${esc(r.stock)}</td>` +
      `<td><span class="report-state ${stateClass}">${esc(stateLabel)}</span></td>` +
    `</tr>`;
  }).join('') || '<tr><td colspan="4" class="matching-loading">Eksik yok</td></tr>';

  extraBody.innerHTML = (data.extraOnChannel.rows || []).slice(0, 100).map((r) =>
    `<tr class="report-row-clickable" data-channel-product-id="${escAttr(r.channelProductId)}" title="Uber sekmesinde aç">` +
      `<td>${esc(r.channelName)}</td>` +
      `<td class="matching-barcode">${esc(r.channelBarcode)}</td>` +
      `<td>${badge(r.mappingStatus)}</td>` +
    `</tr>`
  ).join('') || '<tr><td colspan="3" class="matching-loading">Fazla yok</td></tr>';

  missingBody.querySelectorAll('.report-row-clickable[data-barcode]').forEach((row) => {
    row.addEventListener('click', () => {
      switchTab('master');
      const search = document.getElementById('masterSearch');
      if (search) search.value = row.dataset.barcode || '';
      masterPage = 1;
      loadMasterProducts();
    });
  });

  extraBody.querySelectorAll('.report-row-clickable[data-channel-product-id]').forEach((row) => {
    row.addEventListener('click', () => {
      switchTab('uber-eats');
      const search = document.getElementById('uberSearch');
      if (search) search.value = row.dataset.channelProductId || '';
      uberPage = 1;
      loadUberProducts();
    });
  });
}

const REVIEW_OPTIONS = {
  unreviewed: 'İncelenmedi',
  manual_match_needed: 'Farklı barkod — manuel eşleştir',
  needs_product_card: 'BenimPOS\'ta yok — ürün kartı',
  out_of_scope: 'Pasif / test — kapsam dışı',
  suspicious: 'Barkod/gramaj şüpheli',
  sales_blocked: 'Kritik çakışma — satış engelli'
};

async function loadMissingReview() {
  const onSale = document.getElementById('missingReviewOnSaleFilter')?.value || '';
  const params = new URLSearchParams({ channelId: 'uber-eats' });
  if (onSale) params.set('onSale', onSale);

  const response = await window.BuyBoxCommon.authFetch('/api/product-matching/missing-master-review?' + params);
  if (!response.ok) return;
  const data = await response.json();
  const body = document.getElementById('missingReviewBody');
  const summary = document.getElementById('missingReviewSummary');

  const counts = Object.entries(data.byClassification || {})
    .map(([key, n]) => `${REVIEW_OPTIONS[key] || key}: ${n}`)
    .join(' · ');
  const sugCounts = Object.entries(data.bySuggestion || {})
    .map(([key, n]) => `öneri ${REVIEW_OPTIONS[key] || key}: ${n}`)
    .join(' · ');
  const onSaleCounts = data.byOnSale
    ? `satışta ${data.byOnSale.on} · satışta değil ${data.byOnSale.off} · bilinmiyor ${data.byOnSale.unknown}`
    : '';
  summary.textContent = `${data.totalUnfiltered ?? data.total} ürün · ${onSaleCounts}${counts ? ' · ' + counts : ''}${sugCounts ? ' · ' + sugCounts : ''}`;

  if (!(data.rows || []).length) {
    body.innerHTML = '<tr><td colspan="7" class="matching-loading">Eksik ana ürün yok ✓</td></tr>';
    return;
  }

  body.innerHTML = data.rows.map((row) => {
    const sug = row.suggestion || {};
    const options = Object.entries(REVIEW_OPTIONS).map(([value, label]) =>
      `<option value="${value}"${row.reviewClassification === value ? ' selected' : ''}${sug.suggestedClassification === value ? ' data-suggested="1"' : ''}>${esc(label)}</option>`
    ).join('');
    const candidate = sug.candidateMaster
      ? `<div class="review-candidate">${esc(sug.candidateMaster.name)} · ${esc(sug.candidateMaster.benimposBarcode)}` +
        ` <button type="button" class="btn-mini btn-confirm-candidate" data-master="${escAttr(sug.candidateMaster.masterProductId)}">Eşleştir</button></div>`
      : '';
    return `<tr data-cp="${escAttr(row.channelProductId)}">
      <td><div class="matching-product-name">${esc(row.channelDisplayName || row.channelName || '—')}</div></td>
      <td class="matching-barcode">${esc(row.channelBarcode)}</td>
      <td>${formatUberOnSaleBadge(row.uberOnSale, true)}</td>
      <td class="review-suggestion-cell">
        ${sug.suggestedClassification ? badge(sug.suggestedClassification) : '—'}
        <div class="review-suggestion-meta">${esc(sug.suggestedNote || '')}${sug.confidence ? ` · %${sug.confidence}` : ''}</div>
        ${candidate}
      </td>
      <td><select class="review-class-select">${options}</select></td>
      <td><input type="text" class="review-note-input" value="${escAttr(row.reviewNote || sug.suggestedNote || '')}" placeholder="Not…"></td>
      <td><button type="button" class="btn-mini btn-save-review">Kaydet</button></td>
    </tr>`;
  }).join('');

  body.querySelectorAll('.btn-save-review').forEach((btn) => {
    btn.addEventListener('click', () => saveReviewRow(btn.closest('tr')));
  });
  body.querySelectorAll('.btn-confirm-candidate').forEach((btn) => {
    btn.addEventListener('click', () => confirmCandidateMapping(btn.closest('tr'), btn.dataset.master));
  });
}

async function saveReviewRow(tr) {
  if (!tr) return;
  const btn = tr.querySelector('.btn-save-review');
  const channelProductId = tr.dataset.cp;
  const reviewClassification = tr.querySelector('.review-class-select').value;
  const reviewNote = tr.querySelector('.review-note-input').value.trim();
  btn.disabled = true;
  const saveRes = await window.BuyBoxCommon.authFetch('/api/product-matching/missing-master-review', {
    method: 'POST',
    body: JSON.stringify({ channelId: 'uber-eats', channelProductId, reviewClassification, reviewNote })
  });
  btn.disabled = false;
  if (!saveRes.ok) { showToast('Kaydedilemedi.'); return; }
  showToast('İnceleme kaydedildi.');
  await loadMissingReview();
}

async function confirmCandidateMapping(tr, masterProductId) {
  if (!tr || !masterProductId) return;
  if (!confirm('Bu Uber ürününü önerilen BenimPOS ana ürününe manuel eşleştirmek istiyor musunuz?')) return;
  const channelProductId = tr.dataset.cp;
  const response = await window.BuyBoxCommon.authFetch('/api/product-matching/confirm', {
    method: 'POST',
    body: JSON.stringify({ channelId: 'uber-eats', channelProductId, masterProductId })
  });
  if (!response.ok) { showToast('Eşleştirme kaydedilemedi.'); return; }
  showToast('Manuel eşleştirme onaylandı.');
  await loadStatus();
  await loadMissingReview();
}

async function applyReviewSuggestions() {
  const btn = document.getElementById('applyReviewSuggestionsBtn');
  if (!confirm('Güven skoru ≥70 olan öneriler incelenmemiş satırlara uygulanacak. Devam?')) return;
  btn.disabled = true;
  showToast('Öneriler uygulanıyor…');
  try {
    const response = await window.BuyBoxCommon.authFetch('/api/product-matching/missing-master-review/apply-suggestions', {
      method: 'POST',
      body: JSON.stringify({ channelId: 'uber-eats', minConfidence: 70, onlyUnreviewed: true })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { showToast(result.error || 'Uygulanamadı.'); return; }
    showToast(`${result.applied || 0} ürün sınıflandırıldı.`);
    await loadMissingReview();
  } finally {
    btn.disabled = false;
  }
}

async function loadConflicts() {
  const response = await window.BuyBoxCommon.authFetch('/api/product-matching/reports?channelId=uber-eats');
  if (!response.ok) return;
  const data = await response.json();
  const rows = data.conflicts?.rows || [];
  const masterDupes = data.conflicts?.masterBarcodeConflicts || [];

  const body = document.getElementById('conflictsBody');
  if (!rows.length && !masterDupes.length) {
    body.innerHTML = '<tr><td colspan="3" class="matching-loading">Çakışma yok ✓</td></tr>';
    return;
  }

  let html = rows.map((r) =>
    `<tr><td class="matching-barcode">${esc(r.channelBarcode)}</td><td>${esc(r.reason)}</td>
     <td>${(r.candidates || []).map((c) => esc(c.name)).join(', ') || '—'}</td></tr>`
  ).join('');

  html += masterDupes.map((d) =>
    `<tr><td class="matching-barcode">${esc(d.barcode)}</td><td>BenimPOS'ta ${d.count} ana ürün</td>
     <td>${d.items.map((i) => esc(i.name)).join(' · ')}</td></tr>`
  ).join('');

  body.innerHTML = html;
}

async function loadLogs() {
  const response = await window.BuyBoxCommon.authFetch('/api/product-matching/logs');
  if (!response.ok) return;
  const data = await response.json();
  const body = document.getElementById('logsBody');

  if (!(data.rows || []).length) {
    body.innerHTML = '<tr><td colspan="4" class="matching-loading">Henüz log yok.</td></tr>';
    return;
  }

  body.innerHTML = data.rows.map((log) =>
    `<tr><td>${formatSyncTime(log.at)}</td><td>${esc(log.action)}</td>
     <td>${esc(log.channelName || log.channelProductId || '—')}</td>
     <td>${esc(log.masterName || log.masterProductId || '—')}</td></tr>`
  ).join('');
}

async function syncMaster() {
  const btn = document.getElementById('syncMasterBtn');
  const toolbarBtn = document.getElementById('masterToolbarSyncBtn');
  if (btn) btn.disabled = true;
  if (toolbarBtn) toolbarBtn.disabled = true;
  showToast('BenimPOS ana havuz güncelleniyor…');
  try {
    const response = await window.BuyBoxCommon.authFetch('/api/product-matching/sync-master', { method: 'POST' });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { showToast(result.error || 'Sync başarısız.'); return; }
    showToast(`Ana havuz: ${result.totalInDb} ürün`);
    await loadStatus();
    await loadOpsSummary();
    await loadUberOps();
    if (activeTab === 'master') await loadMasterProducts();
  } finally {
    if (btn) btn.disabled = false;
    if (toolbarBtn) toolbarBtn.disabled = false;
  }
}

async function exportMasterCsv(options = {}) {
  const btn = document.getElementById('masterExportBtn') || document.getElementById('masterExportTopBtn');
  if (btn) btn.disabled = true;
  showToast('CSV hazırlanıyor…');
  const savedPage = masterPage;
  const selectedIds = options.masterProductIds
    || window.MatchingMasterTable?.getSelectedIds?.()
    || [];
  try {
    let allRows = [];
    if (selectedIds.length) {
      const idSet = new Set(selectedIds);
      allRows = masterRowsCache.filter((row) => idSet.has(row.id));
      if (!allRows.length) {
        showToast('Seçili ürünler mevcut sayfada yok — tüm filtreyle dışa aktarılıyor…');
      }
    }
    if (!allRows.length) {
      let page = 1;
      let totalPages = 1;
      do {
        masterPage = page;
        const params = buildMasterFilterParams();
        params.set('limit', '200');
        const response = await window.BuyBoxCommon.authFetch('/api/product-matching/master-products?' + params);
        if (!response.ok) {
          showToast('CSV dışa aktarılamadı.');
          return;
        }
        const data = await response.json();
        allRows.push(...(data.rows || []));
        totalPages = data.totalPages || 1;
        page += 1;
      } while (page <= totalPages);
    }

    if (!allRows.length) {
      showToast('Dışa aktarılacak kayıt yok.');
      return;
    }

    const activeChannels = SALES_CHANNELS.filter((c) => c.status !== 'planned');
    const headers = [
      'Ürün',
      'Barkod',
      'Stok',
      'Maliyet (₺)',
      'BenimPOS Satış (₺)',
      ...activeChannels.map((c) => `${channelShortLabel(c.id)} Fiyat (₺)`),
      ...activeChannels.map((c) => `${channelShortLabel(c.id)} Eşleşme`)
    ];
    const lines = [headers.map(csvCell).join(',')];
    for (const row of allRows) {
      const mappings = row.channelMappings || {};
      const details = row.channelMappingDetails || [];
      lines.push([
        row.name,
        row.benimposBarcode,
        row.stock,
        row.buyingPrice ?? '',
        row.salePrice1 ?? '',
        ...activeChannels.map((c) => {
          const item = (row.channelPrices || []).find((p) => p.channelId === c.id);
          const price = Number(item?.channelPrice);
          return price > 0 ? price : '!';
        }),
        ...activeChannels.map((c) => STATUS_LABELS[mappings[c.id]] || mappings[c.id] || 'Eşleşmedi')
      ].map(csvCell).join(','));
    }

    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ana-urun-havuzu-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    showToast(`${allRows.length} ürün CSV olarak indirildi.`);
  } finally {
    masterPage = savedPage;
    if (btn) btn.disabled = false;
  }
}

function csvCell(value) {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

async function syncUberCatalog() {
  const btn = document.getElementById('syncUberCatalogBtn');
  btn.disabled = true;
  showToast('Uber mağaza kataloğu çekiliyor…');
  try {
    const response = await window.BuyBoxCommon.authFetch('/api/product-matching/sync-uber-catalog', {
      method: 'POST',
      body: JSON.stringify({ allListTypes: true })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { showToast(result.error || 'Katalog sync başarısız.'); return; }
    showToast(
      `Katalog: ${result.distinctProducts ?? 0} ürün · şube ${result.storeId ?? '—'}`
      + ` · DB: ${result.totalInDb ?? 0} (+${result.added ?? 0} yeni)`
    );
    uberPage = 1;
    await loadStatus();
    await loadUberOps();
    if (activeTab === 'uber-eats') await loadUberProducts();
  } finally { btn.disabled = false; }
}

async function runAutoMatch() {
  const btn = document.getElementById('autoMatchBtn');
  const channelId = SALES_CHANNELS.some((c) => c.id === activeTab && c.status === 'active') ? activeTab : 'uber-eats';
  btn.disabled = true;
  showToast('Otomatik eşleştirme çalışıyor…');
  try {
    const response = await window.BuyBoxCommon.authFetch('/api/product-matching/run-auto-match', {
      method: 'POST',
      body: JSON.stringify({ channelId })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { showToast(result.error || 'Eşleştirme başarısız.'); return; }
    showToast(`Otomatik: ${result.autoMatched} eşleşti, ${result.reviewRequired} kontrol, ${result.missingMaster} ana ürün yok`);
    await loadStatus();
    if (activeTab === 'uber-eats' || activeTab === 'trendyol-marketplace') await loadUberProducts();
    if (activeTab === 'reports') await loadReports();
    if (activeTab === 'conflicts') await loadConflicts();
  } finally { btn.disabled = false; }
}

function openMapModal(channelProductId, channelName, suggestion = null, channelIdOverride = null) {
  const fallbackChannel = SALES_CHANNELS.some((c) => c.id === activeTab && c.status === 'active') ? activeTab : 'uber-eats';
  mapTarget = {
    channelId: channelIdOverride || fallbackChannel,
    channelProductId,
    channelName,
    suggestion: suggestion?.masterProductId ? suggestion : null
  };

  const brand = String(suggestion?.channelBrand || '').trim();
  const rawName = String(channelName || '').trim();
  const display = brand && rawName && !rawName.toLocaleLowerCase('tr-TR').startsWith(brand.toLocaleLowerCase('tr-TR'))
    ? `${brand} ${rawName}`
    : (rawName || channelProductId);

  document.getElementById('mapModalChannelInfo').innerHTML =
    `Kanal ürün: <strong>${esc(display)}</strong> <span class="muted">(${esc(channelProductId)})</span>`;

  const suggestBox = document.getElementById('mapModalSuggestion');
  if (suggestBox) {
    if (suggestion?.masterProductId) {
      suggestBox.hidden = false;
      suggestBox.innerHTML =
        `<div class="map-suggestion-card">` +
          `<div><span class="muted">Barkod eşleşmesi önerisi</span>` +
          `<strong>${esc(suggestion.masterName || suggestion.masterBarcode || 'Ana ürün')}</strong>` +
          `<span class="muted">${esc(suggestion.masterBarcode || '')}</span></div>` +
          `<button type="button" class="btn-brown" id="mapConfirmSuggestion">Bu öneriyi onayla</button>` +
        `</div>`;
      document.getElementById('mapConfirmSuggestion')?.addEventListener('click', () => {
        confirmMapping(suggestion.masterProductId);
      });
    } else {
      suggestBox.hidden = true;
      suggestBox.innerHTML = '';
    }
  }

  const searchInput = document.getElementById('mapMasterSearch');
  searchInput.value = suggestion?.masterBarcode || suggestion?.masterName?.slice(0, 30) || '';
  document.getElementById('mapMasterResults').innerHTML = '';
  mapModal.hidden = false;
  if (searchInput.value.trim().length >= 2) searchMasters();
}

function closeMapModal() {
  mapModal.hidden = true;
  mapTarget = null;
}

async function searchMasters() {
  const q = document.getElementById('mapMasterSearch').value.trim();
  const box = document.getElementById('mapMasterResults');
  if (q.length < 2) { box.innerHTML = ''; return; }

  const response = await window.BuyBoxCommon.authFetch('/api/product-matching/search-masters?q=' + encodeURIComponent(q));
  if (!response.ok) return;
  const data = await response.json();

  box.innerHTML = (data.rows || []).map((m) =>
    `<button type="button" class="map-master-item" data-id="${escAttr(m.id)}">
      <strong>${esc(m.name)}</strong><span>${esc(m.benimposBarcode)} · stok ${esc(m.stock)}</span>
    </button>`
  ).join('') || '<p class="muted">Sonuç yok</p>';

  box.querySelectorAll('.map-master-item').forEach((btn) => {
    btn.addEventListener('click', () => confirmMapping(btn.dataset.id));
  });
}

async function confirmMapping(masterProductId) {
  if (!mapTarget) return;
  const response = await window.BuyBoxCommon.authFetch('/api/product-matching/confirm', {
    method: 'POST',
    body: JSON.stringify({
      channelId: mapTarget.channelId || 'uber-eats',
      channelProductId: mapTarget.channelProductId,
      masterProductId
    })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) { showToast(result.error || 'Kaydedilemedi.'); return; }
  showToast('Eşleştirme onaylandı.');
  closeMapModal();
  await loadStatus();
  if (activeTab === 'workbench') {
    const key = workbenchRowKey(mapTarget.channelId || 'uber-eats', mapTarget.channelProductId);
    const current = getWorkbenchInboxCurrentRow();
    if (current && workbenchRowKey(current.channelId, current.channelProductId) === key) {
      removeWorkbenchInboxAtIndex(workbenchInboxIndex);
      await loadWorkbenchInboxRow(workbenchInboxIndex, { updateMeta: true });
    } else {
      await loadWorkbench();
    }
    await loadOpsSummary();
    loadSalesGateBanner();
    if (document.getElementById('workbenchListFallback')?.open) {
      await loadWorkbenchListPage();
    }
  } else if (activeTab === 'trendyol-marketplace') await loadTrendyolProducts();
  else if (activeTab === 'uber-eats') await loadUberProducts();
}

async function removeMapping(channelProductId) {
  if (!confirm('Eşleştirmeyi kaldırmak istediğinize emin misiniz?')) return;
  const response = await window.BuyBoxCommon.authFetch('/api/product-matching/remove-mapping', {
    method: 'POST',
    body: JSON.stringify({ channelId: 'uber-eats', channelProductId })
  });
  if (!response.ok) { showToast('Kaldırılamadı.'); return; }
  showToast('Eşleştirme kaldırıldı.');
  await loadStatus();
  await loadUberProducts();
}

function formatUberOnSaleBadge(onSale, block = false) {
  if (onSale === true) {
    return `<span class="uber-sale-badge uber-sale-badge--on${block ? ' uber-sale-badge--block' : ''}">Satışta</span>`;
  }
  if (onSale === false) {
    return `<span class="uber-sale-badge uber-sale-badge--off${block ? ' uber-sale-badge--block' : ''}">Satışta değil</span>`;
  }
  return `<span class="uber-sale-badge uber-sale-badge--unknown${block ? ' uber-sale-badge--block' : ''}">Bilinmiyor</span>`;
}

function isPlaceholderName(name) {
  const n = String(name || '').trim().toLowerCase();
  return !n || n === 'satış' || n === 'satis' || n === 'sale';
}

function badge(status) {
  const cls = STATUS_LABELS[status] ? status : 'unmapped';
  return `<span class="matching-badge ${cls}">${esc(STATUS_LABELS[status] || status)}</span>`;
}

function formatWeight(g) {
  if (!g) return '—';
  return g >= 1000 ? (g / 1000).toFixed(2) + ' kg' : g + ' g';
}

function formatSyncTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' });
  } catch { return iso; }
}

function formatMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '—';
  return n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toastEl.classList.remove('show'), 4500);
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[c]));
}
function escAttr(v) { return esc(v).replace(/"/g, '&quot;'); }

scheduleMatchingCenterBoot();
