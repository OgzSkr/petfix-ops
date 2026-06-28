import { renderOpsShell } from './ops-shell.js';
import { renderChannelLogo } from '../../panel/components/channel-logos.js';
import { renderOpsInfoDisclosure } from './info-disclosure.js';
import { renderOpsCompactBar } from './compact-page-bar.js';
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

export function renderOpsReportsPage({ authRequired = true, auth = null } = {}) {
  const infoBlocks = [
    renderOpsInfoDisclosure({
      id: 'reportsInfoPeriod',
      title: 'Dönem ve kanal',
      items: [
        'Bugün: gün başından şu ana; önceki dönem dünün tamamıdır.',
        'Kanal sekmeleri tüm grafik ve KPI’ları filtreler.',
        'Isı haritası her zaman son 30 günü gösterir.'
      ]
    }),
    renderOpsInfoDisclosure({
      id: 'reportsInfoProfit',
      title: 'Kâr hesabı',
      paragraphs: [
        'Net kâr; satış − ürün maliyeti (BenimPOS) − komisyon − kurye ücreti − stopaj modeliyle hesaplanır.'
      ],
      items: [
        'BenimPOS alış fiyatı olmayan siparişler kâr toplamına dahil edilmez.',
        'Alt satırdaki not kaç siparişin dışarıda bırakıldığını gösterir.'
      ]
    })
  ].join('');

  const bar = renderOpsCompactBar({
    mainHtml: `
            <nav class="orders-subnav ops-reports-subnav" id="reportsChannelFilters" role="tablist" aria-label="Kanal filtresi">
              ${renderReportsChannelTabs()}
            </nav>
            <div class="ops-reports-period ops-segmented" role="group" aria-label="Dönem">
              <button type="button" class="ops-segmented-btn" data-period="today">Bugün</button>
              <button type="button" class="ops-segmented-btn is-active" data-days="7">7 gün</button>
              <button type="button" class="ops-segmented-btn" data-days="14">14 gün</button>
              <button type="button" class="ops-segmented-btn" data-days="30">30 gün</button>
            </div>`,
    sideHtml: infoBlocks
  });

  const bodyHtml = `
    <div class="ops-analytics-page ops-reports-page ops-compact-page pf-unified-page">
      ${renderReportsSectionNav('overview')}
      <section class="ops-panel ops-compact-page-panel ops-reports-toolbar-panel">
        ${bar}
        <p class="ops-order-profit-note" id="reportsNote"></p>
      </section>

      <section class="ops-reports-kpi" id="reportsKpiRow">
        <div class="ops-reports-kpi-group">
          <h2 class="ops-reports-kpi-heading">Satış</h2>
          <div class="ops-stat-grid ops-stat-grid--reports">
            <article class="ops-stat-card ops-stat-card--accent">
              <div class="ops-stat-card-icon" aria-hidden="true">₺</div>
              <div class="ops-stat-card-body">
                <div class="ops-stat-card-value" id="kpiRevenue">—</div>
                <div class="ops-stat-card-label">Ciro</div>
                <div class="ops-stat-card-delta" id="kpiRevenueChange"></div>
              </div>
            </article>
            <article class="ops-stat-card">
              <div class="ops-stat-card-icon" aria-hidden="true">▣</div>
              <div class="ops-stat-card-body">
                <div class="ops-stat-card-value" id="kpiOrders">—</div>
                <div class="ops-stat-card-label">Sipariş</div>
                <div class="ops-stat-card-delta" id="kpiOrdersChange"></div>
              </div>
            </article>
            <article class="ops-stat-card">
              <div class="ops-stat-card-icon" aria-hidden="true">◫</div>
              <div class="ops-stat-card-body">
                <div class="ops-stat-card-value" id="kpiBasket">—</div>
                <div class="ops-stat-card-label">Ort. sepet</div>
                <div class="ops-stat-card-delta" id="kpiBasketChange"></div>
              </div>
            </article>
          </div>
        </div>

        <div class="ops-reports-kpi-group ops-reports-kpi-group--profit">
          <h2 class="ops-reports-kpi-heading">Kârlılık</h2>
          <div class="ops-stat-grid ops-stat-grid--reports-profit">
            <article class="ops-stat-card ops-stat-card--profit" id="kpiNetProfitCard">
              <div class="ops-stat-card-icon" aria-hidden="true">◆</div>
              <div class="ops-stat-card-body">
                <div class="ops-stat-card-value" id="kpiNetProfit">—</div>
                <div class="ops-stat-card-label">Net kâr</div>
                <div class="ops-stat-card-delta" id="kpiNetProfitChange"></div>
              </div>
            </article>
            <article class="ops-stat-card">
              <div class="ops-stat-card-icon" aria-hidden="true">%</div>
              <div class="ops-stat-card-body">
                <div class="ops-stat-card-value" id="kpiProfitRate">—</div>
                <div class="ops-stat-card-label">Kâr marjı</div>
                <div class="ops-stat-card-hint">Satışa göre</div>
              </div>
            </article>
            <article class="ops-stat-card">
              <div class="ops-stat-card-icon ops-stat-card-icon--muted" aria-hidden="true">⊟</div>
              <div class="ops-stat-card-body">
                <div class="ops-stat-card-value" id="kpiProductCost">—</div>
                <div class="ops-stat-card-label">Ürün maliyeti</div>
                <div class="ops-stat-card-hint">BenimPOS</div>
              </div>
            </article>
          </div>
          <p class="ops-reports-profit-footnote" id="reportsProfitFootnote" aria-live="polite"></p>
        </div>

        <div class="ops-reports-kpi-group">
          <h2 class="ops-reports-kpi-heading">Operasyon</h2>
          <div class="ops-stat-grid ops-stat-grid--reports">
            <article class="ops-stat-card">
              <div class="ops-stat-card-icon ops-stat-card-icon--muted" aria-hidden="true">✕</div>
              <div class="ops-stat-card-body">
                <div class="ops-stat-card-value" id="kpiCancelled">—</div>
                <div class="ops-stat-card-label">İptal</div>
                <div class="ops-stat-card-delta" id="kpiCancelledChange"></div>
              </div>
            </article>
            <article class="ops-stat-card">
              <div class="ops-stat-card-icon" aria-hidden="true">⏱</div>
              <div class="ops-stat-card-body">
                <div class="ops-stat-card-value" id="kpiPicking">—</div>
                <div class="ops-stat-card-label">Ort. toplama</div>
                <div class="ops-stat-card-hint">Dakika</div>
              </div>
            </article>
            <article class="ops-stat-card">
              <div class="ops-stat-card-icon ops-stat-card-icon--warn" aria-hidden="true">!</div>
              <div class="ops-stat-card-body">
                <div class="ops-stat-card-value" id="kpiUnmapped">—</div>
                <div class="ops-stat-card-label">Tanımsız satır</div>
                <div class="ops-stat-card-hint">Eşleşmemiş</div>
              </div>
            </article>
          </div>
        </div>
      </section>

      <div class="ops-analytics-grid">
        <section class="ops-panel">
          <header class="ops-panel-head">
            <div>
              <h3 id="salesChartTitle">Günlük satış</h3>
              <p class="ops-panel-sub">Ciro ve sipariş hacmi</p>
            </div>
          </header>
          <div id="salesChart" class="ops-bar-chart ops-bar-chart--tall"></div>
        </section>
        <section class="ops-panel">
          <header class="ops-panel-head">
            <div>
              <h3>Kanal dağılımı</h3>
              <p class="ops-panel-sub">Ciro payı</p>
            </div>
          </header>
          <div id="channelBreakdown" class="ops-channel-breakdown"></div>
        </section>
      </div>

      <div class="ops-analytics-grid">
        <section class="ops-panel">
          <header class="ops-panel-head">
            <div>
              <h3>Saatlik yoğunluk</h3>
              <p class="ops-panel-sub">Gün içi sipariş dağılımı</p>
            </div>
          </header>
          <div id="hourlyChart" class="ops-bar-chart ops-bar-chart--hourly"></div>
        </section>
        <section class="ops-panel">
          <header class="ops-panel-head">
            <div>
              <h3>Haftalık ısı haritası</h3>
              <p class="ops-panel-sub">Son 30 gün · gün × saat</p>
            </div>
          </header>
          <div id="heatmapGrid" class="ops-heatmap"></div>
        </section>
      </div>

      <div class="ops-analytics-grid ops-analytics-grid--compact-3">
        <section class="ops-panel ops-panel--compact">
          <header class="ops-panel-head ops-panel-head--compact">
            <div>
              <h3>En çok satanlar</h3>
              <p class="ops-panel-sub">İlk 5</p>
            </div>
          </header>
          <div id="topProducts" class="ops-rank-list ops-rank-list--compact"></div>
        </section>
        <section class="ops-panel ops-panel--compact">
          <header class="ops-panel-head ops-panel-head--compact">
            <div>
              <h3>En az satanlar</h3>
              <p class="ops-panel-sub">İlk 5</p>
            </div>
          </header>
          <div id="leastProducts" class="ops-rank-list ops-rank-list--compact"></div>
        </section>
        <section class="ops-panel ops-panel--compact">
          <header class="ops-panel-head ops-panel-head--compact">
            <div>
              <h3>Hiç satılmayan</h3>
              <p class="ops-panel-sub">Özet</p>
            </div>
          </header>
          <div id="neverSold" class="ops-rank-list ops-rank-list--compact"></div>
        </section>
      </div>

    </div>`;

  return renderOpsShell({
    title: 'Raporlar',
    activeNav: 'reports',
    auth,
    suppressPageGuide: true,
    suppressPageHeader: true,
    bootstrapVar: '__OPS_REPORTS__',
    bootstrapData: { authRequired },
    bodyHtml,
    scripts: [
      '/assets/channel-logos.js',
      '/assets/ops-reports.js?v=6'
    ]
  });
}
