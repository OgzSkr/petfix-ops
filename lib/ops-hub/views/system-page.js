import { renderOpsShell } from './ops-shell.js';
import { renderOpsInfoDisclosure } from './info-disclosure.js';
import { renderOpsCompactBar, renderOpsStatPills } from './compact-page-bar.js';

export function renderOpsSystemPage({ authRequired = true, auth = null } = {}) {
  const infoBlocks = [
    renderOpsInfoDisclosure({
      id: 'systemInfoMode',
      title: 'Eğitim ve canlı mod',
      items: [
        'Eğitim modunda kanal ve kasa yazmaları engellenir.',
        'Canlı modda açık feature flag’ler gerçek işlem yapar.',
        'Mod değişikliği ortam değişkenleri üzerinden yönetilir.'
      ]
    }),
    renderOpsInfoDisclosure({
      id: 'systemInfoAutomation',
      title: 'Arka plan işleri',
      paragraphs: [
        'Sipariş poll, ürün sync ve fiyat takip servisi burada özetlenir. Zamanlama ayarları Kanallar sayfasındaki otomasyon bölümündedir.'
      ]
    })
  ].join('');

  const bar = renderOpsCompactBar({
    sideHtml: `${renderOpsStatPills([
      { id: 'systemHeroMode', label: 'mod', muted: true, valueClass: 'ops-compact-stat-value--sm' },
      { id: 'systemHeroFlags', label: 'aktif bayrak' },
      { id: 'systemHeroEvents', label: 'son hareket', muted: true, valueClass: 'ops-compact-stat-value--sm' }
    ])}${infoBlocks}`
  });

  const bodyHtml = `
    <div class="ops-system-page ops-compact-page pf-unified-page">
      <section class="ops-panel ops-compact-page-panel">
        ${bar}
        <p class="ops-order-profit-note">Çalışma modu, otomasyon durumu ve son sistem olaylarını tek ekranda izleyin.</p>
      </section>

      <section class="ops-panel ops-system-mode-panel" id="systemModeSection">
        <header class="ops-panel-head">
          <div>
            <h3>Çalışma modu ve bayraklar</h3>
            <p class="ops-panel-sub">Eğitim / canlı ve feature flag durumu</p>
          </div>
        </header>
        <div class="ops-system-mode-card" id="systemModeCard">
          <div class="ops-system-mode-head">
            <span class="ops-system-mode-pill ops-system-mode-pill--shadow" id="systemModePill">—</span>
            <div>
              <strong id="systemModeLabel">Yükleniyor…</strong>
              <p class="ops-meta" id="systemModeHint"></p>
            </div>
          </div>
          <div class="ops-flag-grid" id="systemFlagGrid"></div>
        </div>
      </section>

      <div class="ops-system-grid">
        <section class="ops-panel ops-system-panel">
          <header class="ops-panel-head">
            <div>
              <h3>Arka plandaki işler</h3>
              <p class="ops-panel-sub">Poll, ürün sync ve worker durumu</p>
            </div>
          </header>
          <div class="ops-health-grid ops-system-automation-grid" id="systemAutomationGrid"></div>
        </section>

        <section class="ops-panel ops-system-panel">
          <header class="ops-panel-head ops-panel-head--split">
            <div>
              <h3>Son hareketler</h3>
              <p class="ops-panel-sub">Webhook, poll ve sync olayları</p>
            </div>
            <a href="/hzlmrktops/integrations" class="ops-btn ops-btn-ghost-sm">Otomasyon ayarları</a>
          </header>
          <ul class="ops-activity-feed ops-system-activity" id="systemActivityFeed">
            <li class="ops-meta">Yükleniyor…</li>
          </ul>
        </section>
      </div>
    </div>`;

  return renderOpsShell({
    title: 'Sistem Nabzı',
    activeNav: 'system',
    suppressPageGuide: true,
    suppressPageHeader: true,
    auth,
    bootstrapVar: '__OPS_SYSTEM__',
    bootstrapData: { authRequired },
    bodyHtml,
    scripts: ['/assets/ops-system.js?v=7']
  });
}
