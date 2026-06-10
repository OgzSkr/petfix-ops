'use strict';

const bootstrapEl = document.getElementById('bootstrap');
const bootstrap = bootstrapEl ? JSON.parse(bootstrapEl.textContent) : {};

if (bootstrap.authRequired && !window.BuyBoxCommon.getStoredToken()) {
  window.BuyBoxCommon.redirectToLogin();
}

const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', () => window.BuyBoxCommon.logout());
}

window.BuyBoxCommon.initPlatformNav?.();

let latestSummary = null;
let latestChannels = [];
let latestLivePerformance = null;
let liveRefreshTimer = null;
let liveChannelFilter = 'all';
let liveOrdersPageSize = 25;
let liveOrdersCurrentPage = 1;
let liveOrdersListKey = '';
let liveOrdersProfitFilter = 'all';

const summaryDays = document.getElementById('summaryDays');
const refreshSummaryBtn = document.getElementById('refreshSummary');
if (refreshSummaryBtn) {
  refreshSummaryBtn.addEventListener('click', () => loadProfitSummary(true));
}
if (summaryDays) {
  summaryDays.addEventListener('change', () => {
    updatePeriodSummaryDesc(summaryDays.value);
    loadProfitSummary(false);
  });
}

const refreshLiveBtn = document.getElementById('refreshLivePerformance');
if (refreshLiveBtn) {
  refreshLiveBtn.addEventListener('click', () => loadLivePerformance(true));
}

const liveFiltersEl = document.getElementById('liveChannelFilters');
if (liveFiltersEl) {
  liveFiltersEl.addEventListener('click', (event) => {
    const btn = event.target.closest('.live-channel-filter');
    if (!btn || btn.disabled || btn.dataset.channel === liveChannelFilter) return;
    liveChannelFilter = btn.dataset.channel;
    liveOrdersCurrentPage = 1;
    liveFiltersEl.querySelectorAll('.live-channel-filter').forEach((node) => {
      const active = node.dataset.channel === liveChannelFilter;
      node.classList.toggle('active', active);
      node.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    if (latestLivePerformance) renderLivePerformanceView();
  });
}

const liveOrdersPageSizeEl = document.getElementById('liveOrdersPageSize');
const liveOrdersPageNavEl = document.getElementById('liveOrdersPageNav');
if (liveOrdersPageSizeEl) {
  liveOrdersPageSizeEl.addEventListener('change', () => {
    liveOrdersPageSize = parseLivePageSize(liveOrdersPageSizeEl.value);
    liveOrdersCurrentPage = 1;
    if (latestLivePerformance) renderLivePerformanceView();
  });
}
if (liveOrdersPageNavEl) {
  liveOrdersPageNavEl.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-page-action]');
    if (!btn || btn.disabled) return;
    if (btn.dataset.pageAction === 'prev' && liveOrdersCurrentPage > 1) {
      liveOrdersCurrentPage -= 1;
      renderLivePerformanceView();
    }
    if (btn.dataset.pageAction === 'next') {
      liveOrdersCurrentPage += 1;
      renderLivePerformanceView();
    }
  });
}

const liveProfitFiltersEl = document.getElementById('liveOrdersProfitFilters');
if (liveProfitFiltersEl) {
  liveProfitFiltersEl.addEventListener('click', (event) => {
    const btn = event.target.closest('.live-profit-filter');
    if (!btn || btn.dataset.profit === liveOrdersProfitFilter) return;
    liveOrdersProfitFilter = btn.dataset.profit || 'all';
    liveOrdersCurrentPage = 1;
    liveProfitFiltersEl.querySelectorAll('.live-profit-filter').forEach((node) => {
      node.classList.toggle('active', node.dataset.profit === liveOrdersProfitFilter);
    });
    if (latestLivePerformance) renderLivePerformanceView();
  });
}

const exportLiveOrdersBtn = document.getElementById('exportLiveOrders');
if (exportLiveOrdersBtn) {
  exportLiveOrdersBtn.addEventListener('click', exportLiveOrdersCsv);
}

const CHANNEL_META = {
  'trendyol-marketplace': { slug: 'trendyol', short: 'TY', tone: 'trendyol' },
  getir: { slug: 'getir', short: 'G', tone: 'getir' },
  'uber-eats': { slug: 'uber-eats', short: 'UE', tone: 'uber' },
  yemeksepeti: { slug: 'yemeksepeti', short: 'YS', tone: 'yemeksepeti' },
  woocommerce: { slug: 'woocommerce', short: 'WC', tone: 'woo' }
};

async function loadDashboard() {
  const cardsEl = document.getElementById('channelCards');
  const opsEl = document.getElementById('opsSummary');
  const actionEl = document.getElementById('actionCenter');
  const matchingQueueEl = document.getElementById('matchingQueueBody');
  const matchingQueuePanel = document.getElementById('matchingQueuePanel');
  const livePromise = loadLivePerformance(false);

  try {
    const days = summaryDays?.value || '14';
    updatePeriodSummaryDesc(days);
    const [channelsRes, opsRes, summaryRes, actionRes, matchingQueueRes, integrityRes] = await Promise.all([
      window.BuyBoxCommon.authFetch('/api/channels/health'),
      window.BuyBoxCommon.authFetch('/api/ops/status'),
      window.BuyBoxCommon.authFetch('/api/dashboard/channels-summary?days=' + encodeURIComponent(days)),
      window.BuyBoxCommon.authFetch('/api/dashboard/action-center?days=' + encodeURIComponent(days)),
      window.BuyBoxCommon.authFetch('/api/product-matching/queue'),
      window.BuyBoxCommon.authFetch('/api/ops/data-integrity')
    ]);

    const channelsPayload = await channelsRes.json();
    const ops = await opsRes.json();
    latestChannels = channelsPayload.channels || [];

    if (summaryRes.ok) {
      latestSummary = await summaryRes.json();
      renderKpiGrid(latestSummary.totals || {});
      renderProfitTable(latestSummary);
    } else {
      renderKpiGrid({});
      document.getElementById('profitSummaryBody').innerHTML =
        '<tr><td colspan="6" class="table-empty">Kâr özeti yüklenemedi.</td></tr>';
    }

    if (actionRes.ok) {
      const actionPayload = await actionRes.json();
      renderTodayActions(actionPayload);
      renderActionCenter(actionPayload);
    } else if (actionEl) {
      actionEl.innerHTML = '<p class="analytics-empty">Aksiyon merkezi yüklenemedi.</p>';
    }

    let queueData = null;
    if (matchingQueueRes.ok) {
      queueData = await matchingQueueRes.json();
      renderMatchingQueue(queueData);
      renderChannelReadinessCards(queueData);
    } else if (matchingQueueEl) {
      matchingQueueEl.innerHTML = '<p class="analytics-empty">Eşleştirme kuyruğu yüklenemedi.</p>';
    }
    renderExecutiveSummary(latestSummary?.totals || {}, queueData);

    if (integrityRes.ok) {
      renderDataIntegrity(await integrityRes.json());
    } else {
      const integrityEl = document.getElementById('dataIntegrityBody');
      if (integrityEl) integrityEl.innerHTML = '<p class="analytics-empty">Veri denetimi yüklenemedi.</p>';
    }

    cardsEl.innerHTML = latestChannels.map((channel) =>
      renderChannelCard(channel, findSummaryChannel(channel.id))
    ).join('');

    opsEl.innerHTML = renderSystemStatus(ops);
    await livePromise;
  } catch (error) {
    if (actionEl) actionEl.innerHTML = '<p class="analytics-empty">' + esc(error.message || 'Bağlantı hatası.') + '</p>';
    cardsEl.innerHTML = '<p class="analytics-empty">Kanal durumu yüklenemedi.</p>';
    opsEl.innerHTML = '<p class="analytics-empty">' + esc(error.message || 'Bağlantı hatası.') + '</p>';
  }
}

