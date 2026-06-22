/**
 * Sipariş sayfalarında paylaşılan BenimPOS satış UI parçaları.
 */
export function renderBenimposSaleFragment(enabled) {
  if (!enabled) {
    return { modal: '', script: '' };
  }

  const modal = `
      <div class="orders-modal-backdrop" id="benimposSaleBackdrop">
        <div class="orders-modal benimpos-sale-modal" role="dialog" aria-modal="true">
          <div class="orders-modal-head">
            <h3 id="benimposSaleTitle">BenimPOS Satış Ön İzleme</h3>
            <button type="button" class="orders-modal-close" id="benimposSaleClose" aria-label="Kapat">×</button>
          </div>
          <div class="orders-modal-body" id="benimposSaleBody">
            <p class="muted">Yükleniyor…</p>
          </div>
          <div class="benimpos-sale-actions" id="benimposSaleActions" hidden>
            <button type="button" class="btn btn-ghost" id="benimposSaleCancel">İptal</button>
            <button type="button" class="btn-green" id="benimposSaleConfirm" disabled>BenimPOS'a Gönder</button>
          </div>
        </div>
      </div>`;

  const script = '<script src="/assets/benimpos-sale-modal.js?v=14" defer></script>';

  return { modal, script };
}

export function renderBenimposReadinessBanner() {
  return '<div id="benimposReadinessBanner" class="benimpos-readiness-banner" hidden></div>';
}
