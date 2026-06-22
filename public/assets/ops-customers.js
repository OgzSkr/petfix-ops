'use strict';

const PAGE_SIZE = 50;

const CHANNEL_LABELS = {
  getir: 'Getir',
  yemeksepeti: 'Yemeksepeti',
  trendyol_go: 'Uber / TGO'
};

let allCustomers = [];
let state = {
  page: 1,
  search: '',
  sortCol: 'lastOrderAt',
  sortDir: 'desc',
  filters: {}
};

let searchTimer = null;
let activeFilterCol = null;

function getOps() {
  return window.OpsCommon || null;
}

function getEl(id) {
  return document.getElementById(id);
}

function esc(value) {
  return getOps()?.escapeHtml?.(value) ?? String(value ?? '');
}

function getLogos() {
  return window.PetFixChannelLogos || window.ChannelLogos || null;
}

function channelLogoId(channel) {
  if (channel === 'trendyol_go') return 'uber-eats';
  return channel;
}

function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function normalizeSearch(value) {
  return String(value || '')
    .trim()
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c');
}

function renderEmptyRow(message, hint = '') {
  return `<tr><td colspan="7"><div class="ops-empty-state"><span class="ops-empty-state-icon" aria-hidden="true">👤</span><strong>${esc(message)}</strong>${hint ? `<span>${esc(hint)}</span>` : ''}</div></td></tr>`;
}

function copyButton(value) {
  const text = String(value || '').trim();
  if (!text) return '<span class="ops-muted-cell">—</span>';
  return `<span class="ops-copy-cell"><span class="ops-copy-text" title="${esc(text)}">${esc(text)}</span><button type="button" class="ops-copy-btn" data-copy="${esc(text)}" title="Kopyala" aria-label="Kopyala"><span aria-hidden="true">⧉</span></button></span>`;
}

function phoneCallTitle(row) {
  const display = String(row.phone || '').trim();
  if (!display) return 'Ara';
  if (row.isRelayPhone && row.channel === 'getir' && row.phonePin) {
    return `Santrali ara — PIN: ${row.phonePin}`;
  }
  if (row.isRelayPhone && row.channel === 'trendyol_go') {
    return `Ara — sipariş no otomatik tuşlanır (${display})`;
  }
  return `Ara: ${display}`;
}

function phoneCell(row) {
  const display = String(row.phone || '').trim();
  if (!display) return '<span class="ops-muted-cell">—</span>';

  const dial = String(row.phoneDial || '').trim();
  const callLink = dial
    ? `<a href="${esc(dial)}" class="ops-phone-call-btn" title="${esc(phoneCallTitle(row))}" aria-label="${esc(phoneCallTitle(row))}"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.01-.24c1.12.37 2.33.57 3.58.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C10.07 21 3 13.93 3 5a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.46.57 3.58a1 1 0 0 1-.25 1.01l-2.2 2.2Z"/></svg></a>`
    : '';

  return `<span class="ops-phone-cell">${callLink}${copyButton(display)}</span>`;
}

function orderCountBadge(count) {
  const num = Number(count) || 0;
  const cls = num >= 5 ? 'is-high' : num >= 2 ? 'is-mid' : '';
  return `<span class="ops-order-count-badge ${cls}">${num}</span>`;
}

function compareValues(a, b, col) {
  if (col === 'lastOrderAt') {
    return new Date(a.lastOrderAt).getTime() - new Date(b.lastOrderAt).getTime();
  }
  if (col === 'orderCount' || col === 'id') {
    return (Number(a[col]) || 0) - (Number(b[col]) || 0);
  }
  const av = normalizeSearch(col === 'channel' ? (a.channelLabel || a.channel) : a[col]);
  const bv = normalizeSearch(col === 'channel' ? (b.channelLabel || b.channel) : b[col]);
  return av.localeCompare(bv, 'tr');
}

