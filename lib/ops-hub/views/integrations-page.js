import { renderOpsShell } from './ops-shell.js';
import { renderOpsInfoDisclosure } from './info-disclosure.js';
import { renderOpsCompactBar, renderOpsStatPills } from './compact-page-bar.js';

export function renderOpsIntegrationsPage({ authRequired = true, auth = null } = {}) {
  const infoBlocks = [
    renderOpsInfoDisclosure({
      id: 'intInfoChannels',
      title: 'Kanal durumları',
      items: [
        'Bağlı: API testi geçti, sipariş alımına hazır.',
        'Hazır: bilgiler tamam — bağlantı testi ile doğrulayın.',
        'Eksik / Hata: kurulum adımları tamamlanmalı.'
      ]
    }),
    renderOpsInfoDisclosure({
      id: 'intInfoPoll',
      title: 'Otomatik sipariş çekme',
      paragraphs: [
        'Webhook gelmeyen kanallar için yedek senkron çalışır. “2 dk aralık” sunucunun partner API’lerini ne sıklıkla kontrol ettiğini ifade eder; anlık bildirim yerine geçmez.'
      ]
    }),
    renderOpsInfoDisclosure({
      id: 'intInfoShadow',
      title: 'Eğitim modu',
      paragraphs: [
        'Eğitim modunda kanallara gerçek yazma (kabul, stok, kasa) yapılmaz. Otomatik kabul ve canlı entegrasyon ayarları kilitlenir.'
      ]
    })
  ].join('');

  const listBar = renderOpsCompactBar({
    sideHtml: `${renderOpsStatPills([
      { id: 'intStatTotal', label: 'kanal' },
      { id: 'intStatConnected', label: 'bağlı' },
      { id: 'intStatAttention', label: 'dikkat', muted: true, valueClass: 'ops-compact-stat-value--sm' }
    ])}${infoBlocks}`
  });

  const bodyHtml = `
    <div class="ops-integrations-page ops-compact-page pf-unified-page">
      <section id="listView" class="ops-view">
        <section class="ops-panel ops-compact-page-panel ops-int-panel">
          ${listBar}
          <p class="ops-order-profit-note">Getir, Yemeksepeti ve Trendyol Go mağazalarınızı bağlayın; kurulum adımlarını takip edin.</p>
          <div id="integrationCards" class="ops-int-grid">Yükleniyor…</div>
        </section>

        <section id="setupAlerts" class="ops-panel ops-int-alert-panel hidden">
          <header class="ops-panel-head">
            <div>
              <h3>Tamamlanması gereken kurulumlar</h3>
              <p class="ops-panel-sub">Aşağıdaki kanallarda eksik adım var</p>
            </div>
          </header>
          <ul id="setupAlertsList" class="ops-steps ops-int-alert-list"></ul>
        </section>

        <details class="ops-panel ops-collapsible ops-int-automation-panel">
          <summary class="ops-int-automation-summary">
            <span>Otomatik sipariş ve ürün güncelleme</span>
            <span class="ops-collapsible-badge">isteğe bağlı</span>
          </summary>
          <div class="ops-collapsible-body">
            <p class="ops-meta">Bu ayarlar arka planda sipariş çekme ve ürün listesi güncelleme işlerini yönetir. Günlük kullanımda değiştirmeniz gerekmez.</p>
            <div id="workerPanelBody" class="ops-int-worker-status">Yükleniyor…</div>
            <div class="ops-int-worker-grid">
              <label class="ops-check">
                <input type="checkbox" id="pollEnabledToggle">
                Siparişleri otomatik çek
              </label>
              <label class="ops-field ops-int-interval-field">
                <span class="ops-field-label">Kontrol aralığı (dakika)</span>
                <input type="number" id="pollIntervalInput" min="1" max="120" value="2">
              </label>
              <label class="ops-check">
                <input type="checkbox" id="matchingEnabledToggle">
                Ürün listesini otomatik güncelle
              </label>
            </div>
            <div class="ops-int-action-bar">
              <button type="button" id="saveWorkerSettingsBtn" class="ops-btn ops-btn-primary">Ayarları kaydet</button>
              <button type="button" id="runPollBtn" class="ops-btn ops-btn-secondary">Şimdi sipariş çek</button>
              <button type="button" id="runMatchingBtn" class="ops-btn ops-btn-secondary">Şimdi ürün güncelle</button>
              <button type="button" id="runDailyBtn" class="ops-btn ops-btn-secondary">Gün sonu senkron</button>
            </div>
            <p id="workerActionResult" class="ops-feedback" aria-live="polite"></p>
          </div>
        </details>
      </section>

      <section id="detailView" class="ops-view ops-int-detail hidden">
        <button type="button" id="backBtn" class="ops-back ops-int-back">← Kanallara dön</button>

        <div class="ops-int-detail-hero">
          <div class="ops-int-detail-brand">
            <span id="detailLogo" class="ops-int-detail-logo" aria-hidden="true"></span>
            <div>
              <h2 id="detailTitle">—</h2>
              <p id="detailSummary" class="ops-meta"></p>
            </div>
          </div>
          <span id="detailStatus" class="ops-int-pill missing">—</span>
        </div>

        <div id="prerequisiteBox" class="ops-alert ops-alert--warn hidden"></div>

        <section class="ops-panel ops-int-detail-panel">
          <header class="ops-panel-head">
            <div>
              <h3>Mağaza ayarları</h3>
              <p class="ops-panel-sub">Sipariş alımı ve otomatik kabul</p>
            </div>
          </header>
          <p id="detailOpsNote" class="ops-meta ops-int-detail-note"></p>
          <label class="ops-check">
            <input type="checkbox" id="enabledToggle" name="enabled">
            Bu mağazadan sipariş al
          </label>
          <label class="ops-check" id="autoAcceptWrap">
            <input type="checkbox" id="autoAcceptOrders" name="autoAcceptOrders">
            Gelen siparişleri otomatik kabul et
          </label>
        </section>

        <section id="setupChecklist" class="ops-panel ops-int-detail-panel hidden">
          <header class="ops-panel-head ops-panel-head--split">
            <div>
              <h3 id="setupChecklistTitle">Kurulum adımları</h3>
              <p class="ops-panel-sub">Partner panelinde tamamlanması gerekenler</p>
            </div>
            <span id="setupChecklistProgress" class="ops-meta"></span>
          </header>
          <ol id="setupChecklistItems" class="ops-steps ops-steps--checklist"></ol>
        </section>

        <section class="ops-panel ops-int-detail-panel">
          <header class="ops-panel-head">
            <div>
              <h3>Kurulum rehberi</h3>
              <p class="ops-panel-sub">Adım adım partner paneli yönlendirmesi</p>
            </div>
          </header>
          <ol id="guideSteps" class="ops-steps"></ol>
          <p class="ops-int-portal-link">
            <a id="portalLink" class="ops-btn ops-btn-secondary" href="#" target="_blank" rel="noopener">Partner panelini aç</a>
          </p>
        </section>

        <section id="webhookSetup" class="ops-panel ops-int-detail-panel hidden">
          <header class="ops-panel-head">
            <div>
              <h3>Partner paneline yapıştırılacak adresler</h3>
              <p class="ops-panel-sub">Webhook URL ve gizli anahtarlar</p>
            </div>
          </header>
          <div id="webhookFields"></div>
        </section>

        <details class="ops-panel ops-collapsible ops-int-detail-panel" id="advancedSettings">
          <summary>Bağlantı bilgileri (API anahtarları)</summary>
          <div class="ops-collapsible-body">
            <p class="ops-meta ops-safe-note">Değişiklikler kaydedilene kadar uygulanmaz. Önce “Bağlantı testi” ile doğrulayabilirsiniz.</p>
            <form id="configForm">
              <div id="formFields" class="ops-int-form-fields"></div>
              <div class="ops-int-action-bar">
                <button type="button" id="testBtn" class="ops-btn ops-btn-secondary">Bağlantı testi</button>
                <button type="submit" id="saveBtn" class="ops-btn ops-btn-primary">Kaydet</button>
              </div>
            </form>
            <p id="testResult" class="ops-feedback" aria-live="polite"></p>
          </div>
        </details>

        <details class="ops-panel ops-collapsible ops-int-detail-panel" id="adminDetails">
          <summary>Teknik detaylar</summary>
          <div class="ops-collapsible-body">
            <section id="capabilitiesSection">
              <h4 class="ops-int-subheading">Desteklenen işlemler</h4>
              <div id="capabilitiesPanel" class="ops-meta">—</div>
            </section>
            <p id="detailGate" class="ops-meta"></p>
            <p id="detailLastTest" class="ops-meta"></p>
          </div>
        </details>
      </section>
    </div>`;

  return renderOpsShell({
    title: 'Kanallar',
    activeNav: 'integrations',
    suppressPageGuide: true,
    suppressPageHeader: true,
    auth,
    bootstrapVar: '__OPS_INTEGRATIONS__',
    bootstrapData: { authRequired },
    bodyHtml,
    scripts: ['/assets/ops-integrations.js?v=6']
  });
}
