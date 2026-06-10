import { renderPetfixShell } from '../../panel/shell/petfix-shell.js';

const NAV_TO_ITEM = {
  panel: 'overview',
  orders: 'picking',
  picking: 'picking',
  integrations: 'integrations',
  health: 'health',
  errors: 'errors'
};

export function renderOpsShell({
  title,
  activeNav = 'picking',
  shellMode,
  bootstrapVar = '__OPS__',
  bootstrapData = { authRequired: true },
  bodyHtml = '',
  scripts = [],
  auth = null
} = {}) {
  const activeItem = NAV_TO_ITEM[activeNav] || activeNav || 'overview';
  const isMinimal = shellMode === 'ops-minimal' || activeItem === 'picking';

  const modeBanner = `
  <div id="modeBanner" class="ops-mode-banner ops-mode-banner--shadow hidden" role="status">
    <span class="ops-mode-banner-icon" aria-hidden="true">◐</span>
    <span id="modeBannerText">Eğitim modu — gerçek kanal ve kasa işlemi yapılmaz</span>
  </div>`;

  const confirmModal = `
  <div id="confirmModal" class="ops-modal hidden" role="dialog" aria-modal="true" aria-labelledby="confirmModalTitle">
    <div class="ops-modal-backdrop" data-dismiss="modal"></div>
    <div class="ops-modal-panel">
      <h2 id="confirmModalTitle" class="ops-modal-title">Onay gerekli</h2>
      <p id="confirmModalBody" class="ops-modal-body"></p>
      <div class="ops-modal-actions">
        <button type="button" id="confirmModalCancel" class="ops-btn ops-btn-secondary">Vazgeç</button>
        <button type="button" id="confirmModalOk" class="ops-btn ops-btn-danger">Onayla</button>
      </div>
    </div>
  </div>`;

  const pageTitle = title.replace(/^PetFix Ops — /, '').replace(/^PetFix Panel — /, '');
  const pageHeader = isMinimal
    ? ''
    : `<header class="pf-page-header pf-page-header--qc">
        <div>
          <p class="pf-page-eyebrow">Hızlı Teslimat</p>
          <h1>${pageTitle}</h1>
        </div>
      </header>`;

  return renderPetfixShell({
    title,
    activeModule: 'quickCommerce',
    activeItem,
    bodyHtml: `${modeBanner}${pageHeader}${bodyHtml}${confirmModal}<div id="toast" class="ops-toast"></div>`,
    bodyClass: 'pf-qc-page ops-body',
    bootstrapVar,
    bootstrapData,
    auth,
    showBranchSelector: !isMinimal,
    shellMode: isMinimal ? 'ops-minimal' : 'full',
    stylesheets: [
      '/assets/ops-tokens.css',
      '/assets/ops-components.css'
    ],
    scripts: [
      '/assets/ops-common.js',
      ...scripts
    ]
  });
}