function applyFilters(rows) {
  let result = rows.slice();

  const needle = normalizeSearch(state.search);
  if (needle) {
    result = result.filter((row) =>
      normalizeSearch(row.name).includes(needle)
      ||       normalizeSearch(row.phone).includes(needle)
      || normalizeSearch(row.phonePin).includes(needle)
      || normalizeSearch(row.email).includes(needle)
    );
  }

  for (const [col, filter] of Object.entries(state.filters)) {
    if (!filter) continue;
    if (col === 'channel' && Array.isArray(filter.values) && filter.values.length) {
      result = result.filter((row) => filter.values.includes(row.channel));
      continue;
    }
    if (col === 'orderCount' && (filter.min != null || filter.max != null)) {
      result = result.filter((row) => {
        const n = Number(row.orderCount) || 0;
        if (filter.min != null && n < Number(filter.min)) return false;
        if (filter.max != null && n > Number(filter.max)) return false;
        return true;
      });
      continue;
    }
    const text = normalizeSearch(filter.text || '');
    if (!text) continue;
    result = result.filter((row) => {
      let value = '';
      if (col === 'channel') value = row.channelLabel || row.channel;
      else if (col === 'lastOrderAt') value = formatDateTime(row.lastOrderAt);
      else if (col === 'phone') value = row.phone || '';
      else value = row[col];
      return normalizeSearch(value).includes(text);
    });
  }

  if (state.sortCol) {
    result.sort((a, b) => {
      const cmp = compareValues(a, b, state.sortCol);
      return state.sortDir === 'asc' ? cmp : -cmp;
    });
  }

  return result;
}

function getVisibleRows() {
  const filtered = applyFilters(allCustomers);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if (state.page > totalPages) state.page = totalPages;
  const start = (state.page - 1) * PAGE_SIZE;
  return {
    filtered,
    items: filtered.slice(start, start + PAGE_SIZE),
    totalPages
  };
}

function renderRows(items = []) {
  const body = getEl('customersBody');
  const logos = getLogos();
  if (!body) return;
  if (!items.length) {
    const hasFilters = state.search || Object.keys(state.filters).length;
    body.innerHTML = renderEmptyRow(
      hasFilters ? 'Filtreye uygun müşteri bulunamadı.' : 'Henüz müşteri kaydı yok.',
      hasFilters ? '' : 'Siparişler geldikçe müşteri kayıtları burada listelenir.'
    );
    return;
  }
  body.innerHTML = items.map((row) => {
    const logoId = channelLogoId(row.channel);
    const logo = logos?.render
      ? logos.render(logoId, { size: 'sm', title: row.channelLabel || CHANNEL_LABELS[row.channel] || row.channel })
      : `<span class="ops-channel-fallback" title="${esc(row.channelLabel || row.channel)}">${esc((row.channel || '?').slice(0, 1).toUpperCase())}</span>`;
    return `<tr>
      <td><a href="/hzlmrktops/siparisler" class="ops-link-id">#${esc(String(row.id))}</a></td>
      <td class="ops-customers-channel">${logo}</td>
      <td><span class="ops-customer-name">${esc(row.name || '—')}</span></td>
      <td>${orderCountBadge(row.orderCount)}</td>
      <td>${phoneCell(row)}</td>
      <td>${copyButton(row.email)}</td>
      <td><time class="ops-date-cell">${formatDateTime(row.lastOrderAt)}</time></td>
    </tr>`;
  }).join('');
}