async function loadProfitSummary(force) {
  const bodyEl = document.getElementById('profitSummaryBody');
  const kpiEl = document.getElementById('kpiGrid');
  if (!bodyEl) return;

  bodyEl.innerHTML = '<tr><td colspan="6" class="table-loading">Yükleniyor…</td></tr>';
  if (kpiEl) kpiEl.innerHTML = '<div class="kpi-skeleton">Metrikler yükleniyor…</div>';

  try {
    const params = new URLSearchParams();
    params.set('days', summaryDays?.value || '14');
    if (force) params.set('force', '1');

    const response = await window.BuyBoxCommon.authFetch('/api/dashboard/channels-summary?' + params.toString());
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Özet yüklenemedi');

    latestSummary = data;
    updatePeriodSummaryDesc(summaryDays?.value || '14');
    renderKpiGrid(data.totals || {});
    renderProfitTable(data);

    const cardsEl = document.getElementById('channelCards');
    if (cardsEl && latestChannels.length) {
      cardsEl.innerHTML = latestChannels.map((channel) =>
        renderChannelCard(channel, findSummaryChannel(channel.id))
      ).join('');
    }

    const actionRes = await window.BuyBoxCommon.authFetch(
      '/api/dashboard/action-center?days=' + encodeURIComponent(summaryDays?.value || '14')
    );
    if (actionRes.ok) {
      renderActionCenter(await actionRes.json());
    }

    const queueRefresh = await window.BuyBoxCommon.authFetch('/api/product-matching/queue');
    let queueData = null;
    if (queueRefresh.ok) queueData = await queueRefresh.json();
    renderExecutiveSummary(data.totals || {}, queueData);
  } catch (error) {
    if (kpiEl) kpiEl.innerHTML = '<p class="analytics-empty">' + esc(error.message || 'Özet yüklenemedi.') + '</p>';
    bodyEl.innerHTML = '<tr><td colspan="6" class="table-empty">' + esc(error.message || 'Hata') + '</td></tr>';
  }
}

function findSummaryChannel(channelId) {
  return (latestSummary?.channels || []).find((row) => row.id === channelId) || null;
}

async function loadLivePerformance(force) {
  const chartEl = document.getElementById('liveChartWrap');
  const kpiEl = document.getElementById('liveKpiStack');
  const bodyEl = document.getElementById('liveOrdersBody');
  const updatedEl = document.getElementById('liveUpdatedAt');
  const todayEl = document.getElementById('liveTodayProfit');
  const refreshBtn = document.getElementById('refreshLivePerformance');

  if (!chartEl || !kpiEl || !bodyEl) return;

  if (refreshBtn) refreshBtn.disabled = true;
  if (updatedEl) updatedEl.textContent = 'Güncelleniyor…';

  try {
    const params = new URLSearchParams();
    params.set('days', '1');
    if (force) params.set('force', '1');

    const response = await window.BuyBoxCommon.authFetch('/api/dashboard/live-performance?' + params.toString());
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Canlı performans yüklenemedi');

    latestLivePerformance = data;
    liveOrdersCurrentPage = 1;
    liveOrdersListKey = '';
    if (!data.byChannel?.[liveChannelFilter]) {
      liveChannelFilter = 'all';
    }
    renderLiveChannelFilters(data);
    renderLivePerformanceView();

    if (liveRefreshTimer) clearInterval(liveRefreshTimer);
    liveRefreshTimer = setInterval(() => loadLivePerformance(false), 120000);
  } catch (error) {
    if (chartEl) chartEl.innerHTML = '<p class="live-chart-empty">' + esc(error.message || 'Grafik yüklenemedi.') + '</p>';
    if (kpiEl) kpiEl.innerHTML = '<p class="analytics-empty">' + esc(error.message || 'Metrikler yüklenemedi.') + '</p>';
    if (bodyEl) bodyEl.innerHTML = '<tr><td colspan="7" class="table-empty">' + esc(error.message || 'Hata') + '</td></tr>';
    if (todayEl) todayEl.textContent = '—';
    if (updatedEl) updatedEl.textContent = 'Güncelleme başarısız';
  } finally {
    if (refreshBtn) refreshBtn.disabled = false;
  }
}

function renderLiveChannelFilters(data) {
  const el = document.getElementById('liveChannelFilters');
  if (!el) return;

  const byChannel = data.byChannel || {};
  const allCount = byChannel.all?.totalRows ?? data.totalRows ?? 0;

  el.querySelectorAll('.live-channel-filter').forEach((btn) => {
    const channelId = btn.dataset.channel;
    if (!channelId) return;

    const count = channelId === 'all'
      ? allCount
      : (byChannel[channelId]?.totalRows ?? 0);

    let badge = btn.querySelector('.live-channel-filter-count');
    if (count > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'live-channel-filter-count';
        btn.appendChild(badge);
      }
      badge.textContent = String(count);
      btn.disabled = false;
      btn.classList.remove('live-channel-filter--empty');
    } else if (channelId !== 'all') {
      if (badge) badge.remove();
      btn.disabled = false;
      btn.classList.add('live-channel-filter--empty');
    } else if (badge) {
      badge.textContent = String(count);
    }

    const active = channelId === liveChannelFilter;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
}

function getLivePerformanceView() {
  if (!latestLivePerformance) return null;

  const byChannel = latestLivePerformance.byChannel || {};
  const allRows = latestLivePerformance.allRows || latestLivePerformance.rows || [];
  let filteredRows = liveChannelFilter === 'all'
    ? allRows
    : allRows.filter((row) => row.channelId === liveChannelFilter);
  filteredRows = applyLiveProfitFilter(filteredRows);

  const breakdown = liveChannelFilter === 'all'
    ? (byChannel.all || {})
    : (byChannel[liveChannelFilter] || {});

  const emptyStats = {
    count: 0,
    totalSales: 0,
    totalProfit: 0,
    profitCostRatio: 0,
    profitSalesRatio: 0,
    profitMargin: 0
  };

  const channelLabel = (latestLivePerformance.channels || [])
    .find((row) => row.id === liveChannelFilter)?.label
    || (CHANNEL_META[liveChannelFilter] ? liveChannelFilter : '');

  return {
    stats: breakdown.stats || (filteredRows.length ? latestLivePerformance.stats : emptyStats),
    timeline: breakdown.timeline || (liveChannelFilter === 'all' ? latestLivePerformance.timeline : []),
    allFilteredRows: filteredRows,
    totalRows: filteredRows.length,
    filterLabel: liveChannelFilter === 'all' ? 'Tümü' : (breakdown.label || channelLabel)
  };
}

function parseLivePageSize(value) {
  const size = Number(value);
  return [10, 25, 50, 100].includes(size) ? size : 25;
}

function applyLiveProfitFilter(rows) {
  if (liveOrdersProfitFilter === 'profit') {
    return rows.filter((row) => Number(row.netProfit) > 0);
  }
  if (liveOrdersProfitFilter === 'loss') {
    return rows.filter((row) => Number(row.netProfit) < 0);
  }
  return rows;
}

function paginateLiveOrders(rows) {
  const listKey = liveChannelFilter + '|' + liveOrdersProfitFilter + '|' + (latestLivePerformance?.updatedAt || '');
  if (listKey !== liveOrdersListKey) {
    liveOrdersCurrentPage = 1;
    liveOrdersListKey = listKey;
  }

  const totalFiltered = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / liveOrdersPageSize) || 1);
  if (liveOrdersCurrentPage > totalPages) liveOrdersCurrentPage = totalPages;
  if (liveOrdersCurrentPage < 1) liveOrdersCurrentPage = 1;

  const start = (liveOrdersCurrentPage - 1) * liveOrdersPageSize;
  const end = Math.min(start + liveOrdersPageSize, totalFiltered);

  return {
    pageRows: rows.slice(start, end),
    totalFiltered,
    totalPages,
    start,
    end
  };
}

