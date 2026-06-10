import { renderOpsShell } from './ops-shell.js';

export function renderOpsIntegrationsPage({ authRequired = true, auth = null } = {}) {
  const bodyHtml = `
    <section id="listView" class="ops-view">
      <div class="ops-toolbar">
        <h2>Kanal bağlantıları</h2>
      </div>
      <p class="ops-meta" style="margin-bottom:16px">Mağazanızın sipariş kanallarının durumunu buradan takip edin.</p>
      <div id="integrationCards" class="ops-int-grid"></div>
      <div id="setupAlerts" class="ops-section hidden">
        <h3>Kurulum bekleyen kanallar</h3>
        <ul id="setupAlertsList" class="ops-steps"></ul>
      </div>
    </section>

    <section id="detailView" class="ops-view hidden">
      <button type="button" id="backBtn" class="ops-back">← Kanallara dön</button>
      <div class="ops-detail-header">
        <div>
          <h2 id="detailTitle">—</h2>
          <p id="detailSummary" class="ops-meta"></p>
        </div>
        <span id="detailStatus" class="ops-int-pill missing">—</span>
      </div>
      <div id="prerequisiteBox" class="ops-alert ops-alert--warn hidden"></div>

      <section class="ops-section">
        <h3>Günlük durum</h3>
        <p id="detailOpsNote" class="ops-meta"></p>
        <label class="ops-check">
          <input type="checkbox" id="enabledToggle" name="enabled">
          Kanal etkin
        </label>
        <label class="ops-check" id="autoAcceptWrap">
          <input type="checkbox" id="autoAcceptOrders" name="autoAcceptOrders">
          Gelen siparişleri otomatik kabul et
        </label>
      </section>

      <section id="setupChecklist" class="ops-section hidden">
        <div class="ops-checklist-head">
          <h3 id="setupChecklistTitle">Kurulum kontrol listesi</h3>
          <span id="setupChecklistProgress" class="ops-meta"></span>
        </div>
        <ol id="setupChecklistItems" class="ops-steps ops-steps--checklist"></ol>
      </section>

      <section class="ops-section">
        <h3>Kurulum rehberi</h3>
        <ol id="guideSteps" class="ops-steps"></ol>
        <p style="margin-top:12px"><a id="portalLink" class="ops-btn ops-btn-secondary" href="#" target="_blank" rel="noopener" style="display:inline-flex;text-decoration:none">Partner portalını aç</a></p>
      </section>

      <section id="webhookSetup" class="ops-section hidden">
        <h3>Webhook bilgileri</h3>
        <p class="ops-meta">Bu adresleri ilgili partner portalına yapıştırın.</p>
        <div id="webhookFields"></div>
      </section>

      <details class="ops-section ops-collapsible" id="advancedSettings">
        <summary>Gelişmiş ayarlar</summary>
        <div class="ops-collapsible-body">
          <form id="configForm">
            <div id="formFields"></div>
            <div class="ops-action-bar" style="margin-top:12px">
              <button type="button" id="testBtn" class="ops-btn ops-btn-secondary">Bağlantı testi</button>
              <button type="submit" id="saveBtn" class="ops-btn ops-btn-primary">Kaydet</button>
            </div>
          </form>
          <p id="testResult" class="ops-feedback" aria-live="polite"></p>
        </div>
      </details>

      <details class="ops-section ops-collapsible" id="adminDetails">
        <summary>Yönetici detayı</summary>
        <div class="ops-collapsible-body">
          <p id="detailGate" class="ops-meta"></p>
          <p id="detailLastTest" class="ops-meta"></p>
        </div>
      </details>
    </section>`;

  return renderOpsShell({
    title: 'Kanal Entegrasyonları',
    activeNav: 'integrations',
    auth,
    bootstrapVar: '__OPS_INTEGRATIONS__',
    bootstrapData: { authRequired },
    bodyHtml,
    scripts: ['/assets/ops-integrations.js']
  });
}
