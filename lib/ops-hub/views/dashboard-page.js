import { renderOpsShell } from './ops-shell.js';
import { renderOpsCompactBar, renderOpsStatPills } from './compact-page-bar.js';

export function renderOpsDashboardPage({ authRequired = true, auth = null } = {}) {
  const bar = renderOpsCompactBar({
    sideHtml: renderOpsStatPills([
      { id: 'kpiMode', label: 'mod', valueClass: 'ops-kpi-value--mode' },
      { id: 'kpiChannels', label: 'açık mağaza' },
      { id: 'kpiAlerts', label: 'dikkat' }
    ])
  });

  const bodyHtml = `
    <div class="ops-dashboard-page ops-compact-page pf-unified-page">
      <section class="ops-panel ops-compact-page-panel">
        ${bar}
        <p class="ops-order-profit-note" id="kpiModeHint">Eğitim modunda gerçek işlem yapılmaz</p>
      </section>

      <div class="ops-analytics-grid">
        <section class="ops-panel">
          <header class="ops-panel-head">
            <div>
              <h3>Kanal durumu</h3>
              <p class="ops-panel-sub">Bağlantı ve mağaza özeti</p>
            </div>
          </header>
          <div id="channelSummary" class="ops-health-grid"></div>
          <p class="ops-dashboard-actions">
            <a href="/hzlmrktops/integrations" class="ops-btn ops-btn-secondary">Bağlantıları yönet</a>
          </p>
        </section>

        <section class="ops-panel">
          <header class="ops-panel-head">
            <div>
              <h3>Sık kullanılan</h3>
              <p class="ops-panel-sub">Operasyon kısayolları</p>
            </div>
          </header>
          <div class="ops-quick-links">
            <a href="/hzlmrktops/siparisler" class="ops-quick-link">
              <span class="ops-quick-link-title">Siparişler</span>
              <span class="ops-quick-link-desc">Gelen siparişleri görüntüle</span>
            </a>
            <a href="/hzlmrktops/raporlar" class="ops-quick-link">
              <span class="ops-quick-link-title">Raporlar</span>
              <span class="ops-quick-link-desc">Satış ve kâr özeti</span>
            </a>
            <a href="/hzlmrktops/integrations" class="ops-quick-link">
              <span class="ops-quick-link-title">Kanallar</span>
              <span class="ops-quick-link-desc">Getir, YS, Uber</span>
            </a>
            <a href="/hzlmrktops/sistem" class="ops-quick-link">
              <span class="ops-quick-link-title">Sistem Nabzı</span>
              <span class="ops-quick-link-desc">Otomatik işler</span>
            </a>
          </div>
          <p class="ops-meta ops-dashboard-poll-note" id="pollStatusNote"></p>
        </section>
      </div>

      <section class="ops-panel">
        <header class="ops-panel-head ops-panel-head--split">
          <div>
            <h3>Son hareketler</h3>
            <p class="ops-panel-sub">Son sistem olayları</p>
          </div>
          <a href="/hzlmrktops/sistem" class="ops-btn ops-btn-ghost-sm">Tümünü gör</a>
        </header>
        <ul class="ops-activity-feed" id="recentActivityFeed">
          <li class="ops-meta">Yükleniyor…</li>
        </ul>
      </section>
    </div>`;

  return renderOpsShell({
    title: 'Ana Panel',
    activeNav: 'dashboard',
    auth,
    suppressPageGuide: true,
    suppressPageHeader: true,
    bootstrapVar: '__OPS_DASHBOARD__',
    bootstrapData: { authRequired },
    bodyHtml,
    scripts: ['/assets/ops-dashboard.js?v=6']
  });
}