function renderLiveOrdersPagination(meta) {
  const rangeEl = document.getElementById('liveOrdersRange');
  const navEl = document.getElementById('liveOrdersPageNav');
  const { totalFiltered, totalPages, start, end } = meta;

  if (rangeEl) {
    if (!totalFiltered) {
      rangeEl.textContent = 'Kayıt yok';
    } else if (totalFiltered <= liveOrdersPageSize) {
      rangeEl.textContent = totalFiltered + ' sipariş gösteriliyor';
    } else {
      rangeEl.textContent = (start + 1) + '–' + end + ' / ' + totalFiltered + ' sipariş';
    }
  }

  if (!navEl) return;

  if (!totalFiltered || totalFiltered <= liveOrdersPageSize) {
    navEl.innerHTML = totalFiltered
      ? '<span class="live-page-status">Sayfa 1 / 1</span>'
      : '';
    return;
  }

  navEl.innerHTML =
    '<button type="button" data-page-action="prev"' + (liveOrdersCurrentPage <= 1 ? ' disabled' : '') + '>Önceki</button>' +
    '<span class="live-page-status">Sayfa ' + liveOrdersCurrentPage + ' / ' + totalPages + '</span>' +
    '<button type="button" data-page-action="next"' + (liveOrdersCurrentPage >= totalPages ? ' disabled' : '') + '>Sonraki</button>';
}

function renderLivePerformanceView() {
  const view = getLivePerformanceView();
  if (!view) return;
  renderLivePerformance(view, latestLivePerformance);
}

function renderLivePerformance(view, data) {
  const stats = view.stats || {};
  const todayEl = document.getElementById('liveTodayProfit');
  const updatedEl = document.getElementById('liveUpdatedAt');
  const metaEl = document.getElementById('liveOrdersMeta');
  const subtitleEl = document.querySelector('#livePerformancePanel .section-desc');

  if (todayEl) {
    todayEl.textContent = formatMoney(stats.totalProfit);
    todayEl.classList.toggle('neg', Number(stats.totalProfit) < 0);
  }
  if (updatedEl && data?.updatedAt) {
    updatedEl.textContent = 'Son güncelleme: ' + formatTime(data.updatedAt);
  }
  if (subtitleEl) {
    const todayLabel = formatTodayLabel();
    if (liveChannelFilter === 'all') {
      subtitleEl.textContent = todayLabel + ' — tüm kanallar birleşik';
    } else {
      subtitleEl.textContent = todayLabel + ' — ' + (view.filterLabel || 'seçili kanal');
    }
  }
  if (metaEl) {
    metaEl.textContent = stats.count
      ? view.totalRows + ' sipariş · bugün'
      : 'Bugün sipariş yok';
  }

  const channelLinkEl = document.getElementById('liveOrdersChannelLink');
  if (channelLinkEl) {
    if (liveChannelFilter !== 'all') {
      const channel = (latestLivePerformance?.channels || []).find((row) => row.id === liveChannelFilter);
      const route = channel?.route || '';
      if (route) {
        channelLinkEl.innerHTML = '<a href="' + escAttr(route) + '">Detaylı sipariş listesi →</a>';
      } else {
        channelLinkEl.textContent = '';
      }
    } else {
      channelLinkEl.textContent = '';
    }
  }

  renderLiveKpiStack(stats);
  renderLiveChart(view.timeline || [], stats);

  const hideChannelColumn = liveChannelFilter !== 'all';
  const paginated = paginateLiveOrders(view.allFilteredRows || []);
  renderLiveOrdersTable(paginated.pageRows, hideChannelColumn);
  renderLiveOrdersPagination(paginated);
}

function renderLiveKpiStack(stats) {
  const el = document.getElementById('liveKpiStack');
  if (!el) return;

  if (!stats.count) {
    el.innerHTML = '<div class="live-kpi-card"><div class="live-kpi-card-body"><p class="live-kpi-card-label">Bugün sipariş yok</p><p class="live-kpi-card-value">—</p></div></div>';
    return;
  }

  const cards = [
    {
      key: 'profit',
      label: 'Kâr Tutarı',
      value: formatMoney(stats.totalProfit),
      valueClass: stats.totalProfit >= 0 ? 'pos' : 'neg',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M12 12h.01"/><path d="M17 12h.01"/><path d="M7 12h.01"/></svg>'
    },
    {
      key: 'cost',
      label: 'Kâr / Ürün Maliyet Oranı',
      value: formatPercent(stats.profitCostRatio),
      valueClass: stats.profitCostRatio >= 0 ? 'pos' : 'neg',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/></svg>'
    },
    {
      key: 'sales',
      label: 'Kâr / Satış Fiyatı Oranı',
      value: formatPercent(stats.profitSalesRatio),
      valueClass: stats.profitSalesRatio >= 0 ? 'pos' : 'neg',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82Z"/><path d="M7 7h.01"/></svg>'
    },
    {
      key: 'revenue',
      label: 'Ciro',
      value: formatMoney(stats.totalSales),
      valueClass: '',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>'
    }
  ];

  el.innerHTML = cards.map((card) =>
    '<article class="live-kpi-card live-kpi-card--' + esc(card.key) + '">' +
      '<div class="live-kpi-card-body">' +
        '<p class="live-kpi-card-label">' + esc(card.label) + '</p>' +
        '<p class="live-kpi-card-value ' + esc(card.valueClass) + '">' + esc(card.value) + '</p>' +
      '</div>' +
      '<span class="live-kpi-card-icon" aria-hidden="true">' + card.icon + '</span>' +
    '</article>'
  ).join('');
}

