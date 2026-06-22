import { escapeHtml, jsonForHtml } from '../../platform/views/format.js';
import { PLATFORM_NAME, PLATFORM_SHORT, PLATFORM_LOGO } from '../../platform/brand.js';
import {
  listPanelModules,
  PANEL_MODULES,
  QC_PICKING_NAV_IDS,
  MARKETPLACE_SIDEBAR_NAV_IDS
} from '../nav-config.js';
import { renderLogoutButton } from '../../platform/views/nav.js';
import { renderNavIconSvg } from './nav-icons.js';

function renderNavSection(module, activeModule, activeItem, { minimal = false } = {}) {
  if (minimal && module.id !== 'hzlmrktops') return '';
  if (minimal && module.id === 'hzlmrktops') {
    const items = module.items.filter((item) => QC_PICKING_NAV_IDS.has(item.id));
    if (!items.length) return '';
    return renderNavGroup(module.label, items, activeModule, activeItem);
  }
  let items = module.items;
  if (module.id === 'marketplace') {
    items = items.filter((item) => MARKETPLACE_SIDEBAR_NAV_IDS.has(item.id));
  }
  const sidebarActiveItem = activeModule === 'marketplace' && module.id === 'marketplace'
    ? 'trendyol'
    : activeItem;
  return renderNavGroup(module.label, items, activeModule, sidebarActiveItem);
}

function renderNavGroup(label, items, activeModule, activeItem) {
  const links = items.map((item) => {
    const isActive = item.id === activeItem;
    const cls = isActive ? 'pf-nav-rail-link is-active' : 'pf-nav-rail-link';
    const badge = item.badgeKey
      ? `<span class="pf-nav-rail-badge" data-badge="${escapeHtml(item.badgeKey)}" hidden></span>`
      : '';
    const railLabel = item.shortLabel || item.label;
    const title = item.hint ? `${item.label} — ${item.hint}` : item.label;
    return `<a class="${cls}" href="${escapeHtml(item.href)}" data-nav="${escapeHtml(item.id)}" title="${escapeHtml(title)}" aria-label="${escapeHtml(item.label)}">
      <span class="pf-nav-rail-icon" aria-hidden="true">${renderNavIconSvg(item.icon)}</span>
      <span class="pf-nav-rail-label pf-nav-rail-label--short" aria-hidden="true">${escapeHtml(railLabel)}</span>
      <span class="pf-nav-rail-label pf-nav-rail-label--full" aria-hidden="true">${escapeHtml(item.label)}</span>${badge}
    </a>`;
  }).join('');

  return `<div class="pf-nav-group" data-nav-group="${escapeHtml(label)}">
    <p class="pf-nav-group-label">${escapeHtml(label)}</p>
    <nav class="pf-nav-group-links" aria-label="${escapeHtml(label)}">${links}</nav>
  </div>`;
}

/**
 * PetFix Panel — birleşik uygulama kabuğu (sol navigasyon).
 */
export function renderPetfixShell({
  title,
  activeModule = 'hzlmrktops',
  activeItem = 'overview',
  bodyHtml = '',
  bodyClass = '',
  bootstrapVar = '__PANEL__',
  bootstrapData = { authRequired: true },
  stylesheets = [],
  scripts = [],
  shellMode = 'full',
  showBranchSelector = true,
  topbarActionsHtml = '',
  auth = null
} = {}) {
  const resolved = PANEL_MODULES[activeModule] || PANEL_MODULES.hzlmrktops;
  const pageTitle = title || resolved.label;
  const minimal = shellMode === 'ops-minimal';

  const navHtml = listPanelModules()
    .map((mod) => renderNavSection(mod, activeModule, activeItem, { minimal }))
    .join('');

  const cssLinks = [
    '/assets/panel-tokens.css?v=6',
    '/assets/panel-shell.css?v=10',
    '/assets/panel-components.css?v=corp5',
      '/assets/panel-unified.css?v=4',
    '/assets/pf-switch.css?v=2',
    '/assets/channel-logos.css?v=62',
    ...stylesheets
  ].map((href) => `<link rel="stylesheet" href="${href}">`).join('\n  ');

  const scriptTags = [
    '<script src="/assets/common.js?v=2"></script>',
    '<script src="/assets/channel-logos.js?v=62"></script>',
    '<script src="/assets/panel-status.js"></script>',
    '<script src="/assets/panel-common.js"></script>',
    ...scripts.map((src) => `<script src="${src}"></script>`)
  ].join('\n  ');

  const branchBlock = showBranchSelector && !minimal
    ? `<div class="pf-topbar-branch">
        <label class="visually-hidden" for="branchSelect">Şube</label>
        <select id="branchSelect" class="pf-select pf-branch-select" disabled title="Şube seçin">
          <option value="main">Merkez Depo</option>
        </select>
      </div>`
    : '';

  return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="robots" content="noindex, nofollow">
  <title>${escapeHtml(pageTitle)} — ${escapeHtml(PLATFORM_SHORT)}</title>
  ${cssLinks}
</head>
<body class="pf-body pf-sidebar-rail ${minimal ? 'pf-body--ops-minimal' : ''} ${escapeHtml(bodyClass)}">
  <div class="pf-layout">
    <aside class="pf-sidebar" aria-label="Ana menü">
      <a class="pf-sidebar-brand" href="/hzlmrktops" title="Ana panele dön">
        <img
          class="pf-brand-logo pf-brand-logo--rail"
          src="${escapeHtml(PLATFORM_LOGO)}"
          alt="PetFix"
          width="40"
          height="40"
          decoding="async"
        >
        <span class="visually-hidden">${escapeHtml(PLATFORM_SHORT)}</span>
      </a>
      <div class="pf-nav">${navHtml}</div>
    </aside>

    <div class="pf-main-wrap">
      <header class="pf-topbar">
        <button type="button" id="pfNavToggle" class="pf-icon-btn pf-nav-toggle" aria-label="Menüyü aç/kapat" aria-expanded="false">☰</button>
        <a class="pf-topbar-brand" href="/hzlmrktops" aria-label="PetFix ana panel">
          <img class="pf-topbar-logo" src="${escapeHtml(PLATFORM_LOGO)}" alt="" width="120" height="29" decoding="async">
        </a>
        <div class="pf-topbar-actions">
          ${branchBlock}
          ${topbarActionsHtml}
          ${auth ? renderLogoutButton(auth) : ''}
        </div>
      </header>

      <main class="pf-content" id="pfContent">
        ${bodyHtml}
      </main>
    </div>
  </div>

  <div id="pfToast" class="pf-toast" role="status"></div>

  <script>window.${bootstrapVar} = ${jsonForHtml(bootstrapData)};</script>
  ${scriptTags}
</body>
</html>`;
}
