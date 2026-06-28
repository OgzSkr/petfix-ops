import { renderOpsShell } from './ops-shell.js';
import { renderChannelLogo } from '../../panel/components/channel-logos.js';
import { renderOpsInfoDisclosure } from './info-disclosure.js';
import { renderReportsSectionNav } from './reports-section-nav.js';

const REPORT_CHANNELS = [
  { id: 'all', label: 'Tümü' },
  { id: 'uber-eats', label: 'Uber Eats' },
  { id: 'yemeksepeti', label: 'Yemeksepeti' },
  { id: 'getir', label: 'Getir' }
];

function renderReportsChannelTabs() {
  return REPORT_CHANNELS.map((tab, index) => {
    const active = index === 0 ? ' active' : '';
    const selected = index === 0 ? 'true' : 'false';
    const inner = tab.id === 'all'
      ? '<span class="orders-subnav-label">Tümü</span>'
      : renderChannelLogo(tab.id, { size: 'sm' });
    return `<button type="button" class="orders-subnav-tab orders-subnav-tab--channel${active}" data-channel="${tab.id}" data-label="${tab.label}" role="tab" aria-selected="${selected}" title="${tab.label}">${inner}</button>`;
  }).join('');
}

export function renderOpsOrderProfitReportPage({ authRequired = true, auth = null } = {}) {
  const infoBlocks = renderOpsInfoDisclosure({
    id: 'orderProfitInfo',
    title: 'Rapor notu',
    items: [
      'En fazla 30 günlük dönem seçilebilir (özel tarih dahil).',
      'Kayıtlı tüm siparişler listelenir; iptal ve başarısızlar hariç.',
      'Maliyet: sipariş geldiği andaki ana havuz alış fiyatı kaydedilir; BenimPOS sync yalnızca yeni siparişleri etkiler.',
      'Kâr verisi eksik olanlar da tabloda görünür — Veri sütununa bakın.'
    ]
  });

  const bodyHtml = `
    <div class="ops-order-profit-page pf-unified-page">
      ${renderReportsSectionNav('order-profit')}
      <section class="ops-panel ops-order-profit-panel">
        <header class="ops-order-profit-bar">
          <div class="ops-order-profit-bar-main">
            <nav class="orders-subnav ops-order-profit-channels" id="orderProfitChannelFilters" role="tablist" aria-label="Kanal filtresi">
              ${renderReportsChannelTabs()}
            </nav>
          </div>
          <div class="ops-order-profit-bar-side">
            <div class="ops-order-profit-counts" aria-live="polite">
              <span class="ops-order-profit-count" id="orderProfitPeriodBadge">—</span>
              <span class="ops-order-profit-count"><strong id="orderProfitTotal">—</strong> sipariş</span>
              <span class="ops-order-profit-count ops-order-profit-count--muted" id="orderProfitPageInfo">—</span>
            </div>
            ${infoBlocks}
          </div>
        </header>

        <form id="orderProfitFilterForm" class="ops-orders-filter-inline ops-order-profit-filters">
          <div class="ops-orders-filter-row orders-filter-grid">
            <label class="ops-orders-filter-field" for="orderProfitDays">
              <span>Dönem</span>
              <select id="orderProfitDays" name="days">
                <option value="0">Bugün</option>
                <option value="7" selected>Son 7 gün</option>
                <option value="14">Son 14 gün</option>
                <option value="30">Son 30 gün</option>
                <option value="custom">Özel tarih</option>
              </select>
            </label>
            <label class="ops-orders-filter-field custom-date-field" for="orderProfitStart">
              <span>Başlangıç</span>
              <input type="date" id="orderProfitStart" name="startDate" disabled>
            </label>
            <label class="ops-orders-filter-field custom-date-field" for="orderProfitEnd">
              <span>Bitiş</span>
              <input type="date" id="orderProfitEnd" name="endDate" disabled>
            </label>
            <label class="ops-orders-filter-field" for="orderProfitStatus">
              <span>Durum</span>
              <select id="orderProfitStatus" name="status">
                <option value="">Tüm durumlar</option>
              </select>
            </label>
            <div class="orders-filter-actions ops-orders-filter-actions">
              <button type="button" class="btn-coral" id="orderProfitClearFilters">Temizle</button>
              <button type="submit" class="btn-brown">Uygula</button>
            </div>
          </div>
          <p class="ops-order-profit-filter-hint">Özel tarih aralığı en fazla 30 gün olabilir.</p>
        </form>

        <p class="ops-order-profit-note" id="orderProfitNote"></p>

        <div class="ops-order-profit-wrap">
          <table class="ops-order-profit-table" id="orderProfitTable">
            <thead>
              <tr>
                <th>Sipariş</th>
                <th>Tarih</th>
                <th>Durum</th>
                <th>Tutar</th>
                <th>Maliyet</th>
                <th>Komisyon</th>
                <th>Net kâr</th>
                <th>Marj</th>
                <th>Veri</th>
              </tr>
            </thead>
            <tbody id="orderProfitBody">
              <tr><td colspan="9" class="muted">Yükleniyor…</td></tr>
            </tbody>
          </table>
        </div>
        <footer class="ops-order-profit-footer" id="orderProfitFooter" hidden></footer>
      </section>
    </div>

    <div class="orders-modal-backdrop" id="orderProfitModalBackdrop" hidden>
      <div class="orders-modal" role="dialog" aria-modal="true" aria-labelledby="orderProfitModalTitle">
        <div class="orders-modal-head">
          <h3 id="orderProfitModalTitle">Sipariş detayı</h3>
          <button type="button" class="orders-modal-close" id="orderProfitModalClose" aria-label="Kapat">×</button>
        </div>
        <div class="orders-modal-body" id="orderProfitModalBody"></div>
      </div>
    </div>`;

  return renderOpsShell({
    title: 'Sipariş Kârlılık Raporu',
    activeNav: 'reports',
    auth,
    suppressPageGuide: true,
    suppressPageHeader: true,
    bootstrapVar: '__OPS_ORDER_PROFIT__',
    bootstrapData: { authRequired },
    bodyHtml,
    extraStylesheets: ['/assets/orders.css'],
    scripts: [
      '/assets/channel-logos.js',
      '/assets/ops-order-detail.js?v=1',
      '/assets/ops-order-profit-report.js?v=7'
    ]
  });
}