function renderLiveChart(timeline, stats) {
  const el = document.getElementById('liveChartWrap');
  if (!el) return;

  const hasOrders = Number(stats?.count || 0) > 0;
  const sampled = timeline.filter((_, index) => index % 3 === 0 || index === 23);
  const data = hasOrders ? sampled : [];

  if (!data.length) {
    el.innerHTML = '<p class="live-chart-empty">Bugün henüz sipariş yok — grafik sipariş geldikçe dolacak.</p>';
    return;
  }

  const width = 640;
  const height = 220;
  const padX = 40;
  const padTop = 20;
  const padBottom = 32;
  const chartHeight = height - padTop - padBottom;
  const values = data.map((point) => Number(point.netProfit || 0));
  const minVal = Math.min(0, ...values);
  const maxVal = Math.max(...values, 1);
  const range = maxVal - minVal || 1;
  const stepX = data.length > 1 ? (width - padX * 2) / (data.length - 1) : 0;
  const isNegative = Number(stats.totalProfit) < 0;

  const points = data.map((point, index) => {
    const x = padX + index * stepX;
    const y = padTop + chartHeight - ((Number(point.netProfit) - minVal) / range) * chartHeight;
    return { x, y, point };
  });

  const linePath = points.map((p, i) => (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join(' ');
  const areaPath = linePath +
    ' L' + points[points.length - 1].x.toFixed(1) + ' ' + (padTop + chartHeight).toFixed(1) +
    ' L' + points[0].x.toFixed(1) + ' ' + (padTop + chartHeight).toFixed(1) + ' Z';

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const y = padTop + chartHeight * (1 - ratio);
    const val = minVal + range * ratio;
    return '<line class="live-chart-grid" x1="' + padX + '" y1="' + y.toFixed(1) + '" x2="' + (width - padX) + '" y2="' + y.toFixed(1) + '"></line>' +
      '<text class="live-chart-axis" x="' + (padX - 6) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end">' + esc(formatCompactMoney(val)) + '</text>';
  }).join('');

  const dots = points.map((p) =>
    '<circle class="live-chart-dot' + (isNegative ? ' neg' : '') + '" cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="3.5">' +
      '<title>' + esc(p.point.label) + ' — ' + formatSigned(p.point.netProfit) + '</title>' +
    '</circle>'
  ).join('');

  const labels = points.map((p) =>
    '<text class="live-chart-axis" x="' + p.x.toFixed(1) + '" y="' + (height - 8) + '" text-anchor="middle">' + esc(p.point.label) + '</text>'
  ).join('');

  el.innerHTML =
    '<div class="live-chart">' +
      '<svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Bugünkü kâr performansı grafiği">' +
        '<defs><linearGradient id="liveProfitGradient" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="' + (isNegative ? '#fecaca' : '#bbf7d0') + '"/>' +
          '<stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>' +
        '</linearGradient></defs>' +
        gridLines +
        '<path class="live-chart-area" d="' + areaPath + '"></path>' +
        '<path class="live-chart-line' + (isNegative ? ' neg' : '') + '" d="' + linePath + '"></path>' +
        dots +
        labels +
      '</svg>' +
    '</div>';
}

function renderLiveOrdersTable(rows, hideChannelColumn) {
  const bodyEl = document.getElementById('liveOrdersBody');
  const tableEl = document.querySelector('.live-orders-table');
  const headRow = tableEl?.querySelector('thead tr');
  if (!bodyEl) return;

  if (tableEl) {
    tableEl.classList.toggle('live-orders-table--single-channel', Boolean(hideChannelColumn));
  }
  if (!rows.length) {
    const colspan = 7;
    bodyEl.innerHTML = '<tr><td colspan="' + colspan + '" class="table-empty">Seçili kanalda bugün sipariş yok.</td></tr>';
    renderLiveOrdersPagination({ totalFiltered: 0, totalPages: 1, start: 0, end: 0 });
    return;
  }

  bodyEl.innerHTML = rows.map((row) => renderLiveOrderRow(row, hideChannelColumn)).join('');
}

function renderLiveOrderRow(row, hideChannelColumn) {
  const profitClass = row.netProfit > 0 ? 'amount-pos' : row.netProfit < 0 ? 'amount-neg' : '';
  const rowClass = row.netProfit < 0 ? ' class="row-loss"' : '';
  const meta = CHANNEL_META[row.channelId] || { short: '?' };
  const detailUrl = row.orderDetailUrl || '';
  const orderCell = detailUrl
    ? '<a class="order-link" href="' + escAttr(detailUrl) + '" title="Sipariş detayı ve ürün eşleştirme">' + esc(row.orderNumber) + '</a>'
    : esc(row.orderNumber);
  const confidenceBadge = profitConfidenceBadgeHtml(row.profitConfidence);

  return '<tr' + rowClass + '>' +
    '<td>' + orderCell + '</td>' +
    '<td>' + esc(row.orderDate || formatOrderDate(row.orderDateMs)) + '</td>' +
    '<td class="live-orders-col-channel"><span class="live-channel-chip channel-chip--' + esc(meta.tone || 'default') + '">' + esc(meta.short || row.channelLabel || '—') + '</span></td>' +
    '<td>' + formatMoney(row.salesAmount) + '</td>' +
    '<td class="' + profitClass + '">' + confidenceBadge + formatSigned(row.netProfit) + '</td>' +
    '<td class="' + profitClass + '">' + formatPercent(row.profitRate) + '</td>' +
    '<td class="' + profitClass + '">' + formatPercent(row.profitMargin) + '</td>' +
  '</tr>';
}

function profitConfidenceBadgeHtml(confidence) {
  if (!confidence || confidence === 'complete') return '';
  const labels = {
    estimated: 'Tahmini',
    missing_cost: 'Maliyet eksik',
    missing_mapping: 'Eşleşme eksik',
    invalid_data: 'Geçersiz'
  };
  const label = labels[confidence] || confidence;
  const tone = confidence === 'missing_cost' || confidence === 'invalid_data' ? 'danger' : 'warn';
  return '<span class="profit-confidence-pill profit-confidence-pill--' + esc(tone) + '" title="Kâr güvenilir değil — ana KPI dışında">' + esc(label) + '</span> ';
}