function formatDateOnly(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('tr-TR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  });
}

function renderCustomerMeta(meta = {}) {
  const sinceEl = getEl('customersSince');
  const sinceLine = getEl('customersSinceLine');
  const oldest = meta.oldestOrderAt;
  const newest = meta.newestOrderAt;
  const formattedOldest = formatDateOnly(oldest);
  const formattedNewest = formatDateOnly(newest);

  if (sinceEl) sinceEl.textContent = formattedOldest;

  if (sinceLine) {
    if (!oldest) {
      sinceLine.textContent = 'Henüz sipariş kaydı yok.';
    } else {
      sinceLine.textContent = `Kayıtlar ${formattedOldest} tarihinden beri (${meta.sourceOrderCount || 0} siparişten türetildi).`;
    }
  }

  const totalEl = getEl('customersTotal');
  if (totalEl && meta.uniqueCustomers != null) {
    totalEl.textContent = String(meta.uniqueCustomers);
  }
}

function renderHeroStats(items = [], totalFiltered = 0) {
  const pageEl = getEl('customersPageCount');
  if (pageEl) pageEl.textContent = String(items.length || 0);
  if (!getEl('customersTotal')?.dataset.metaBound) {
    const totalEl = getEl('customersTotal');
    if (totalEl) totalEl.textContent = String(totalFiltered);
  }
}

function renderSummary(totalFiltered) {
  const summary = getEl('customersSummary');
  if (!summary) return;
  if (!totalFiltered) {
    summary.textContent = 'Kayıt yok';
    return;
  }
  const start = (state.page - 1) * PAGE_SIZE + 1;
  const end = Math.min(state.page * PAGE_SIZE, totalFiltered);
  summary.textContent = `${totalFiltered} kayıttan ${start} – ${end} arası gösteriliyor`;
}

function renderPagination(totalPages) {
  const nav = getEl('customersPagination');
  if (!nav) return;
  if (totalPages <= 1) {
    nav.innerHTML = '';
    return;
  }
  const pages = [];
  const addBtn = (label, page, { disabled = false, active = false } = {}) => {
    pages.push(`<button type="button" class="ops-page-btn${active ? ' is-active' : ''}" data-page="${page}" ${disabled ? 'disabled' : ''}>${label}</button>`);
  };
  addBtn('İlk', 1, { disabled: state.page <= 1 });
  addBtn('‹', state.page - 1, { disabled: state.page <= 1 });
  const startPage = Math.max(1, Math.min(state.page - 2, totalPages - 4));
  const endPage = Math.min(totalPages, startPage + 4);
  for (let p = startPage; p <= endPage; p += 1) {
    addBtn(String(p), p, { active: p === state.page });
  }
  addBtn('›', state.page + 1, { disabled: state.page >= totalPages });
  addBtn('Son', totalPages, { disabled: state.page >= totalPages });
  nav.innerHTML = pages.join('');
  nav.querySelectorAll('[data-page]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const page = Number(btn.dataset.page);
      if (!page || page === state.page) return;
      state.page = page;
      refreshView();
    });
  });
}

function updateHeaderStates() {
  document.querySelectorAll('.ops-customers-table th[data-col]').forEach((th) => {
    const col = th.dataset.col;
    th.classList.toggle('is-filtered', Boolean(state.filters[col]));
    th.classList.toggle('is-sorted', state.sortCol === col);
    const sortBtn = th.querySelector('[data-action="sort"]');
    if (sortBtn) {
      sortBtn.textContent = state.sortCol === col
        ? (state.sortDir === 'asc' ? '↑' : '↓')
        : '↕';
      sortBtn.classList.toggle('is-active', state.sortCol === col);
    }
    const filterBtn = th.querySelector('[data-action="filter"]');
    if (filterBtn) filterBtn.classList.toggle('is-active', Boolean(state.filters[col]));
  });
  const clearBtn = getEl('customersClearFilters');
  if (clearBtn) {
    const active = state.search || Object.keys(state.filters).length;
    clearBtn.classList.toggle('hidden', !active);
  }
}

function refreshView() {
  const { filtered, items, totalPages } = getVisibleRows();
  renderRows(items);
  renderHeroStats(items, filtered.length);
  renderSummary(filtered.length);
  renderPagination(totalPages);
  updateHeaderStates();
}

async function loadCustomers() {
  const authFetch = window.BuyBoxCommon?.authFetch?.bind(window.BuyBoxCommon);
  const body = getEl('customersBody');
  if (!authFetch || !body) return;
  body.innerHTML = renderEmptyRow('Yükleniyor…');
  try {
    const response = await authFetch('/api/ops/customers?all=1');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Müşteriler yüklenemedi');
    allCustomers = data.items || [];
    renderCustomerMeta(data.meta || {});
    const totalEl = getEl('customersTotal');
    if (totalEl) totalEl.dataset.metaBound = '1';
    state.page = 1;
    refreshView();
  } catch (err) {
    body.innerHTML = `<tr><td colspan="7"><div class="ops-empty-state ops-empty-state--error"><span class="ops-empty-state-icon" aria-hidden="true">!</span><strong>${esc(err.message || 'Yüklenemedi')}</strong></div></td></tr>`;
  }
}

