import { renderOpsShell } from './ops-shell.js';
import { renderOpsInfoDisclosure } from './info-disclosure.js';

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
  const infoBlocks = [
    renderOpsInfoDisclosure({
      id: 'customersInfoRecords',
      title: 'Kayıt kapsamı',
      paragraphs: [
        'Müşteri listesi, şubenize ait canlı siparişlerden otomatik oluşturulur. İptal ve başarısız siparişler dahil edilmez.',
        '<span id="customersSinceLine">Kayıt aralığı yükleniyor…</span>'
      ]
    }),
    renderOpsInfoDisclosure({
      id: 'customersInfoGrouping',
      title: 'Müşteri gruplama',
      items: [
        'Aynı kanalda aynı ad-soyad veya platform müşteri kimliği tek kayıtta birleştirilir.',
        'Uber ve Yemeksepeti arama numaraları (0212…) paylaşımlı olabilir; bu numaralar kimlik olarak kullanılmaz.',
        'Gerçek cep telefonu veya e-posta varsa iletişim sütununda gösterilir.'
      ]
    }),
    renderOpsInfoDisclosure({
      id: 'customersInfoRelay',
      title: 'Arama numarası (relay)',
      paragraphs: [
        'Bazı kanallar müşteri numarasını gizler; yerine geçici arama hattı verir. Telefon sütununda hat ve tuşlama kodu birlikte gösterilir (ör. Uber: <code>0 (212) 365 34 03,11334556904</code>, Getir: <code>+90 (800) 606 01 02,154091</code>). Yeşil telefon simgesine tıklayınca arama başlar; Uber sipariş numarasını otomatik tuşlar, Getir\'de santral açılır ve PIN\'i siz girersiniz.'
      ]
    })
  ].join('');

  const bodyHtml = `
    <div class="ops-customers-page pf-unified-page">
      <div class="ops-customers-hero">
        <div class="ops-customers-hero-copy">
          <p class="ops-analytics-eyebrow">Müşteri listesi</p>
          <p class="ops-customers-lead" id="customersLead">Sipariş veren müşteriler kanal, telefon ve son sipariş tarihine göre gruplanır.</p>
          <div class="ops-info-stack">${infoBlocks}</div>
        </div>
        <div class="ops-customers-stats">
          <div class="ops-customers-stat">
            <span class="ops-customers-stat-value" id="customersTotal">—</span>
            <span class="ops-customers-stat-label">Toplam müşteri</span>
          </div>
          <div class="ops-customers-stat">
            <span class="ops-customers-stat-value" id="customersPageCount">—</span>
            <span class="ops-customers-stat-label">Bu sayfada</span>
          </div>
          <div class="ops-customers-stat ops-customers-stat--muted">
            <span class="ops-customers-stat-value ops-customers-stat-value--sm" id="customersSince">—</span>
            <span class="ops-customers-stat-label">İlk kayıt</span>
          </div>
        </div>
      </div>

      <section class="ops-panel ops-customers-panel">
        <div class="ops-customers-toolbar">
          <label class="ops-search-box">
            <span class="ops-search-box-icon" aria-hidden="true">⌕</span>
            <span class="visually-hidden">Müşteri ara</span>
            <input type="search" id="customerSearch" class="ops-input ops-search-box-input" placeholder="Müşteri adı, telefon veya e-posta ara" autocomplete="off">
          </label>
          <button type="button" id="customersClearFilters" class="ops-btn ops-btn-ghost-sm hidden">Filtreleri temizle</button>
        </div>
        <p class="ops-table-hint">Kolon başlığındaki <strong>Filtre</strong> ile süzün, <strong>Sırala</strong> ile artan/azalan düzenleyin.</p>

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
    bootstrapVar: '__OPS_CUSTOMERS__',
    bootstrapData: { authRequired },
    bodyHtml,
    scripts: [
      '/assets/channel-logos.js',
      '/assets/ops-customers.js?v=8'
    ]
  });
}
