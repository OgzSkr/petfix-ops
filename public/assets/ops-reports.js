'use strict';

const bootstrap = window.__OPS_REPORTS__ || { authRequired: true };
let activeDays = 7;
let activePeriod = null;
let activeChannel = 'all';

const CHANNEL_COLORS = {
  getir: '#5d3ebc',
  yemeksepeti: '#fa0050',
  trendyol_go: '#f27a1a'
};

function getOps() {
  return window.OpsCommon || null;
}

function getEl(id) {
  return document.getElementById(id);
}

function esc(value) {
  return getOps()?.escapeHtml?.(value) ?? String(value ?? '');
}

function channelLogoId(channel) {
  if (channel === 'trendyol_go') return 'uber-eats';
  return channel;
}

function formatMoney(value) {
  const num = Number(value) || 0;
  return num.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₺';
}

function formatPercent(value) {
  const num = Number(value) || 0;
  return `${num.toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function formatChange(pct) {
  const num = Number(pct) || 0;
  if (!num) return { text: 'Değişim yok', cls: 'is-flat', title: 'Önceki döneme göre değişim yok' };
  const sign = num > 0 ? '▲' : '▼';
  const abs = Math.abs(num).toLocaleString('tr-TR', { maximumFractionDigits: 1 });
  return {
    text: `${sign} ${abs}%`,
    cls: num > 0 ? 'is-up' : 'is-down',
    title: `${sign} ${abs}% önceki döneme göre`
  };
}

function formatDayLabel(day) {
  if (!day) return '—';
  const d = new Date(day);
  if (Number.isNaN(d.getTime())) return String(day);
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' });
}

function formatHourLabel(hour) {
  const num = Number(hour);
  if (!Number.isFinite(num)) return '—';
  return `${String(num).padStart(2, '0')}:00`;
}

function renderEmptyState(message) {
  return `<div class="ops-empty-state ops-empty-state--compact"><span class="ops-empty-state-icon" aria-hidden="true">▢</span><span>${esc(message)}</span></div>`;
}

function renderChange(el, pct) {
  if (!el) return;
  const change = formatChange(pct);
  el.textContent = change.text;
  el.className = `ops-stat-card-delta ${change.cls}`;
  if (change.title) el.title = change.title;
}

function renderProfitFootnote(kpis = {}) {
  const footnote = getEl('reportsProfitFootnote');
  const card = getEl('kpiNetProfitCard');
  if (!footnote) return;

  const text = kpis.profitFootnote
    || (kpis.profitOrdersAnalyzed
      ? `${kpis.profitOrdersAnalyzed} sipariş analiz edildi · net kâr yalnızca güvenilir siparişlerden`
      : '');

  footnote.textContent = text;
  footnote.hidden = !text;

  if (card) {
    const warn = Number(kpis.profitOrdersInKpi) === 0 && Number(kpis.profitOrdersAnalyzed) > 0;
    card.classList.toggle('ops-stat-card--profit-warn', warn);
  }
}

function renderKpis(kpis = {}) {
  const kpiRevenue = getEl('kpiRevenue');
  const kpiNetProfit = getEl('kpiNetProfit');
  const kpiProfitRate = getEl('kpiProfitRate');
  const kpiProductCost = getEl('kpiProductCost');
  const kpiOrders = getEl('kpiOrders');
  const kpiBasket = getEl('kpiBasket');
  const kpiCancelled = getEl('kpiCancelled');
  const kpiPicking = getEl('kpiPicking');
  const kpiUnmapped = getEl('kpiUnmapped');

  if (kpiRevenue) kpiRevenue.textContent = formatMoney(kpis.revenue);
  if (kpiNetProfit) kpiNetProfit.textContent = formatMoney(kpis.netProfit);
  if (kpiProfitRate) kpiProfitRate.textContent = formatPercent(kpis.profitRate);
  if (kpiProductCost) kpiProductCost.textContent = formatMoney(kpis.productCost);
  if (kpiOrders) kpiOrders.textContent = String(kpis.orderCount ?? '—');
  if (kpiBasket) kpiBasket.textContent = formatMoney(kpis.avgBasket);
  if (kpiCancelled) kpiCancelled.textContent = String(kpis.cancelledCount ?? '—');
  if (kpiPicking) {
    kpiPicking.textContent = kpis.avgPickingMinutes == null ? '—' : `${kpis.avgPickingMinutes} dk`;
  }
  if (kpiUnmapped) {
    kpiUnmapped.textContent = kpis.unmappedLineRate == null ? '—' : `${kpis.unmappedLineRate}%`;
  }

  renderChange(getEl('kpiRevenueChange'), kpis.revenueChangePct);
  renderChange(getEl('kpiNetProfitChange'), kpis.netProfitChangePct);
  renderChange(getEl('kpiOrdersChange'), kpis.orderCountChangePct);
  renderChange(getEl('kpiBasketChange'), kpis.avgBasketChangePct);
  renderChange(getEl('kpiCancelledChange'), kpis.cancelledChangePct);
  renderProfitFootnote(kpis);
}

function renderBarChart(container, items, {
  valueKey = 'revenue',
  labelKey = 'day',
  formatLabel = formatDayLabel,
  barClass = ''
} = {}) {
  if (!container) return;
  if (!items?.length) {
    container.innerHTML = renderEmptyState('Bu dönemde veri yok.');
    return;
  }
  const max = Math.max(...items.map((row) => Number(row[valueKey]) || 0), 1);
  container.innerHTML = `<div class="ops-bar-chart-inner">${items.map((row) => {
    const value = Number(row[valueKey]) || 0;
    const height = Math.max(6, Math.round((value / max) * 100));
    const label = formatLabel(row[labelKey], row);
    const title = valueKey === 'revenue' ? formatMoney(value) : `${value} sipariş`;
    return `<div class="ops-bar-chart-col" title="${esc(title)}">
      <span class="ops-bar-chart-tip">${esc(title)}</span>
      <div class="ops-bar-chart-bar ${barClass}" style="height:${height}%"></div>
      <span class="ops-bar-chart-label">${esc(label)}</span>
    </div>`;
  }).join('')}</div>`;
}

function renderChannelBreakdown(items = []) {
  const container = getEl('channelBreakdown');
  const logos = window.PetFixChannelLogos || window.ChannelLogos;
  if (!container) return;
  if (!items.length) {
    container.innerHTML = renderEmptyState('Kanal verisi yok.');
    return;
  }
  const total = items.reduce((sum, row) => sum + (Number(row.revenue) || 0), 0) || 1;
  container.innerHTML = items.map((row) => {
    const pct = Math.round(((Number(row.revenue) || 0) / total) * 1000) / 10;
    const logoId = channelLogoId(row.channel);
    const logo = logos?.render ? logos.render(logoId, { size: 'md' }) : '';
    const color = CHANNEL_COLORS[row.channel] || '#64748b';
    return `<div class="ops-channel-breakdown-row">
      <div class="ops-channel-breakdown-head">
        ${logo}
        <div class="ops-channel-breakdown-title">
          <strong>${esc(row.channelLabel || row.channel)}</strong>
          <span>${row.orders} sipariş</span>
        </div>
        <div class="ops-channel-breakdown-pct">${pct}%</div>
      </div>
      <div class="ops-channel-breakdown-track">
        <div class="ops-channel-breakdown-bar" style="width:${pct}%;background:${color}"></div>
      </div>
      <div class="ops-channel-breakdown-meta">${formatMoney(row.revenue)}</div>
    </div>`;
  }).join('');
}

function renderHourlyChart(items = []) {
  renderBarChart(getEl('hourlyChart'), items, {
    valueKey: 'orders',
    labelKey: 'hour',
    barClass: 'ops-bar-chart-bar--slim',
    formatLabel: (hour) => (Number(hour) % 2 === 0 ? `${String(hour).padStart(2, '0')}` : '')
  });
}

const DOW_LABELS = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];

function renderHeatmap(cells = []) {
  const container = getEl('heatmapGrid');
  if (!container) return;
  const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  let max = 1;
  for (const cell of cells) {
    const dow = Number(cell.dow);
    const hour = Number(cell.hour);
    const orders = Number(cell.orders) || 0;
    if (dow >= 0 && dow < 7 && hour >= 0 && hour < 24) {
      grid[dow][hour] = orders;
      if (orders > max) max = orders;
    }
  }
  const hoursHeader = Array.from({ length: 24 }, (_, hour) =>
    hour % 3 === 0 ? `<span>${String(hour).padStart(2, '0')}</span>` : '<span></span>'
  ).join('');
  const rows = grid.map((hours, dow) => {
    const cellsHtml = hours.map((orders) => {
      const intensity = orders ? Math.max(0.18, orders / max) : 0.06;
      return `<span class="ops-heatmap-cell" style="--heat:${intensity}" title="${orders} sipariş"></span>`;
    }).join('');
    return `<div class="ops-heatmap-row"><span class="ops-heatmap-dow">${DOW_LABELS[dow]}</span>${cellsHtml}</div>`;
  }).join('');
  container.innerHTML = `<div class="ops-heatmap-wrap"><div class="ops-heatmap-hours">${hoursHeader}</div>${rows}</div>`;
}

function renderRankList(containerId, items = [], emptyText = 'Veri yok.', maxItems = 5) {
  const container = getEl(containerId);
  if (!container) return;
  const slice = (items || []).slice(0, maxItems);
  if (!slice.length) {
    container.innerHTML = renderEmptyState(emptyText);
    return;
  }
  container.innerHTML = `<ol class="ops-rank-ol ops-rank-ol--compact">${slice.map((row, index) => {
    const title = row.title || row.barcode || '—';
    const meta = row.quantity != null
      ? `${row.quantity} adet · ${formatMoney(row.revenue || 0)}`
      : (row.barcode || '');
    return `<li>
      <span class="ops-rank-index">${index + 1}</span>
      <div class="ops-rank-content">
        <span class="ops-rank-title" title="${esc(title)}">${esc(title)}</span>
        <span class="ops-rank-meta">${esc(meta)}</span>
      </div>
    </li>`;
  }).join('')}</ol>`;
}

function buildReportsQuery() {
  const params = new URLSearchParams();
  if (activePeriod === 'today') {
    params.set('period', 'today');
    params.set('days', '0');
  } else {
    params.set('days', String(activeDays));
  }
  if (activeChannel && activeChannel !== 'all') {
    params.set('channel', activeChannel);
  }
  return params.toString();
}

async function loadReports() {
  const authFetch = window.BuyBoxCommon?.authFetch?.bind(window.BuyBoxCommon);
  const note = getEl('reportsNote');
  if (!authFetch) return;
  document.querySelectorAll('#reportsKpiRow .ops-stat-card').forEach((card) => card.classList.add('is-loading'));
  try {
    const response = await authFetch(`/api/ops/reports?${buildReportsQuery()}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Rapor yüklenemedi');
    renderKpis(data.kpis || {});

    const salesTitle = getEl('salesChartTitle');
    const isHourly = data.salesSeriesMode === 'hourly';
    if (salesTitle) salesTitle.textContent = isHourly ? 'Saatlik satış (bugün)' : 'Günlük satış';

    if (isHourly) {
      renderBarChart(getEl('salesChart'), data.salesSeries || [], {
        valueKey: 'revenue',
        labelKey: 'hour',
        formatLabel: formatHourLabel,
        barClass: 'ops-bar-chart-bar--slim'
      });
    } else {
      renderBarChart(getEl('salesChart'), data.salesSeries || []);
    }

    renderChannelBreakdown(data.channelBreakdown || []);
    renderHourlyChart(data.hourlyDensity || []);
    renderHeatmap(data.heatmap || []);
    renderRankList('topProducts', data.topProducts || []);
    renderRankList('leastProducts', data.leastProducts || []);
    renderRankList('neverSold', data.neverSold || [], 'Tüm eşleşmiş ürünler en az bir kez satılmış görünüyor.', 8);
    if (note) note.textContent = data.note || '';
  } catch (err) {
    if (note) note.textContent = err.message || 'Rapor yüklenemedi';
  } finally {
    document.querySelectorAll('#reportsKpiRow .ops-stat-card').forEach((card) => card.classList.remove('is-loading'));
  }
}

