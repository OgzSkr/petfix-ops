import { renderOpsShell } from './ops-shell.js';

export function renderOpsDashboardPage({ authRequired = true, auth = null } = {}) {
  const bodyHtml = `
    <div class="ops-toolbar">
      <h2>Ana panel</h2>
    </div>

    <div class="ops-kpi-row" id="kpiRow">
      <div class="ops-kpi-card">
        <div class="ops-kpi-value" id="kpiPending">—</div>
        <div class="ops-kpi-label">Bekleyen sipariş</div>
      </div>
      <div class="ops-kpi-card">
        <div class="ops-kpi-value" id="kpiPicking">—</div>
        <div class="ops-kpi-label">Toplanıyor</div>
      </div>
      <div class="ops-kpi-card">
        <div class="ops-kpi-value" id="kpiChannels">—</div>
        <div class="ops-kpi-label">Bağlı kanal</div>
      </div>
      <div class="ops-kpi-card">
        <div class="ops-kpi-value" id="kpiAlerts">—</div>
        <div class="ops-kpi-label">Uyarı</div>
      </div>
    </div>

    <section class="ops-section" id="shadowReadinessSection">
      <h3>Eğitim modu — canlıya geçiş hazırlığı</h3>
      <p class="ops-meta">Canlı kanal ve kasa yazması için önerilen minimum: 7 gün ve 20 sipariş shadow deneyimi.</p>
      <div class="ops-kpi-row">
        <div class="ops-kpi-card">
          <div class="ops-kpi-value" id="shadowOrderCount">—</div>
          <div class="ops-kpi-label">Shadow sipariş (hedef 20)</div>
        </div>
        <div class="ops-kpi-card">
          <div class="ops-kpi-value" id="shadowDayCount">—</div>
          <div class="ops-kpi-label">Gün (hedef 7)</div>
        </div>
        <div class="ops-kpi-card">
          <div class="ops-kpi-value" id="shadowIssueCount">—</div>
          <div class="ops-kpi-label">Açık uyarı</div>
        </div>
        <div class="ops-kpi-card">
          <div class="ops-kpi-value" id="shadowReadyLabel">—</div>
          <div class="ops-kpi-label">Durum</div>
        </div>
      </div>
      <div class="ops-progress" style="margin-top:8px"><div id="shadowOrderProgress" class="ops-progress-fill"></div></div>
      <p id="shadowReadinessNote" class="ops-meta"></p>
      <ul id="shadowIssueList" class="ops-steps"></ul>
      <p style="margin-top:12px">
        <a href="/products" class="ops-btn ops-btn-secondary" style="display:inline-flex;text-decoration:none;margin-right:8px">Ürün Merkezi</a>
        <a href="/quick-commerce/health" class="ops-btn ops-btn-ghost-sm" style="display:inline-flex;text-decoration:none">Sistem durumu</a>
      </p>
    </section>

    <div class="ops-detail-grid">
      <section class="ops-section">
        <h3>Acil siparişler</h3>
        <div id="urgentOrders" class="ops-card-grid"></div>
        <div id="urgentEmpty" class="ops-meta hidden">Acil sipariş yok.</div>
        <p style="margin-top:12px"><a href="/quick-commerce/picking" class="ops-btn ops-btn-primary" style="display:inline-flex;text-decoration:none">Toplama kuyruğuna git</a></p>
      </section>

      <section class="ops-section">
        <h3>Kanal durumu</h3>
        <div id="channelSummary" class="ops-health-grid"></div>
        <p style="margin-top:12px"><a href="/quick-commerce/integrations" class="ops-btn ops-btn-secondary" style="display:inline-flex;text-decoration:none">Kanalları yönet</a></p>
      </section>
    </div>`;

  return renderOpsShell({
    title: 'PetFix Ops — Ana Panel',
    activeNav: 'panel',
    auth,
    bootstrapVar: '__OPS_DASHBOARD__',
    bootstrapData: { authRequired },
    bodyHtml,
    scripts: ['/assets/ops-dashboard.js']
  });
}
