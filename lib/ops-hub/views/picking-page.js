import { renderOpsShell } from './ops-shell.js';

export function renderOpsPickingPage({ authRequired = true, auth = null } = {}) {
  const bodyHtml = `
    <section id="listView" class="ops-view">
      <div class="ops-toolbar">
        <h2>Toplama kuyruğu</h2>
        <div class="ops-chip-row" id="channelFilters" role="group" aria-label="Kanal filtresi">
          <button type="button" class="ops-chip is-active" data-channel="">Tümü</button>
          <button type="button" class="ops-chip" data-channel="trendyol_go">Trendyol Go</button>
          <button type="button" class="ops-chip" data-channel="yemeksepeti">Yemeksepeti</button>
          <button type="button" class="ops-chip" data-channel="getir">Getir</button>
        </div>
      </div>
      <div id="queueList" class="ops-card-grid"></div>
      <div id="queueEmpty" class="ops-empty-state hidden">
        <div class="ops-empty-state-icon" aria-hidden="true">📦</div>
        <h3>Toplanacak sipariş yok</h3>
        <p>Yeni sipariş geldiğinde burada görünecek. Liste otomatik yenilenir.</p>
        <button type="button" id="emptyRefreshBtn" class="ops-btn ops-btn-secondary">Yenile</button>
      </div>
    </section>

    <section id="pickView" class="ops-view hidden">
      <button type="button" id="backBtn" class="ops-back">← Kuyruğa dön</button>
      <div class="ops-detail-header">
        <div>
          <h2 id="orderTitle">—</h2>
          <p id="orderMeta" class="ops-meta"></p>
        </div>
        <span id="orderStatus" class="ops-status-badge ops-status-badge--received">—</span>
      </div>
      <div class="ops-progress" aria-hidden="true"><div id="progressFill" class="ops-progress-fill"></div></div>
      <p id="progressText" class="ops-meta"></p>

      <div class="ops-detail-grid">
        <div class="ops-scan-panel">
          <div id="matchingBanner" class="ops-alert ops-alert--warn hidden" role="alert">
            <strong>Ürün eşleştirme gerekli</strong>
            <p class="ops-meta" style="margin:8px 0 10px">Bu siparişte eşleşmemiş veya sorunlu ürün var. Toplamaya devam edebilirsiniz; kasa satışı engellenebilir.</p>
            <a href="/products/inbox" class="ops-btn ops-btn-secondary" style="display:inline-flex;text-decoration:none">Ürün Merkezi</a>
          </div>
          <form id="scanForm" autocomplete="off">
            <label for="barcodeInput">Barkod okut</label>
            <div class="ops-scan-row">
              <input id="barcodeInput" class="ops-input" type="text" inputmode="numeric" autocomplete="off" placeholder="Barkodu okutun veya yazın">
              <button type="submit" class="ops-btn ops-btn-primary">Ekle</button>
            </div>
          </form>
          <p id="scanFeedback" class="ops-feedback" aria-live="polite"></p>

          <div class="ops-action-bar" id="pickActions">
            <button type="button" id="startPickBtn" class="ops-btn ops-btn-secondary">Toplamayı başlat</button>
            <button type="button" id="completePickBtn" class="ops-btn ops-btn-primary" disabled>Toplamayı bitir</button>
          </div>
        </div>

        <div>
          <h3 class="ops-meta" style="margin:0 0 10px;font-weight:700;color:var(--ops-text-primary)">Ürün listesi</h3>
          <ul id="linesList" class="ops-lines"></ul>
        </div>
      </div>

      <section id="channelActions" class="ops-locked-section hidden">
        <h3><span class="ops-lock-icon" aria-hidden="true">🔒</span> Kanal bildirimi</h3>
        <p id="channelFlagHint" class="ops-meta"></p>
        <div class="ops-action-bar">
          <button type="button" id="channelAcceptBtn" class="ops-btn ops-btn-secondary" disabled>Kabul bildir</button>
          <button type="button" id="channelReadyBtn" class="ops-btn ops-btn-primary" disabled>Hazır bildir</button>
        </div>
      </section>

      <section id="benimposActions" class="ops-locked-section hidden">
        <h3><span class="ops-lock-icon" aria-hidden="true">🔒</span> Kasa satışı</h3>
        <p id="benimposFlagHint" class="ops-meta"></p>
        <p id="benimposSalesHint" class="ops-meta"></p>
        <div class="ops-action-bar ops-action-bar--single" style="grid-template-columns:repeat(3,1fr)">
          <button type="button" id="benimposPreviewBtn" class="ops-btn ops-btn-secondary">Önizle</button>
          <button type="button" id="benimposSaleBtn" class="ops-btn ops-btn-primary" disabled>Satış oluştur</button>
          <button type="button" id="benimposCancelBtn" class="ops-btn ops-btn-secondary" disabled>Satış iptal</button>
        </div>
      </section>
    </section>`;

  return renderOpsShell({
    title: 'Toplama Kuyruğu',
    activeNav: 'picking',
    shellMode: 'ops-minimal',
    auth,
    bootstrapVar: '__OPS_PICKING__',
    bootstrapData: { authRequired },
    bodyHtml,
    scripts: ['/assets/ops-picking.js']
  });
}
