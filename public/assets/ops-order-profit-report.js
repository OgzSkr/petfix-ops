(function () {
  const bootstrap = window.__OPS_ORDER_PROFIT__ || { authRequired: true };
  const ORDER_TIMEZONE = 'Europe/Istanbul';

  let activeChannel = 'all';
  let activeDays = '7';
  let activePeriod = null;
  let activeRange = '';
  let activeStartDate = '';
  let activeEndDate = '';
  let activeStatus = '';
  let activePage = 1;
  let pageLimit = 10;

  const MAX_REPORT_DAYS = 30;

  function daysBetween(start, end) {
    const a = new Date(start);
    const b = new Date(end || start);
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
    return Math.ceil(Math.abs(b - a) / (24 * 60 * 60 * 1000)) + 1;
  }

  function validateCustomRange() {
    if (activeDays !== 'custom') return '';
    if (!activeStartDate) return 'Başlangıç tarihi seçin.';
    if (daysBetween(activeStartDate, activeEndDate || activeStartDate) > MAX_REPORT_DAYS) {
      return `Tarih aralığı en fazla ${MAX_REPORT_DAYS} gün olabilir.`;
    }
    return '';
  }

  const getEl = (id) => document.getElementById(id);

  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatMoney(value) {
    const num = Number(value) || 0;
    return num.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatSignedMoney(value) {
    const num = Number(value) || 0;
    const prefix = num > 0 ? '+' : '';
    return prefix + '₺' + formatMoney(num);
  }

  function formatPercent(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return '—';
    return num.toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
  }

  function formatOrderDate(timestamp) {
    const ms = Number(timestamp) || 0;
    if (!ms) return '—';
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

  function channelLogos() {
    return window.PetFixChannelLogos || window.BuyBoxChannelLogos || null;
  }

  function renderChannelLogo(channelId) {
    const logos = channelLogos();
    if (channelId && logos?.render) {
      return logos.render(channelId, { size: 'sm' });
    }
    return '<span class="pf-channel-logo pf-channel-logo--sm">?</span>';
  }

  function syncCustomDateFields() {
    const daysEl = getEl('orderProfitDays');
    const custom = daysEl?.value === 'custom';
    const startEl = getEl('orderProfitStart');
    const endEl = getEl('orderProfitEnd');
    if (startEl) startEl.disabled = !custom;
    if (endEl) endEl.disabled = !custom;
  }

  function readFiltersFromForm() {
    const daysEl = getEl('orderProfitDays');
    const daysValue = daysEl?.value || '7';
    activeStartDate = getEl('orderProfitStart')?.value || '';
    activeEndDate = getEl('orderProfitEnd')?.value || '';
    activeStatus = getEl('orderProfitStatus')?.value || '';

    if (daysValue === 'custom') {
      activeRange = '';
      activePeriod = null;
      activeDays = 'custom';
      return;
    }
    activeRange = '';
    if (daysValue === '0') {
      activePeriod = 'today';
      activeDays = '0';
      return;
    }
    activePeriod = null;
    activeDays = daysValue;
  }

  function buildQuery() {
    const params = new URLSearchParams();
    if (activeDays === 'custom' && activeStartDate) {
      params.set('startDate', activeStartDate);
      if (activeEndDate) params.set('endDate', activeEndDate);
    } else if (activePeriod === 'today' || activeDays === '0') {
      params.set('period', 'today');
      params.set('days', '0');
    } else {
      params.set('days', String(activeDays || 7));
    }
    if (activeChannel && activeChannel !== 'all') {
      params.set('channel', activeChannel);
    }
    if (activeStatus) {
      params.set('status', activeStatus);
    }
    params.set('page', String(activePage));
    params.set('limit', String(pageLimit));
    return params.toString();
  }

  function renderOrderCell(row) {
    const channelId = row.channel || '';
    const logo = renderChannelLogo(channelId);
    const orderNumber = esc(row.orderNumber || '—');
    return `<div class="ops-order-profit-id-cell">
      <span class="ops-order-profit-channel" aria-hidden="true">${logo}</span>
      <a href="#" class="orders-id-link" data-order="${esc(row.orderNumber || '')}" data-channel="${esc(channelId)}">${orderNumber}</a>
    </div>`;
  }

  function translateStatus(status) {
    const key = String(status || '').trim();
    const labels = {
      completed: 'Tamamlandı',
      pending: 'Beklemede',
      preparing: 'Hazırlanıyor',
      picked: 'Hazır',
      delivered: 'Teslim edildi',
      cancelled: 'İptal',
      failed: 'Başarısız'
    };
    return labels[key] || key || '—';
  }

  function populateStatusOptions(statuses = [], selected = '') {
    const select = getEl('orderProfitStatus');
    if (!select) return;
    const current = selected || select.value || '';
    const options = ['<option value="">Tüm durumlar</option>'];
    statuses.forEach((status) => {
      const value = esc(status);
      const sel = status === current ? ' selected' : '';
      options.push(`<option value="${value}"${sel}>${esc(translateStatus(status))}</option>`);
    });
    select.innerHTML = options.join('');
  }

  function renderTable(report = {}) {
    const body = getEl('orderProfitBody');
    const note = getEl('orderProfitNote');
    const rows = report.rows || [];
    const summary = report.summary || {};

    populateStatusOptions(report.statuses || [], activeStatus);

    const periodBadge = getEl('orderProfitPeriodBadge');
    if (periodBadge) {
      periodBadge.textContent = report.periodLabel || '—';
    }

    if (note) {
      const parts = [];
      if (summary.included != null) parts.push(`${summary.included} sipariş listelendi`);
      if (summary.unreliable > 0) parts.push(`${summary.unreliable} güvenilir olmayan kâr verisi`);
      note.textContent = parts.length
        ? parts.join(' · ')
        : (summary.activeExcludedNote || '');
    }

    const totalEl = getEl('orderProfitTotal');
    if (totalEl) totalEl.textContent = report.total != null ? String(report.total) : '—';

    const pageInfo = getEl('orderProfitPageInfo');
    if (pageInfo) {
      pageInfo.textContent = rows.length
        ? `Bu sayfada ${rows.length}`
        : 'Bu sayfada 0';
    }

    if (!body) return;
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="9" class="muted">Seçili filtrelerde sipariş bulunamadı.</td></tr>';
      renderPagination(report);
      return;
    }

    body.innerHTML = rows.map((row) => {
      const profitClass = Number(row.netProfit) < 0 ? 'is-loss' : 'is-profit';
      return `<tr>
        <td>${renderOrderCell(row)}</td>
        <td>${esc(formatOrderDate(row.orderDateMs) || row.orderDate || '—')}</td>
        <td><span class="orders-status-pill">${esc(translateStatus(row.status))}</span></td>
        <td class="ops-money">₺${formatMoney(row.salesAmount)}</td>
        <td class="ops-money">₺${formatMoney(row.productCost)}</td>
        <td class="ops-money">₺${formatMoney(row.commissionAmount)}</td>
        <td class="ops-money ${profitClass}">${formatSignedMoney(row.netProfit)}</td>
        <td>${formatPercent(row.profitMargin)}</td>
        <td><span class="ops-profit-badge">${esc(row.profitConfidenceLabel || '—')}</span></td>
      </tr>`;
    }).join('');

    body.querySelectorAll('.orders-id-link').forEach((link) => {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        openDetail(link.dataset.order, link.dataset.channel);
      });
    });

    renderPagination(report);
  }

  function renderPagination(report = {}) {
    const footer = getEl('orderProfitFooter');
    if (!footer) return;

    const total = Number(report.total) || 0;
    const totalPages = Number(report.totalPages) || 1;
    const page = Number(report.page) || 1;

    if (!total) {
      footer.hidden = true;
      footer.innerHTML = '';
      return;
    }

    const sizeOptions = [1, 10, 25, 100].map((size) =>
      `<option value="${size}"${size === pageLimit ? ' selected' : ''}>${size}</option>`
    ).join('');

    footer.hidden = false;
    footer.innerHTML = `
      <label class="orders-page-size">Sayfa başına
        <select id="orderProfitPageSize">${sizeOptions}</select>
      </label>
      <div class="orders-page-nav">
        <button type="button" class="btn-detail" id="orderProfitPrev"${page <= 1 ? ' disabled' : ''}>‹ Önceki</button>
        <span class="orders-page-info">${page} / ${totalPages}</span>
        <button type="button" class="btn-detail" id="orderProfitNext"${page >= totalPages ? ' disabled' : ''}>Sonraki ›</button>
      </div>
      <span class="ops-order-profit-total muted">${total.toLocaleString('tr-TR')} sipariş</span>`;

    getEl('orderProfitPageSize')?.addEventListener('change', (event) => {
      pageLimit = Math.max(1, Number(event.target.value) || 10);
      activePage = 1;
      loadReport();
    });
    getEl('orderProfitPrev')?.addEventListener('click', () => {
      if (activePage > 1) {
        activePage -= 1;
        loadReport();
      }
    });
    getEl('orderProfitNext')?.addEventListener('click', () => {
      if (activePage < totalPages) {
        activePage += 1;
        loadReport();
      }
    });
  }

  function detailItem(label, value) {
    return `<div><span>${esc(label)}</span><strong>${value}</strong></div>`;
  }

  function renderLineItems(lines) {
    if (!lines?.length) {
      return '<p class="muted">Ürün satırı yok.</p>';
    }
    const rows = lines.map((line) => `<tr>
      <td>${esc(line.title || line.barcode || '—')}</td>
      <td>${esc(line.barcode || '—')}</td>
      <td class="ops-money">${Number(line.quantity) || 0}</td>
      <td class="ops-money">₺${formatMoney(line.unitPrice)}</td>
      <td class="ops-money">₺${formatMoney(line.lineTotal)}</td>
    </tr>`).join('');
    return `<table class="ops-detail-lines-table">
      <thead><tr><th>Ürün</th><th>Barkod</th><th>Adet</th><th>Birim</th><th>Toplam</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  function closeModal() {
    const modal = getEl('orderProfitModalBackdrop');
    if (!modal) return;
    modal.classList.remove('open');
    modal.hidden = true;
  }

  function showModal() {
    const modal = getEl('orderProfitModalBackdrop');
    if (!modal) return;
    modal.hidden = false;
    modal.classList.add('open');
  }

  function openDetailModal(row) {
    const modal = getEl('orderProfitModalBackdrop');
    const title = getEl('orderProfitModalTitle');
    const body = getEl('orderProfitModalBody');
    if (!modal || !title || !body) return;

    title.textContent = 'Sipariş #' + (row.orderNumber || '—');
    const warnings = [...new Set([...(row.dataWarnings || []), ...(row.matchingWarnings || [])])];
    const channelBlock = renderChannelLogo(row.channel) + ' ' + esc(row.channelLabel || row.channel || '—');

    body.innerHTML =
      (warnings.length ? `<p class="orders-warn-box">${esc(warnings.join(' · '))}</p>` : '') +
      '<div class="detail-grid">' +
        detailItem('Kanal', channelBlock) +
        (row.customerName ? detailItem('Müşteri', esc(row.customerName)) : '') +
        (row.deliveryMethod ? detailItem('Teslimat', esc(row.deliveryMethod)) : '') +
        detailItem('Sipariş tarihi', esc(formatOrderDate(row.orderDateMs) || row.orderDate || '—')) +
        detailItem('Durum', esc(row.status || '—')) +
        detailItem('Kâr güveni', esc(row.profitConfidenceLabel || row.profitConfidence || '—')) +
        detailItem('Tutar', '₺' + formatMoney(row.salesAmount)) +
        detailItem('Ürün maliyeti', '₺' + formatMoney(row.productCost)) +
        detailItem('Ek maliyet', '₺' + formatMoney(row.extraCost)) +
        detailItem('Komisyon', '₺' + formatMoney(row.commissionAmount)) +
        detailItem('Kurye ücreti', '₺' + formatMoney(row.shippingCost)) +
        detailItem('Hizmet bedeli', '₺' + formatMoney(row.serviceFee)) +
        detailItem('Stopaj', '₺' + formatMoney(row.stopajAmount)) +
        detailItem('Net kâr', formatSignedMoney(row.netProfit)) +
        detailItem('Kâr oranı', formatPercent(row.profitRate)) +
        detailItem('Kâr marjı', formatPercent(row.profitMargin)) +
      '</div>' +
      '<h4 class="ops-detail-lines-heading">Ürünler</h4>' +
      renderLineItems(row.lines);

    showModal();
  }

  async function openDetail(orderNumber, channel) {
    const authFetch = window.BuyBoxCommon?.authFetch?.bind(window.BuyBoxCommon);
    if (!authFetch || !orderNumber) return;

    const params = new URLSearchParams(buildQuery());
    params.set('orderNumber', orderNumber);
    if (channel) params.set('channel', channel);

    const body = getEl('orderProfitModalBody');
    if (body) {
      getEl('orderProfitModalTitle').textContent = 'Sipariş #' + orderNumber;
      body.innerHTML = '<p class="muted">Yükleniyor…</p>';
      showModal();
    }

    try {
      const response = await authFetch(`/api/ops/reports/order-profitability/detail?${params.toString()}`);
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'Detay yüklenemedi');
      openDetailModal(data.row);
    } catch (err) {
      if (body) body.innerHTML = `<p class="orders-warn-box">${esc(err.message || 'Detay yüklenemedi')}</p>`;
    }
  }

  async function loadReport() {
    const authFetch = window.BuyBoxCommon?.authFetch?.bind(window.BuyBoxCommon);
    const body = getEl('orderProfitBody');
    if (!authFetch) return;
    readFiltersFromForm();
    const rangeError = validateCustomRange();
    if (rangeError) {
      const note = getEl('orderProfitNote');
      if (note) note.textContent = rangeError;
      return;
    }
    if (body) body.innerHTML = '<tr><td colspan="9" class="muted">Yükleniyor…</td></tr>';

    try {
      const response = await authFetch(`/api/ops/reports/order-profitability?${buildQuery()}`);
      const data = await response.json();
      if (!response.ok || data.error || data.ok === false) {
        throw new Error(data.error || 'Rapor yüklenemedi');
      }
      if (data.page && data.page !== activePage) activePage = data.page;
      renderTable(data);
    } catch (err) {
      if (body) {
        body.innerHTML = `<tr><td colspan="9" class="muted">${esc(err.message || 'Rapor yüklenemedi')}</td></tr>`;
      }
      renderPagination({ total: 0, totalPages: 1, page: 1 });
    }
  }

  function bindChannelTabs() {
    document.querySelectorAll('#orderProfitChannelFilters [data-channel]').forEach((tab) => {
      tab.addEventListener('click', () => {
        activeChannel = tab.dataset.channel || 'all';
        document.querySelectorAll('#orderProfitChannelFilters [data-channel]').forEach((el) => {
          const isActive = el.dataset.channel === activeChannel;
          el.classList.toggle('active', isActive);
          el.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
        activePage = 1;
        loadReport();
      });
    });
  }

  function bindFilters() {
    getEl('orderProfitDays')?.addEventListener('change', syncCustomDateFields);

    getEl('orderProfitFilterForm')?.addEventListener('submit', (event) => {
      event.preventDefault();
      readFiltersFromForm();
      const rangeError = validateCustomRange();
      if (rangeError) {
        const note = getEl('orderProfitNote');
        if (note) note.textContent = rangeError;
        return;
      }
      activePage = 1;
      loadReport();
    });

    getEl('orderProfitClearFilters')?.addEventListener('click', () => {
      const daysEl = getEl('orderProfitDays');
      if (daysEl) daysEl.value = '7';
      const startEl = getEl('orderProfitStart');
      const endEl = getEl('orderProfitEnd');
      if (startEl) startEl.value = '';
      if (endEl) endEl.value = '';
      const statusEl = getEl('orderProfitStatus');
      if (statusEl) statusEl.value = '';
      activeRange = '';
      activePeriod = null;
      activeDays = '7';
      activeStartDate = '';
      activeEndDate = '';
      activeStatus = '';
      syncCustomDateFields();
      activePage = 1;
      loadReport();
    });

    syncCustomDateFields();
  }

  function bindModal() {
    getEl('orderProfitModalClose')?.addEventListener('click', closeModal);
    getEl('orderProfitModalBackdrop')?.addEventListener('click', (event) => {
      if (event.target === getEl('orderProfitModalBackdrop')) closeModal();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeModal();
    });
  }

  function init() {
    readFiltersFromForm();
    bindFilters();
    bindChannelTabs();
    bindModal();
    loadReport();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