function openFilterPopover(col) {
  activeFilterCol = col;
  const popover = getEl('customersFilterPopover');
  const body = getEl('customersFilterBody');
  const title = getEl('customersFilterTitle');
  if (!popover || !body || !title) return;

  const labels = {
    id: 'ID',
    channel: 'Kanal',
    name: 'Adı soyadı',
    orderCount: 'Toplam sipariş',
    phone: 'Telefon',
    email: 'E-posta',
    lastOrderAt: 'Son sipariş'
  };
  title.textContent = `${labels[col] || col} filtresi`;
  const current = state.filters[col] || {};

  if (col === 'channel') {
    const channels = ['getir', 'yemeksepeti', 'trendyol_go'];
    const selected = new Set(current.values || []);
    body.innerHTML = `<div class="ops-filter-checklist">${channels.map((channel) => {
      const checked = selected.has(channel) ? 'checked' : '';
      return `<label class="ops-filter-check"><input type="checkbox" value="${channel}" ${checked}><span>${esc(CHANNEL_LABELS[channel])}</span></label>`;
    }).join('')}</div>`;
  } else if (col === 'orderCount') {
    body.innerHTML = `<div class="ops-filter-range">
      <label>Min<input type="number" min="0" class="ops-input" id="filterMin" value="${current.min ?? ''}"></label>
      <label>Max<input type="number" min="0" class="ops-input" id="filterMax" value="${current.max ?? ''}"></label>
    </div>`;
  } else {
    body.innerHTML = `<label class="ops-filter-text">
      <span>İçerir</span>
      <input type="search" class="ops-input" id="filterText" value="${esc(current.text || '')}" placeholder="Metin ara">
    </label>`;
  }

  popover.classList.remove('hidden');
}

function closeFilterPopover() {
  getEl('customersFilterPopover')?.classList.add('hidden');
  activeFilterCol = null;
}

function applyActiveFilter() {
  if (!activeFilterCol) return;
  const col = activeFilterCol;
  if (col === 'channel') {
    const values = Array.from(document.querySelectorAll('#customersFilterBody input[type=checkbox]:checked'))
      .map((el) => el.value);
    if (values.length) state.filters[col] = { values };
    else delete state.filters[col];
  } else if (col === 'orderCount') {
    const min = getEl('filterMin')?.value;
    const max = getEl('filterMax')?.value;
    if (min || max) state.filters[col] = { min: min || null, max: max || null };
    else delete state.filters[col];
  } else {
    const text = getEl('filterText')?.value?.trim();
    if (text) state.filters[col] = { text };
    else delete state.filters[col];
  }
  state.page = 1;
  closeFilterPopover();
  refreshView();
}

function bindTableHeaderActions() {
  document.querySelector('.ops-customers-table thead')?.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-action]');
    if (!btn) return;
    const col = btn.dataset.col;
    if (!col) return;
    if (btn.dataset.action === 'filter') {
      openFilterPopover(col);
      return;
    }
    if (btn.dataset.action === 'sort') {
      if (state.sortCol === col) {
        state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortCol = col;
        state.sortDir = col === 'name' ? 'asc' : 'desc';
      }
      state.page = 1;
      refreshView();
    }
  });
}

function bindSearch() {
  const input = getEl('customerSearch');
  if (!input) return;
  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.search = input.value.trim();
      state.page = 1;
      refreshView();
    }, 250);
  });
}

function bindFilterPopover() {
  getEl('customersFilterApply')?.addEventListener('click', applyActiveFilter);
  getEl('customersFilterClear')?.addEventListener('click', () => {
    if (activeFilterCol) delete state.filters[activeFilterCol];
    closeFilterPopover();
    refreshView();
  });
  getEl('customersFilterPopover')?.addEventListener('click', (event) => {
    if (event.target.closest('[data-dismiss="popover"]')) closeFilterPopover();
  });
  getEl('customersClearFilters')?.addEventListener('click', () => {
    state.filters = {};
    state.search = '';
    state.page = 1;
    const input = getEl('customerSearch');
    if (input) input.value = '';
    refreshView();
  });
}

function bindCopy() {
  document.addEventListener('click', (event) => {
    const btn = event.target.closest('.ops-copy-btn');
    if (!btn) return;
    const text = btn.getAttribute('data-copy') || '';
    if (!text) return;
    navigator.clipboard?.writeText(text).then(() => {
      btn.classList.add('is-copied');
      const toast = getEl('toast') || document.getElementById('pfToast');
      if (toast) {
        toast.textContent = 'Panoya kopyalandı';
        toast.classList.add('is-visible');
        setTimeout(() => toast.classList.remove('is-visible'), 1800);
      }
      setTimeout(() => btn.classList.remove('is-copied'), 1200);
    }).catch(() => {});
  });
}

document.addEventListener('DOMContentLoaded', () => {
  bindSearch();
  bindCopy();
  bindTableHeaderActions();
  bindFilterPopover();
  loadCustomers();
  document.getElementById('pfRefreshBtn')?.addEventListener('click', loadCustomers);
});
