import { envValue } from '../env.js';
import { HZLMRKTOPS_BASE } from '../hzlmrktops/constants.js';
import { listPanelModules, PANEL_MODULES } from '../panel/nav-config.js';

export const DEPLOY_PROFILE = Object.freeze({
  FULL: 'full',
  OPS_ONLY: 'ops-only'
});

/** Bu repoda (petfix-ops) artık sunulmayan pazaryeri sayfaları */
const LEGACY_MARKETPLACE_PAGE_PREFIXES = [
  '/marketplace',
  '/trendyol'
];

const LEGACY_MARKETPLACE_PAGE_EXACT = new Set([
  '/komisyon-tarifesi',
  '/trendyol-legacy',
  '/siparisler',
  '/urunler'
]);

/** petfix-marketplace (:8788) reposuna taşınan API'ler — profilden bağımsız engellenir */
const LEGACY_MARKETPLACE_API_PREFIXES = [
  '/api/buybox',
  '/api/live-buybox',
  '/api/sync-buybox-cache',
  '/api/commission-tariff',
  '/api/live-status',
  '/api/worker/',
  '/api/auto-track',
  '/api/dhl-settings',
  '/api/trendyol-settings',
  '/api/orders',
  '/api/products',
  '/api/costs',
  '/api/email-'
];

const LEGACY_MARKETPLACE_API_EXACT = new Set([
  '/api/dashboard',
  '/api/product-matching/sync-trendyol-catalog',
  '/api/dashboard/live-performance',
  '/api/dashboard/pricing-kpis',
  '/api/orders/export'
]);

const OPS_ONLY_PANEL_MODULES = new Set(['hzlmrktops', 'admin']);

let cachedDeployProfile = null;

export function setCachedDeployProfile(profile) {
  cachedDeployProfile = profile || DEPLOY_PROFILE.OPS_ONLY;
}

export function getCachedDeployProfile() {
  return cachedDeployProfile || DEPLOY_PROFILE.OPS_ONLY;
}

export function resolveDeployProfile(platformEnv = {}, processEnv = process.env) {
  const raw = envValue(processEnv, platformEnv, 'DEPLOY_PROFILE', DEPLOY_PROFILE.OPS_ONLY)
    .trim()
    .toLowerCase();
  if (raw === DEPLOY_PROFILE.FULL || raw === 'full') {
    return DEPLOY_PROFILE.FULL;
  }
  return DEPLOY_PROFILE.OPS_ONLY;
}

export function isOpsOnlyDeploy(platformEnv = {}, processEnv = process.env) {
  return resolveDeployProfile(platformEnv, processEnv) === DEPLOY_PROFILE.OPS_ONLY;
}

export function listVisiblePanelModules(deployProfile = DEPLOY_PROFILE.OPS_ONLY) {
  if (deployProfile !== DEPLOY_PROFILE.OPS_ONLY) {
    return listPanelModules();
  }
  return listPanelModules().filter((mod) => OPS_ONLY_PANEL_MODULES.has(mod.id));
}

function normalizePath(pathname) {
  if (!pathname || pathname === '/') return '/';
  return pathname.endsWith('/') && pathname.length > 1
    ? pathname.slice(0, -1)
    : pathname;
}

function matchesPrefixList(path, prefixes) {
  return prefixes.some((prefix) => {
    if (prefix.endsWith('/')) return path.startsWith(prefix);
    return path === prefix || path.startsWith(`${prefix}/`);
  });
}

export function isLegacyMarketplacePagePath(pathname) {
  const path = normalizePath(pathname);
  if (LEGACY_MARKETPLACE_PAGE_EXACT.has(path)) return true;
  return matchesPrefixList(path, LEGACY_MARKETPLACE_PAGE_PREFIXES);
}

export function isLegacyMarketplaceApiPath(pathname) {
  const path = normalizePath(pathname);
  if (LEGACY_MARKETPLACE_API_EXACT.has(path)) return true;
  return matchesPrefixList(path, LEGACY_MARKETPLACE_API_PREFIXES);
}

/** @deprecated isLegacyMarketplacePagePath kullanın */
export function isLocalOnlyPagePath(pathname, deployProfile = DEPLOY_PROFILE.OPS_ONLY) {
  if (deployProfile !== DEPLOY_PROFILE.OPS_ONLY) return false;
  return isLegacyMarketplacePagePath(pathname);
}

/** @deprecated isLegacyMarketplaceApiPath kullanın */
export function isLocalOnlyApiPath(pathname, deployProfile = DEPLOY_PROFILE.OPS_ONLY) {
  if (deployProfile !== DEPLOY_PROFILE.OPS_ONLY) return false;
  return isLegacyMarketplaceApiPath(pathname);
}

export function isRouteBlockedInOpsOnly(pathname, deployProfile = DEPLOY_PROFILE.OPS_ONLY) {
  if (deployProfile !== DEPLOY_PROFILE.OPS_ONLY) return false;
  if (!pathname || pathname.startsWith('/assets/')) return false;
  return isLegacyMarketplacePagePath(pathname) || isLegacyMarketplaceApiPath(pathname);
}

/** Legacy URL → ops-only hedefi; null = engelle */
export function resolveOpsOnlyLegacyRedirect(pathname) {
  const path = normalizePath(pathname);
  const map = {
    '/siparisler': `${HZLMRKTOPS_BASE}/siparisler`,
    '/urunler': `${HZLMRKTOPS_BASE}/urunler`,
    '/trendyol': null,
    '/komisyon-tarifesi': null
  };
  if (!(path in map)) return undefined;
  return map[path];
}

export function legacyMarketplaceRouteMessage() {
  return 'Pazaryeri & Buybox modülü petfix-marketplace reposunda (:8788).';
}

export function localOnlyRouteMessage(pathname) {
  if (isLegacyMarketplacePagePath(pathname) || isLegacyMarketplaceApiPath(pathname)) {
    return legacyMarketplaceRouteMessage();
  }
  return 'Bu modül bu repoda devre dışı (DEPLOY_PROFILE=ops-only).';
}

export function deployProfileLabel(deployProfile) {
  return deployProfile === DEPLOY_PROFILE.FULL
    ? 'Tam panel (legacy — pazaryeri ayrı repo)'
    : 'HzlMrktOps (production)';
}

export function isPanelModuleVisible(moduleId, deployProfile = DEPLOY_PROFILE.OPS_ONLY) {
  if (deployProfile !== DEPLOY_PROFILE.OPS_ONLY) return true;
  return OPS_ONLY_PANEL_MODULES.has(moduleId);
}

export { PANEL_MODULES };
