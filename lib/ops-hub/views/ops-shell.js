import { renderPetfixShell } from '../../panel/shell/petfix-shell.js';
import { PANEL_MODULES } from '../../panel/nav-config.js';
import { renderPageGuideBlock } from '../../panel/page-guides.js';

const NAV_TO_ITEM = {
  panel: 'dashboard',
  dashboard: 'dashboard',
  orders: 'orders',
  reports: 'reports',
  customers: 'customers',
  picking: 'picking',
  integrations: 'integrations',
  system: 'system',
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
  extraStylesheets = [],
  auth = null,
  suppressPageGuide = false,
  suppressPageHeader = false
} = {}) {
  const activeItem = NAV_TO_ITEM[activeNav] || activeNav || 'overview';
  const isMinimal = shellMode === 'ops-minimal' || activeItem === 'picking';

  const modeBanner = `
  <div id="modeBanner" class="ops-mode-banner ops-mode-banner--shadow hidden" role="status">
    <span class="ops-mode-banner-icon" aria-hidden="true">◐</span>
    <span id="modeBannerText">Eğitim modu — deneme ortamı; gerçek sipariş ve kasa işlemi yapılmaz</span>
  </div>`;

  const confirmModal = `
  <div id="confirmModal" class="ops-modal hidden" role="dialog" aria-modal="true" aria-labelledby="confirmModalTitle">
    <div class="ops-modal-backdrop" data-dismiss="modal"></div>
    <div class="ops-modal-panel">
      <h2 id="confirmModalTitle" class="ops-modal-title">Onay gerekli</h2>
      <p id="confirmModalBody" class="ops-modal-body"></p>
      <div class="ops-modal-actions">
        <button type="button" id="confirmModalCancel" class="ops-btn ops-btn-secondary">Hayır, vazgeç</button>
        <button type="button" id="confirmModalOk" class="ops-btn ops-btn-danger">Evet, onayla</button>
      </div>
    </div>
  </div>`;

  const pageTitle = title
    .replace(/^PetFix Ops — /, '')
    .replace(/^PetFix Panel — /, '')
    .replace(/^HzlMrktOps — /, '');
  const moduleLabel = PANEL_MODULES.hzlmrktops?.label || 'HzlMrktOps';
  const pageGuide = isMinimal || suppressPageGuide ? '' : renderPageGuideBlock(activeItem);
  const pageHeader = isMinimal || suppressPageHeader
    ? ''
    : `<header class="pf-page-header pf-page-header--qc">
        <div>
          <p class="pf-page-eyebrow">${moduleLabel}</p>
          <h1>${pageTitle}</h1>
        </div>
      </header>`;

  return renderPetfixShell({
    title: pageTitle,
    activeModule: 'hzlmrktops',
    activeItem,
    bodyHtml: `${modeBanner}${pageHeader}${pageGuide}${bodyHtml}${confirmModal}<div id="toast" class="ops-toast"></div>`,
    bodyClass: 'pf-qc-page ops-body pf-unified-page',
    bootstrapVar,
    bootstrapData,
    auth,
    showBranchSelector: !isMinimal,
    shellMode: isMinimal ? 'ops-minimal' : 'full',
    stylesheets: [
      '/assets/ops-tokens.css?v=2',
      '/assets/ops-components.css?v=6',
      '/assets/panel-unified.css?v=4',
      '/assets/channel-logos.css',
      ...extraStylesheets
    ],
    scripts: [
      '/assets/ops-common.js?v=3',
      ...scripts
    ]
  });
}
