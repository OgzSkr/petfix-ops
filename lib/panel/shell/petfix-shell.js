import { escapeHtml, jsonForHtml } from '../../platform/views/format.js';
import { PLATFORM_NAME, PLATFORM_SHORT } from '../../platform/brand.js';
import {
  listPanelModules,
  PANEL_MODULES,
  QC_PICKING_NAV_IDS,
  MARKETPLACE_SIDEBAR_NAV_IDS
} from '../nav-config.js';
import { renderLogoutButton } from '../../platform/views/nav.js';

const NAV_ICONS = {
  overview: '◫',
  'channel-uber': '◫',
  'channel-ys': '◫',
  'channel-woo': '◫',
  'channel-getir': '◫',
  pool: '▦',
  inbox: '▤',
  mappings: '⎔',
  quality: '◉',
  trendyol: '◈',
  buybox: '◆',
  profit: '₺',
  orders: '▣',
  products: '▦',
  shipping: '⎘',
  reports: '▥',
  'qc-overview': '◫',
  'qc-orders': '▣',
  'qc-picking': '▤',
  'qc-couriers': '⎔',
  'qc-integrations': '⎔',
  'qc-errors': '⚠',
  'qc-health': '◉',
  'mn-dashboard': '◫',
  'mn-orders': '▣',
  'mn-matching': '⎔',
  'mn-sync': '↻',
  branches: '⌂',
  users: '👤',
  status: '◉',
  settings: '⚙'
};

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
    const cls = isActive ? ' pf-nav-link is-active' : ' pf-nav-link';
    const icon = NAV_ICONS[item.icon] || '•';
    const badge = item.badgeKey
      ? ` <span class="pf-nav-badge" data-badge="${escapeHtml(item.badgeKey)}" hidden></span>`
      : '';
    const tag = item.tag
      ? ` <span class="pf-nav-tag">${escapeHtml(item.tag)}</span>`
      : '';
    return `<a class="${cls.trim()}" href="${escapeHtml(item.href)}" data-nav="${escapeHtml(item.id)}">
      <span class="pf-nav-icon" aria-hidden="true">${icon}</span>
      <span class="pf-nav-label">${escapeHtml(item.label)}</span>${tag}${badge}
    </a>`;
  }).join('');

  return `<div class="pf-nav-group">
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
    '/assets/panel-tokens.css',
    '/assets/panel-shell.css',
    '/assets/panel-components.css',
    '/assets/channel-logos.css?v=62',
    ...stylesheets
  ].map((href) => `<link rel="stylesheet" href="${href}">`).join('\n  ');

  const scriptTags = [
    '<script src="/assets/common.js"></script>',
    '<script src="/assets/channel-logos.js?v=62"></script>',
    '<script src="/assets/panel-common.js"></script>',
    ...scripts.map((src) => `<script src="${src}"></script>`)
  ].join('\n  ');

  const branchBlock = showBranchSelector && !minimal
    ? `<div class="pf-sidebar-foot">
        <label class="pf-branch-label" for="branchSelect">Şube</label>
        <select id="branchSelect" class="pf-select pf-branch-select" disabled>
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
<body class="pf-body ${minimal ? 'pf-body--ops-minimal' : ''} ${escapeHtml(bodyClass)}">
  <div class="pf-layout">
    <aside class="pf-sidebar" aria-label="Ana menü">
      <div class="pf-sidebar-brand">
        <span class="pf-brand-mark">PF</span>
        <div>
          <strong>PetFix Panel</strong>
          <small>${escapeHtml(PLATFORM_NAME)}</small>
        </div>
      </div>
      <div class="pf-nav">${navHtml}</div>
      ${branchBlock}
      <div class="pf-sidebar-help">
        <p>Yardım &amp; Destek</p>
        <small>Operasyon ve eşleştirme rehberi</small>
      </div>
    </aside>

    <div class="pf-main-wrap">
      <header class="pf-topbar">
        <button type="button" id="pfNavToggle" class="pf-icon-btn pf-nav-toggle" aria-label="Menüyü aç/kapat">☰</button>
        <div class="pf-topbar-search-wrap">
          <input type="search" class="pf-topbar-search" id="pfGlobalSearch" placeholder="Ürün, barkod veya stok kodu ara…" aria-label="Genel arama">
        </div>
        <div class="pf-topbar-actions">
          ${topbarActionsHtml}
          <button type="button" id="pfRefreshBtn" class="pf-btn pf-btn-ghost-sm">Yenile</button>
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