function bindPeriodButtons() {
  document.querySelectorAll('.ops-reports-period [data-days], .ops-reports-period [data-period]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.period === 'today') {
        activePeriod = 'today';
        activeDays = 0;
      } else {
        activePeriod = null;
        activeDays = Number(btn.dataset.days) || 7;
      }
      document.querySelectorAll('.ops-reports-period [data-days], .ops-reports-period [data-period]').forEach((el) => {
        const isToday = el.dataset.period === 'today';
        const isActive = isToday
          ? activePeriod === 'today'
          : activePeriod !== 'today' && Number(el.dataset.days) === activeDays;
        el.classList.toggle('is-active', isActive);
      });
      loadReports();
    });
  });
}

function bindChannelTabs() {
  const root = getEl('reportsChannelFilters');
  if (!root) return;
  root.querySelectorAll('[data-channel]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeChannel = btn.dataset.channel || 'all';
      root.querySelectorAll('[data-channel]').forEach((el) => {
        const selected = el === btn;
        el.classList.toggle('active', selected);
        el.setAttribute('aria-selected', selected ? 'true' : 'false');
      });
      loadReports();
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  bindPeriodButtons();
  bindChannelTabs();
  loadReports();
  document.getElementById('pfRefreshBtn')?.addEventListener('click', loadReports);
});
