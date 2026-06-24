import { renderOpsShell } from './ops-shell.js';
import { renderOpsInfoDisclosure } from './info-disclosure.js';
import { renderOpsCompactBar, renderOpsStatPills } from './compact-page-bar.js';

const COLUMNS = [
  { id: 'id', label: 'ID', filter: 'text', sort: true },
  { id: 'channel', label: 'Kanal', filter: 'channel', sort: true },
  { id: 'name', label: 'Adı soyadı', filter: 'text', sort: true },
  { id: 'orderCount', label: 'Toplam sipariş', filter: 'number', sort: true },
  { id: 'phone', label: 'Telefon', filter: 'text', sort: true },
  { id: 'email', label: 'E-posta', filter: 'text', sort: true },
  { id: 'lastOrderAt', label: 'Son sipariş', filter: 'text', sort: true }
];

function renderHeaderCell(col) {
  const filterBtn = col.filter
    ? `<button type="button" class="ops-col-btn ops-col-btn--filter" data-action="filter" data-col="${col.id}" title="Filtrele" aria-label="${col.label} filtrele"><span class="ops-col-btn-icon" aria-hidden="true">⏷</span><span class="ops-col-btn-text">Filtre</span></button>`
    : '';
  const sortBtn = col.sort
    ? `<button type="button" class="ops-col-btn ops-col-btn--sort" data-action="sort" data-col="${col.id}" title="Sırala" aria-label="${col.label} sırala"><span class="ops-col-btn-icon" aria-hidden="true">⇅</span><span class="ops-col-btn-text">Sırala</span></button>`
    : '';
  return `<th scope="col" data-col="${col.id}">
    <div class="ops-col-head">
      <span class="ops-col-label">${col.label}</span>
      <span class="ops-col-actions">${filterBtn}${sortBtn}</span>
    </div>
  </th>`;
}

export function renderOpsCustomersPage({ authRequired = true, auth = null } = {}) {
  const infoBlock = renderOpsInfoDisclosure({
    id: 'customersInfo',
    title: 'Müşteri notu',
    items: [
      'Liste canlı siparişlerden oluşturulur; iptal ve başarısız kayıtlar dahil değildir.',
      'Aynı kanalda aynı kimlik tek müşteride birleştirilir.',
      'Relay arama hatlarında hat ve tuşlama kodu birlikte gösterilir.'
    ],
    paragraphs: [
      '<span id="customersSinceLine">Kayıt aralığı yükleniyor…</span>'
    ]
  });

  const bar = renderOpsCompactBar({
    sideHtml: `${renderOpsStatPills([
      { id: 'customersTotal', label: 'toplam' },
      { id: 'customersPageCount', label: 'bu sayfa' },
      { id: 'customersSince', label: 'ilk kayıt', muted: true, valueClass: 'ops-compact-stat-value--sm' }
    ])}${infoBlock}`
  });

  const bodyHtml = `
    <div class="ops-customers-page ops-compact-page pf-unified-page">
      <section class="ops-panel ops-compact-page-panel ops-customers-panel">
        ${bar}
        <p class="ops-order-profit-note" id="customersLead">Sipariş veren müşteriler kanal, telefon ve son sipariş tarihine göre gruplanır.</p>
        <div class="ops-customers-toolbar">
          <label class="ops-search-box">
            <span class="ops-search-box-icon" aria-hidden="true">⌕</span>
            <span class="visually-hidden">Müşteri ara</span>
            <input type="search" id="customerSearch" class="ops-input ops-search-box-input" placeholder="Müşteri adı, telefon veya e-posta ara" autocomplete="off">
          </label>
          <button type="button" id="customersClearFilters" class="ops-btn ops-btn-ghost-sm hidden">Filtreleri temizle</button>
        </div>

        <div class="ops-table-wrap ops-table-wrap--sticky">
          <table class="ops-data-table ops-customers-table">
            <thead>
              <tr>${COLUMNS.map(renderHeaderCell).join('')}</tr>
            </thead>
            <tbody id="customersBody">
              <tr><td colspan="7"><div class="ops-empty-state"><span class="ops-empty-state-icon" aria-hidden="true">…</span><span>Yükleniyor…</span></div></td></tr>
            </tbody>
          </table>
        </div>

        <div class="ops-table-footer">
          <p class="ops-table-summary" id="customersSummary">—</p>
          <nav class="ops-pagination" id="customersPagination" aria-label="Sayfalama"></nav>
        </div>
      </section>
    </div>

    <div id="customersFilterPopover" class="ops-col-popover hidden" role="dialog" aria-modal="true" aria-labelledby="customersFilterTitle">
      <div class="ops-col-popover-backdrop" data-dismiss="popover"></div>
      <div class="ops-col-popover-panel">
        <div class="ops-col-popover-head">
          <strong id="customersFilterTitle">Filtre</strong>
          <button type="button" class="ops-col-popover-close" data-dismiss="popover" aria-label="Kapat">×</button>
        </div>
        <div id="customersFilterBody" class="ops-col-popover-body"></div>
        <div class="ops-col-popover-actions">
          <button type="button" class="ops-btn ops-btn-ghost-sm" id="customersFilterClear">Temizle</button>
          <button type="button" class="ops-btn ops-btn-secondary" id="customersFilterApply">Uygula</button>
        </div>
      </div>
    </div>`;

  return renderOpsShell({
    title: 'Müşteriler',
    activeNav: 'customers',
    auth,
    suppressPageGuide: true,
    suppressPageHeader: true,
    bootstrapVar: '__OPS_CUSTOMERS__',
    bootstrapData: { authRequired },
    bodyHtml,
    scripts: [
      '/assets/channel-logos.js',
      '/assets/ops-customers.js?v=9'
    ]
  });
}