function formatTodayLabel() {
  try {
    return new Date().toLocaleDateString('tr-TR', {
      timeZone: 'Europe/Istanbul',
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  } catch {
    return 'Bugün';
  }
}

function updatePeriodSummaryDesc(days) {
  const el = document.getElementById('periodSummaryDesc');
  if (!el) return;
  const label = days === '7' ? 'Son 7 gün' : days === '30' ? 'Son 30 gün' : 'Son 14 gün';
  el.textContent = label + ' — kanal bazında ciro ve net kâr';
}

function exportLiveOrdersCsv() {
  const view = getLivePerformanceView();
  if (!view?.allFilteredRows?.length) return;

  const hideChannel = liveChannelFilter !== 'all';
  const headers = hideChannel
    ? ['Siparis No', 'Tarih', 'Tutar', 'Net Kar', 'Kar Orani', 'Kar Marji']
    : ['Siparis No', 'Tarih', 'Kanal', 'Tutar', 'Net Kar', 'Kar Orani', 'Kar Marji'];

  const lines = [headers.join(';')];
  for (const row of view.allFilteredRows) {
    const cells = [
      row.orderNumber,
      row.orderDate || '',
      String(row.salesAmount ?? '').replace('.', ','),
      String(row.netProfit ?? '').replace('.', ','),
      String(row.profitRate ?? '').replace('.', ','),
      String(row.profitMargin ?? '').replace('.', ',')
    ];
    if (!hideChannel) {
      cells.splice(2, 0, row.channelLabel || row.channelId || '');
    }
    lines.push(cells.map((cell) => '"' + String(cell ?? '').replace(/"/g, '""') + '"').join(';'));
  }

  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'canli-performans-siparisler-' + new Date().toISOString().slice(0, 10) + '.csv';
  link.click();
  URL.revokeObjectURL(url);
}

function formatOrderDate(orderDateMs, fallback) {
  if (orderDateMs) {
    try {
      return new Date(orderDateMs).toLocaleString('tr-TR', {
        timeZone: 'Europe/Istanbul',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return fallback || '—';
    }
  }
  return fallback || '—';
}

function formatPercent(value) {
  const n = Number(value || 0);
  return n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
}

function formatCompactMoney(value) {
  const n = Number(value || 0);
  if (Math.abs(n) >= 1000) {
    return '₺' + (n / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 1 }) + 'k';
  }
  return '₺' + n.toLocaleString('tr-TR', { maximumFractionDigits: 0 });
}

function renderKpiGrid(stats) {
  const el = document.getElementById('kpiGrid');
  if (!el) return;

  if (!stats.count) {
    el.innerHTML = `<div class="kpi-empty-state">
      <p>Henüz sipariş özeti yok</p>
      <span class="muted">Yapılandırılmış kanallarda veri çekildikten sonra KPI kartları burada görünür.</span>
    </div>`;
    return;
  }

  const margin = stats.profitRate ?? (stats.totalSales ? Math.round((stats.totalProfit / stats.totalSales) * 10000) / 100 : 0);
  const cards = [
    {
      key: 'revenue',
      label: 'Toplam Ciro',
      value: formatMoney(stats.totalSales),
      hint: 'Seçili dönem',
      trend: 'neutral',
      icon: 'revenue'
    },
    {
      key: 'profit',
      label: 'Net Kâr',
      value: formatSigned(stats.totalProfit),
      hint: stats.totalProfit >= 0 ? 'Pozitif dönem' : 'Negatif dönem',
      trend: stats.totalProfit >= 0 ? 'up' : 'down',
      icon: 'profit',
      valueClass: stats.totalProfit >= 0 ? 'pos' : 'neg'
    },
    {
      key: 'margin',
      label: 'Kâr Marjı',
      value: margin + '%',
      hint: 'Net kâr / ciro',
      trend: margin >= 0 ? 'up' : 'down',
      icon: 'margin',
      valueClass: margin >= 0 ? 'pos' : 'neg'
    },
    {
      key: 'orders',
      label: 'Sipariş',
      value: String(stats.count),
      hint: stats.profitable + ' kârlı · ' + stats.loss + ' zarar',
      trend: 'neutral',
      icon: 'orders'
    },
    {
      key: 'loss',
      label: 'Zarar Eden Sipariş',
      value: String(stats.loss ?? 0),
      hint: 'İnceleme gerektirebilir',
      trend: stats.loss > 0 ? 'down' : 'up',
      icon: 'loss',
      valueClass: stats.loss > 0 ? 'neg' : 'pos'
    }
  ];

  el.innerHTML = cards.map(renderKpiCard).join('');
}

function renderKpiCard(card) {
  return `<article class="kpi-card kpi-card--${card.key}">
    <div class="kpi-card-top">
      <span class="kpi-icon kpi-icon--${card.icon}" aria-hidden="true">${kpiIconSvg(card.icon)}</span>
      <span class="kpi-trend kpi-trend--${card.trend}" aria-hidden="true">${trendGlyph(card.trend)}</span>
    </div>
    <p class="kpi-label">${esc(card.label)}</p>
    <p class="kpi-value ${esc(card.valueClass || '')}">${esc(card.value)}</p>
    <p class="kpi-hint">${esc(card.hint)}</p>
  </article>`;
}

function renderProfitTable(data) {
  const bodyEl = document.getElementById('profitSummaryBody');
  const costsMeta = document.getElementById('costsMeta');
  if (!bodyEl) return;

  bodyEl.innerHTML = (data.channels || []).map(renderSummaryRow).join('') ||
    '<tr><td colspan="6" class="table-empty">Kanal verisi yok.</td></tr>';

  if (costsMeta && data.costs) {
    costsMeta.innerHTML =
      'Maliyet kayıtları: Trendyol Pazaryeri <strong>' + esc(data.costs.trendyol) +
      '</strong> · Diğer kanallar <strong>' + esc(data.costs.otherChannels) +
      '</strong> · <a href="/products/costs">Kanal maliyetleri</a>';
  }

  if (data.updatedAt && costsMeta) {
    costsMeta.innerHTML += ' · Son güncelleme: <strong>' + esc(formatTime(data.updatedAt)) + '</strong>';
  }
}

function renderSummaryRow(channel) {
  const stats = channel.stats;
  const meta = CHANNEL_META[channel.id] || { slug: 'default', short: '?', tone: 'default' };
  const nameCell = channel.route
    ? '<a class="channel-link" href="' + escAttr(channel.route) + '">' + esc(channel.label) + '</a>'
    : esc(channel.label);
  const badge = channelBadge(channel);

  if (!stats) {
    return '<tr class="row-muted">' +
      '<td><div class="channel-cell">' + channelChip(meta, channel.label) + nameCell + '</div></td>' +
      '<td colspan="4" class="muted">' + esc(channel.message || 'Veri yok') + '</td>' +
      '<td>' + badge + '</td>' +
    '</tr>';
  }

  const profitClass = stats.totalProfit >= 0 ? 'pos' : 'neg';
  return '<tr>' +
    '<td><div class="channel-cell">' + channelChip(meta, channel.label) + nameCell + '</div></td>' +
    '<td><strong>' + esc(stats.count) + '</strong></td>' +
    '<td>' + formatMoney(stats.totalSales) + '</td>' +
    '<td class="' + profitClass + '">' + formatSigned(stats.totalProfit) + '</td>' +
    '<td>' + esc(stats.profitRate) + '%</td>' +
    '<td>' + badge + '</td>' +
  '</tr>';
}

function channelBadge(channel) {
  if (!channel.configured) {
    return '<span class="status-badge status-badge--warning">API Eksik</span>';
  }
  if (channel.skipped) {
    return '<span class="status-badge status-badge--info">Önbellek</span>';
  }
  if (channel.available && channel.stats) {
    return '<span class="status-badge status-badge--success">Güncel</span>';
  }
  if (channel.configured) {
    return '<span class="status-badge status-badge--ready">Hazır</span>';
  }
  return '<span class="status-badge status-badge--muted">—</span>';
}

function renderMatchingQueue(payload) {
  const el = document.getElementById('matchingQueueBody');
  const panel = document.getElementById('matchingQueuePanel');
  if (!el) return;

  const channels = payload?.channels || [];
  const hasQueue = Number(payload?.totals?.queue || 0) > 0;

  if (!channels.length) {
    if (panel) panel.hidden = true;
    el.innerHTML = '';
    return;
  }

  if (panel) panel.hidden = false;

  const summaryHtml = hasQueue
    ? `<p class="matching-queue-summary muted">${esc(String(payload.totals.queue))} bekleyen iş · ` +
      `${esc(String(payload.totals.unmapped || 0))} eşleşmemiş · ` +
      `${esc(String(payload.totals.missingMaster))} ana ürün yok · ` +
      `${esc(String(payload.totals.autoPendingConfirm))} otomatik onay · ` +
      `${esc(String(payload.totals.needsReview))} kontrol</p>`
    : '<p class="matching-queue-summary muted">Tüm aktif kanallarda eşleştirme kuyruğu temiz görünüyor.</p>';

  const rowsHtml = channels.map((row) => {
    const tone = row.queueTotal > 0 ? (row.missingMaster > 0 ? 'danger' : 'warn') : 'ok';
    const salesBadge = row.readyForSales
      ? '<span class="status-badge status-badge--success">Hazır</span>'
      : (row.blockers?.length
        ? `<span class="status-badge status-badge--warn" title="${escAttr(row.blockers[0])}">Eksik</span>`
        : '<span class="status-badge status-badge--muted">—</span>');
    const nextStep = row.nextStep?.label || row.blockers?.[0] || '';
    const nextStepHtml = nextStep
      ? `<span class="matching-queue-next muted">${esc(nextStep)}</span>`
      : '—';
    const readyPct = Number(row.readyPct) || 0;
    const readyBar = row.productCount > 0
      ? `<span class="matching-queue-ready" title="${esc(String(row.manualConfirmed))}/${esc(String(row.productCount))} onaylı">
          <span class="matching-queue-ready-bar"><span style="width:${readyPct}%"></span></span>
          <span class="matching-queue-ready-pct">${readyPct}%</span>
        </span>`
      : '—';
    return `<tr class="matching-queue-row matching-queue-row--${esc(tone)}">` +
      `<td><a href="${escAttr(row.href)}">${esc(row.label)}</a></td>` +
      `<td>${esc(String(row.productCount))}</td>` +
      `<td>${esc(String(row.manualConfirmed))}</td>` +
      `<td>${readyBar}</td>` +
      `<td>${row.queueTotal > 0 ? `<strong>${esc(String(row.queueTotal))}</strong>` : '—'}</td>` +
      `<td>${salesBadge}</td>` +
      `<td>${row.missingMaster > 0 ? esc(String(row.missingMaster)) : '—'}</td>` +
      `<td>${row.autoPendingConfirm > 0 ? esc(String(row.autoPendingConfirm)) : '—'}</td>` +
      `<td>${row.needsReview > 0 ? esc(String(row.needsReview)) : '—'}</td>` +
      `<td>${nextStepHtml}</td>` +
      `<td><a class="btn-link" href="${escAttr(row.queueTotal > 0 ? row.href : (row.hrefPool || row.href))}">${row.queueTotal > 0 ? 'Gelen kutusu →' : 'Havuz →'}</a></td>` +
    '</tr>';
  }).join('');

  el.innerHTML = summaryHtml +
    '<div class="matching-queue-table-wrap">' +
      '<table class="matching-queue-table data-table">' +
        '<thead><tr>' +
          '<th>Kanal</th><th>Ürün</th><th>Onaylı</th><th>Hazırlık</th><th>Kuyruk</th><th>Satış</th><th>Ana ürün yok</th><th>Oto. onay</th><th>Kontrol</th><th>Sonraki adım</th><th></th>' +
        '</tr></thead>' +
        `<tbody>${rowsHtml}</tbody>` +
      '</table>' +
    '</div>';
}

function renderChannelReadinessCards(payload) {
  const el = document.getElementById('channelReadinessCards');
  if (!el) return;

  const channels = (payload?.channels || []).filter((row) => Number(row.productCount) > 0);
  if (!channels.length) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }

  el.hidden = false;
  el.innerHTML = channels.map((row) => {
    const ready = Boolean(row.readyForSales);
    const pct = Number(row.readyPct) || 0;
    const tone = ready ? 'ready' : (row.missingMaster > 0 ? 'danger' : 'warn');
    const badge = ready
      ? '<span class="status-badge status-badge--success">Satışa hazır</span>'
      : `<span class="status-badge status-badge--warn">${pct}% hazır</span>`;
    const hint = ready
      ? `${row.manualConfirmed} onaylı eşleştirme`
      : (row.blockers?.[0] || 'Eşleştirme devam ediyor');
    const queueNote = row.queueTotal > 0
      ? `<span class="channel-readiness-queue">${row.queueTotal} bekleyen</span>`
      : '';
    return `<a class="channel-readiness-card channel-readiness-card--${esc(tone)}" href="${escAttr(row.href)}">` +
      `<div class="channel-readiness-head">` +
        `<strong>${esc(row.label)}</strong>` +
        `${badge}${queueNote}` +
      `</div>` +
      `<div class="channel-readiness-bar" aria-hidden="true"><span style="width:${pct}%"></span></div>` +
      `<p class="channel-readiness-hint muted">${esc(hint)}</p>` +
    `</a>`;
  }).join('');
}

function renderTodayActions(payload) {
  const panel = document.getElementById('todayActionsPanel');
  const el = document.getElementById('todayActionsBody');
  const desc = document.getElementById('todayActionsDesc');
  if (!el || !panel) return;

  const items = (payload?.items || []).slice(0, 5);
  if (!items.length) {
    panel.hidden = true;
    el.innerHTML = '';
    return;
  }

  panel.hidden = false;
  if (desc) {
    desc.textContent = items.length >= 5
      ? `İlk ${items.length} öncelikli görev — aşağıda tüm aksiyon listesi var`
      : `${items.length} öncelikli görev — tek tıkla ilgili ekrana gidin`;
  }

  el.innerHTML = items.map((item) => {
    const countHtml = Number(item.count) > 0
      ? `<span class="today-action-count">${esc(String(item.count))}</span>`
      : '';
    return `<a class="today-action-card today-action-card--${esc(item.severity || 'info')}" href="${escAttr(item.href || '#')}">
      <span class="today-action-label">${esc(item.label)}</span>
      ${countHtml}
      <span class="today-action-hint">${esc(item.hint || '')}</span>
      <span class="today-action-cta">${esc(item.action || 'Aç')} →</span>
    </a>`;
  }).join('');
}

function renderActionCenter(payload) {
  const el = document.getElementById('actionCenter');
  const panel = document.getElementById('actionCenterPanel');
  if (!el) return;

  const items = payload?.items || [];
  if (!items.length) {
    if (panel) panel.hidden = true;
    el.innerHTML = '';
    return;
  }

  if (panel) panel.hidden = false;

  el.innerHTML = items.map((item) => {
    const countHtml = Number(item.count) > 0
      ? `<span class="action-center-count">${esc(String(item.count))}</span>`
      : '';
    return `<a class="action-center-card action-center-card--${esc(item.severity || 'info')}" href="${escAttr(item.href || '#')}">
      <div class="action-center-card-top">
        <span class="action-center-label">${esc(item.label)}</span>
        ${countHtml}
      </div>
      <p class="action-center-hint">${esc(item.hint || '')}</p>
      <span class="action-center-cta">${esc(item.action || 'Aç')} →</span>
    </a>`;
  }).join('');
}

function channelNarrative(channel, summary, health) {
  const configured = Boolean(health.configured);
  const stats = summary?.stats;
  const orderCount = stats?.count ?? summary?.orderCount;

  if (channel.status === 'planned' && !configured) {
    return 'Bağlantı bekliyor — API girilince sipariş ve kârlılık takibi başlayacak';
  }
  if (!configured) {
    return 'API eksik — Ayarlar sayfasından kimlik bilgilerini tamamlayın';
  }
  if (summary?.skipped) {
    return `Önbellekten ${orderCount ?? 0} sipariş · ${formatSigned(stats?.totalProfit ?? 0)} net kâr`;
  }
  if (stats && Number(stats.count) > 0) {
    return `${stats.count} sipariş · ${formatSigned(stats.totalProfit)} net kâr · ${stats.profitRate ?? 0}% marj`;
  }
  if (channel.id === 'trendyol-marketplace') {
    return health.message || 'BuyBox, tarife ve sipariş kârlılığı aktif kanal';
  }
  return health.message || 'API bağlı · Seçili dönemde sipariş gelmedi';
}

function renderChannelCard(channel, summary) {
  const health = channel.health || {};
  const meta = CHANNEL_META[channel.id] || { slug: 'default', short: '?', tone: 'default' };
  const configured = Boolean(health.configured);
  const stats = summary?.stats;
  const orderCount = stats?.count ?? summary?.orderCount ?? '—';
  const netProfit = stats ? formatSigned(stats.totalProfit) : '—';
  const syncLabel = summary?.updatedAt
    ? formatTime(summary.updatedAt)
    : (summary?.skipped ? 'Önbellek' : '—');
  const stateClass = configured && health.ok
    ? 'channel-card--live'
    : configured
      ? 'channel-card--ready'
      : 'channel-card--missing';
  const apiBadge = configured
    ? '<span class="status-badge status-badge--success">API Bağlı</span>'
    : '<span class="status-badge status-badge--warning">API Bekleniyor</span>';
  const statusBadge = channelBadge({
    configured,
    skipped: summary?.skipped,
    available: summary?.available,
    stats
  });
  const link = channel.route || '#';
  const narrative = channelNarrative(channel, summary, health);
  const actionLabel = configured
    ? (stats && Number(stats.count) > 0 ? 'Siparişleri incele' : 'Panele git')
    : 'Bağlantıyı kur';
  const cta = configured
    ? '<a class="channel-card-cta" href="' + escAttr(link) + '">' + esc(actionLabel) + ' →</a>'
    : '<a class="channel-card-cta channel-card-cta--primary" href="/admin/settings">Bağlantıyı kur →</a>';

  return `<article class="channel-card channel-card--premium ${stateClass} channel-card--${meta.slug}">
    <div class="channel-card-header">
      ${channelChip(meta, channel.label)}
      <div class="channel-card-badges">${apiBadge}${statusBadge}</div>
    </div>
    <h3 class="channel-card-title">${esc(channel.label)}</h3>
    <p class="channel-card-desc">${esc(narrative)}</p>
    <dl class="channel-card-stats">
      <div><dt>Sipariş</dt><dd>${esc(String(orderCount))}</dd></div>
      <div><dt>Net kâr</dt><dd class="${stats && stats.totalProfit < 0 ? 'neg' : stats ? 'pos' : ''}">${esc(String(netProfit))}</dd></div>
      <div><dt>Son sync</dt><dd>${esc(String(syncLabel))}</dd></div>
    </dl>
    ${cta}
  </article>`;
}

function channelChip(meta, label) {
  return '<span class="channel-chip channel-chip--' + esc(meta.tone) + '" title="' + escAttr(label) + '">' + esc(meta.short) + '</span>';
}

function renderSystemStatus(ops) {
  const db = ops.db || {};
  const dbSource = db.lastReadSource || '—';
  const dbFallback = db.fallbackActive;
  const parityOk = db.parityOk;
  const workerOn = Boolean(ops.worker?.running);
  const cacheCount = ops.cache?.itemCount ?? '—';
  const cacheAge = ops.cache?.ageSeconds ?? '—';
  const uptime = formatUptime(ops.uptimeSeconds);
  const memory = ops.memory?.heapUsedMb ?? '—';
  const ms = ops.matchingSync || {};

  let dbValue = dbSource;
  let dbHint = db.readBackend === 'json'
    ? 'Okuma kaynağı JSON (tek kaynak)'
    : 'SQLite dual-write';
  let dbBadge = 'success';

  if (db.readBackend === 'json' && !dbFallback) {
    dbValue = 'JSON';
    dbBadge = 'info';
  }

  if (dbFallback) {
    dbBadge = 'warning';
    if (db.lastReadError === 'parity_mismatch') {
      const snap = db.parityCounts?.snapshots || db.parityMismatches?.find((m) => m.table === 'buybox_snapshots');
      const detail = snap
        ? `JSON ${snap.json ?? '?'} / SQLite ${snap.sqlite ?? '?'} snapshot`
        : 'Kayıt sayıları uyuşmuyor';
      dbValue = 'JSON fallback (parity)';
      dbHint = `SQLite ve JSON farklı — ${detail}. Veri JSON'dan okunuyor.`;
    } else {
      dbValue = dbSource + ' (fallback)';
      dbHint = db.lastReadError || 'SQLite okunamadı, JSON kullanılıyor';
    }
  } else if (parityOk === true) {
    dbHint = 'SQLite ve JSON uyumlu';
  }

  let matchingValue = 'Kapalı';
  let matchingHint = 'Ürün Havuzu otomatik sync devre dışı';
  let matchingBadge = 'warning';
  if (ms.enabled) {
    matchingBadge = ms.running ? 'info' : (ms.lastRunOk === false ? 'warning' : 'success');
    matchingValue = ms.running ? 'Çalışıyor' : (ms.scheduled ? 'Zamanlandı' : 'Aktif');
    const interval = ms.intervalMinutes ? `${ms.intervalMinutes} dk` : '—';
    matchingHint = ms.lastRunAt
      ? `Son: ${formatTime(ms.lastRunAt)} · ${interval}`
      : `Aralık: ${interval}`;
    if (ms.lastRunOk === false && ms.lastError) {
      matchingHint += ` · Hata: ${ms.lastError}`;
      matchingBadge = 'warning';
    }
  }

  const items = [
    { icon: 'db', label: 'DB kaynağı', value: dbValue, badge: dbBadge, hint: dbHint },
    { icon: 'worker', label: 'Worker', value: workerOn ? 'Çalışıyor' : 'Kapalı', badge: workerOn ? 'success' : 'warning', hint: workerOn ? 'Canlı BuyBox senkron aktif' : 'BuyBox fiyatları güncellenmeyebilir' },
    { icon: 'cache', label: 'Cache', value: cacheCount + ' ürün', badge: 'info', hint: cacheAge + ' sn önce' },
    { icon: 'matching', label: 'Eşleştirme sync', value: matchingValue, badge: matchingBadge, hint: matchingHint },
    { icon: 'uptime', label: 'Uptime', value: uptime, badge: 'info', hint: 'Sunucu çalışma süresi' },
    { icon: 'memory', label: 'Bellek', value: memory + ' MB', badge: 'info', hint: 'Heap kullanımı' }
  ];

  return items.map((item) => `<div class="system-status-item">
    <div class="system-status-icon system-status-icon--${item.icon}" aria-hidden="true">${systemIconSvg(item.icon)}</div>
    <div class="system-status-body">
      <div class="system-status-row">
        <span class="system-status-label">${esc(item.label)}</span>
        <span class="status-badge status-badge--${item.badge}">${esc(item.badge === 'success' ? 'Aktif' : item.badge === 'warning' ? 'Uyarı' : 'OK')}</span>
      </div>
      <strong class="system-status-value">${esc(String(item.value))}</strong>
      <span class="system-status-hint">${esc(item.hint)}</span>
    </div>
  </div>`).join('');
}

function kpiIconSvg(type) {
  const icons = {
    revenue: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
    profit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m3 17 6-6 4 4 8-8"/><path d="M14 7h7v7"/></svg>',
    margin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-9-9"/><path d="M12 3v9l4 2"/></svg>',
    orders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>',
    loss: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>'
  };
  return icons[type] || icons.orders;
}

function systemIconSvg(type) {
  const icons = {
    db: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"/></svg>',
    worker: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4"/><path d="m4.93 4.93 2.83 2.83"/><path d="M2 12h4"/><path d="m4.93 19.07 2.83-2.83"/><path d="M12 18v4"/><path d="m19.07 19.07-2.83-2.83"/><path d="M22 12h-4"/><path d="m19.07 4.93-2.83 2.83"/></svg>',
    cache: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/></svg>',
    matching: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 3h5v5"/><path d="M8 3H3v5"/><path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3"/><path d="m15 9 6-6"/></svg>',
    uptime: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
    memory: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 9h6v6H9z"/><path d="M9 1v3"/><path d="M15 1v3"/><path d="M9 20v3"/><path d="M15 20v3"/><path d="M20 9h3"/><path d="M20 14h3"/><path d="M1 9h3"/><path d="M1 14h3"/></svg>'
  };
  return icons[type] || icons.db;
}

function trendGlyph(trend) {
  if (trend === 'up') return '▲';
  if (trend === 'down') return '▼';
  return '●';
}

function formatMoney(value) {
  return '₺' + Number(value || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatSigned(value) {
  const n = Number(value || 0);
  const prefix = n > 0 ? '+' : '';
  return prefix + formatMoney(n);
}

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso || '—';
  }
}

function formatUptime(seconds) {
  const s = Number(seconds || 0);
  if (!s) return '—';
  if (s < 3600) return Math.floor(s / 60) + ' dk';
  if (s < 86400) return Math.floor(s / 3600) + ' sa ' + Math.floor((s % 3600) / 60) + ' dk';
  return Math.floor(s / 86400) + ' gün';
}

function renderExecutiveSummary(totals, queue) {
  const ordersEl = document.getElementById('execStatOrders');
  const revenueEl = document.getElementById('execStatRevenue');
  const profitEl = document.getElementById('execStatProfit');
  const lossEl = document.getElementById('execStatLoss');
  const unmatchedEl = document.getElementById('execStatUnmatched');
  const unmatchedLink = document.getElementById('execStatUnmatchedLink');
  const pendingEl = document.getElementById('execStatPendingSale');

  if (!ordersEl) return;

  ordersEl.textContent = totals.count != null ? String(totals.count) : '—';
  revenueEl.textContent = totals.totalSales != null ? formatMoney(totals.totalSales) : '—';
  profitEl.textContent = totals.totalProfit != null ? formatSigned(totals.totalProfit) : '—';
  profitEl.classList.toggle('neg', Number(totals.totalProfit || 0) < 0);
  lossEl.textContent = totals.loss != null ? String(totals.loss) : '—';
  const queueTotal = queue?.totals?.queue;
  unmatchedEl.textContent = queueTotal != null ? String(queueTotal) : '—';
  if (unmatchedLink && queue?.totals) {
    const parts = [
      `${queue.totals.unmapped || 0} eşleşmemiş`,
      `${queue.totals.missingMaster || 0} BenimPOS'ta yok`,
      `${queue.totals.autoPendingConfirm || 0} otomatik onay`,
      `${queue.totals.needsReview || 0} kontrol`
    ];
    unmatchedLink.title = `Gelen Kutusu ile aynı sayaç · ${parts.join(' · ')}`;
  }
  const pending = (queue?.totals?.autoPendingConfirm || 0) + (queue?.totals?.needsReview || 0);
  pendingEl.textContent = queue ? String(pending) : '—';
}

function renderDataIntegrity(report) {
  const el = document.getElementById('dataIntegrityBody');
  if (!el || !report) return;

  const summary = report.summary || {};
  const findings = report.findings || [];

  if (!findings.length) {
    el.innerHTML =
      '<div class="data-integrity-ok">' +
        '<strong>Temiz görünüyor</strong>' +
        `<p class="muted">${summary.masterProducts || 0} ana ürün · ${summary.channelProducts || 0} kanal ürünü · ${summary.mappings || 0} eşleştirme — tekrar veya yetim kayıt bulunmadı.</p>` +
      '</div>';
    return;
  }

  const cards = findings.map((finding) => {
    const severityClass = finding.severity === 'danger'
      ? 'data-integrity-card--danger'
      : (finding.severity === 'warning' ? 'data-integrity-card--warn' : 'data-integrity-card--info');
    const sampleText = (finding.samples || []).slice(0, 2).map((sample) => {
      if (sample.barcode) return esc(sample.barcode);
      if (sample.key) return esc(sample.key);
      if (sample.label) return esc(sample.label);
      return esc(JSON.stringify(sample).slice(0, 80));
    }).join(', ');

    return `<article class="data-integrity-card ${severityClass}">
      <div class="data-integrity-card-head">
        <strong>${esc(finding.label)}</strong>
        <span class="data-integrity-count">${finding.count}</span>
      </div>
      <p class="muted">${esc(finding.hint || '')}</p>
      ${sampleText ? `<p class="data-integrity-samples">Örnek: ${sampleText}</p>` : ''}
    </article>`;
  }).join('');

  el.innerHTML =
    `<div class="data-integrity-summary muted">${summary.findingCount} bulgu · ${summary.conflicts || 0} çakışma kaydı · salt okunur tarama</div>` +
    `<div class="data-integrity-grid">${cards}</div>` +
    `<p class="data-integrity-note muted">${esc((report.safeActions || [])[0] || '')}</p>`;
}

function escAttr(value) {
  return String(value ?? '').replace(/"/g, '&quot;');
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
}

loadDashboard();
