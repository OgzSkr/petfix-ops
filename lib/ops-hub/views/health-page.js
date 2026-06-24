import { renderOpsShell } from './ops-shell.js';
import { renderOpsCompactBar } from './compact-page-bar.js';

export function renderOpsHealthPage({ authRequired = true, auth = null, focus = null } = {}) {
  const bar = renderOpsCompactBar({
    mainHtml: '<p class="ops-compact-bar-lead">Kanal bağlantılarının, stok uyumunun ve altyapının genel özeti.</p>'
  });

  const bodyHtml = `
    <div class="ops-health-page ops-compact-page pf-unified-page">
      <section class="ops-panel ops-compact-page-panel">
        ${bar}
      </section>

      <section class="ops-panel">
        <header class="ops-panel-head ops-panel-head--compact">
          <h3>Altyapı</h3>
        </header>
        <div id="infraStatus" class="ops-health-grid"></div>
      </section>

      <section class="ops-panel">
        <header class="ops-panel-head ops-panel-head--compact">
          <h3>Kanal sağlığı</h3>
        </header>
        <div id="channelHealth" class="ops-health-grid"></div>
      </section>

      <section class="ops-panel">
        <header class="ops-panel-head ops-panel-head--compact">
          <div>
            <h3>Stok uyumu</h3>
            <p class="ops-panel-sub">BenimPOS master stok ile kanal stoklarının karşılaştırması</p>
          </div>
        </header>
        <div class="ops-chip-row" id="stockChannelFilters" role="group" aria-label="Stok kanalı">
          <button type="button" class="ops-chip is-active" data-channel="trendyol_go">Trendyol Go</button>
          <button type="button" class="ops-chip" data-channel="yemeksepeti">Yemeksepeti</button>
        </div>
        <div id="stockSummary" class="ops-kpi-row" style="margin-top:12px"></div>
        <div id="stockDriftTable" class="ops-card-grid" style="margin-top:12px"></div>
        <p id="stockEmpty" class="ops-meta hidden">Bu kanal için stok farkı bulunamadı.</p>
        <p id="stockNote" class="ops-meta"></p>
      </section>

      <section class="ops-panel">
        <header class="ops-panel-head ops-panel-head--compact">
          <h3>Dikkat gerektiren konular</h3>
        </header>
        <ul id="issueList" class="ops-steps"></ul>
        <p id="issueEmpty" class="ops-meta hidden">Şu an kritik sorun görünmüyor.</p>
      </section>

      <details class="ops-panel ops-collapsible">
        <summary>Yönetici detayı</summary>
        <div class="ops-collapsible-body">
          <pre id="healthRaw" class="ops-meta" style="white-space:pre-wrap;font-size:0.78rem;background:#f8fafc;padding:12px;border-radius:8px"></pre>
        </div>
      </details>
    </div>`;

  return renderOpsShell({
    title: focus === 'errors' ? 'Hatalı İşlemler' : 'Sistem Sağlığı',
    activeNav: focus === 'errors' ? 'errors' : 'health',
    auth,
    suppressPageHeader: true,
    bootstrapVar: '__OPS_HEALTH__',
    bootstrapData: { authRequired, focus },
    bodyHtml,
    scripts: ['/assets/ops-health.js']
  });
}
