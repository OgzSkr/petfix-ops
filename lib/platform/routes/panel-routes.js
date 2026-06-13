import { sendHtml } from '../../http/respond.js';
import { emptyDashboardShell } from '../services/dashboard.js';
import { renderOpsPickingPage } from '../../ops-hub/views/picking-page.js';
import { renderOpsIntegrationsPage } from '../../ops-hub/views/integrations-page.js';
import { renderOpsDashboardPage } from '../../ops-hub/views/dashboard-page.js';
import { renderOpsHealthPage } from '../../ops-hub/views/health-page.js';
import { renderPetfixShell } from '../../panel/shell/petfix-shell.js';
import { escapeHtml } from '../views/format.js';
import { HZLMRKTOPS_BASE } from '../../marketnext/constants.js';

function redirect(response, location) {
  response.writeHead(302, { Location: location });
  response.end();
  return true;
}

function sendPageHtml(response, request, html) {
  if (request.method === 'HEAD') {
    const body = Buffer.from(html, 'utf8');
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': body.length
    });
    response.end();
    return;
  }
  sendHtml(response, html);
}

function redirectLegacyMarketnext(response, path, qSuffix) {
  if (path === '/marketnext' || path.startsWith('/marketnext/')) {
    const rest = path === '/marketnext' ? '' : path.slice('/marketnext'.length);
    return redirect(response, `${HZLMRKTOPS_BASE}${rest}${qSuffix}`);
  }
  return false;
}

function renderPlaceholderPage({ title, module, item, lead, auth }) {
  return renderPetfixShell({
    title,
    activeModule: module,
    activeItem: item,
    auth,
    bootstrapData: { authRequired: Boolean(auth?.isEnabled?.()) },
    bodyHtml: `
      <section class="pf-panel">
        <div class="pf-panel-head">
          <div>
            <p class="pf-page-eyebrow">${escapeHtml(title)}</p>
            <h1>${escapeHtml(title)}</h1>
            <p class="pf-page-lead">${escapeHtml(lead)}</p>
          </div>
        </div>
        <div class="pf-panel-body">
          <div class="pf-empty-state">
            <span class="pf-empty-icon" aria-hidden="true">🚧</span>
            <strong>Bu özellik henüz hazır değil</strong>
            <p>${escapeHtml(title)} ekranı üzerinde çalışıyoruz; hazır olduğunda menüdeki "Yakında" rozeti kalkacak.</p>
            <a class="pf-btn-ghost" href="${HZLMRKTOPS_BASE}">Ana Panele dön</a>
          </div>
        </div>
      </section>`
  });
}

function renderHzlmrktopsProductsPage(views) {
  return views.renderBenimposProductsPage();
}

/**
 * HzlMrktOps, Pazaryeri ve E-Ticaret modül route'ları.
 */
export async function handlePanelRoutes(ctx) {
  const { request, response, url, auth, views, dashboard } = ctx;
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;

  const path = url.pathname.endsWith('/') && url.pathname.length > 1
    ? url.pathname.slice(0, -1)
    : url.pathname;
  const qs = url.searchParams.toString();
  const qSuffix = qs ? `?${qs}` : '';

  if (redirectLegacyMarketnext(response, path, qSuffix)) {
    return true;
  }

  // ── HzlMrktOps — Ürünler (BenimPOS + kanal push) ──
  if (path === `${HZLMRKTOPS_BASE}/urunler`) {
    await sendPageHtml(response, request, renderHzlmrktopsProductsPage(views));
    return true;
  }
  if (path === `${HZLMRKTOPS_BASE}/matching` || path === `${HZLMRKTOPS_BASE}/matching/masters`) {
    return redirect(response, `${HZLMRKTOPS_BASE}/urunler`);
  }
  if (path === `${HZLMRKTOPS_BASE}/matching/inbox` || path === '/products/inbox') {
    return redirect(response, `${HZLMRKTOPS_BASE}/urunler`);
  }
  if (path === `${HZLMRKTOPS_BASE}/matching/mappings`) {
    return redirect(response, `${HZLMRKTOPS_BASE}/urunler`);
  }
  if (path === `${HZLMRKTOPS_BASE}/matching/data-quality`) {
    return redirect(response, `${HZLMRKTOPS_BASE}/urunler`);
  }
  if (path === `${HZLMRKTOPS_BASE}/sync`) {
    return redirect(response, `${HZLMRKTOPS_BASE}/urunler`);
  }

  if (path === '/products') {
    return redirect(response, `${HZLMRKTOPS_BASE}/urunler`);
  }
  if (path === '/products/mappings') {
    return redirect(response, `${HZLMRKTOPS_BASE}/urunler`);
  }
  if (path === '/products/data-quality') {
    return redirect(response, `${HZLMRKTOPS_BASE}/urunler`);
  }
  if (path === '/products/costs' || path === `${HZLMRKTOPS_BASE}/costs` || path === '/kanal-maliyetleri') {
    return redirect(response, `${HZLMRKTOPS_BASE}/urunler`);
  }
  if (path === '/eslestirme-merkezi' || path === '/urun-havuzu') {
    return redirect(response, `${HZLMRKTOPS_BASE}/urunler`);
  }

  // ── Pazaryeri & Buybox ──
  if (path === '/marketplace') {
    return redirect(response, `/marketplace/trendyol${qSuffix}`);
  }
  if (path === '/marketplace/trendyol') {
    await sendPageHtml(response, request, views.renderCommissionTariffPage());
    return true;
  }
  if (path === '/marketplace/buybox') {
    if (auth.isEnabled()) {
      await sendPageHtml(response, request, views.renderDashboard(emptyDashboardShell(), { authRequired: true }));
    } else {
      await sendPageHtml(response, request, views.renderDashboard(await dashboard.buildDashboard(), { authRequired: false }));
    }
    return true;
  }
  if (path === '/marketplace/profit') {
    const params = new URLSearchParams(url.searchParams);
    params.set('view', 'tariff');
    return redirect(response, `/marketplace/trendyol?${params.toString()}`);
  }
  if (path === '/marketplace/orders') {
    await sendPageHtml(response, request, views.renderOrdersPage());
    return true;
  }
  if (path === '/marketplace/products') {
    await sendPageHtml(response, request, views.renderProductsPage());
    return true;
  }
  if (path === '/marketplace/shipping') {
    await sendPageHtml(response, request, views.renderShippingPage());
    return true;
  }
  if (path === '/marketplace/reports') {
    return redirect(response, `/marketplace/trendyol${qSuffix}`);
  }

  // ── E-Ticaret ──
  if (path === '/ecommerce' || path === '/ecommerce/woocommerce') {
    await sendPageHtml(response, request, views.renderWooCommercePage());
    return true;
  }
  if (path === '/ecommerce/woocommerce/orders') {
    await sendPageHtml(response, request, views.renderWooCommercePage());
    return true;
  }

  // ── HzlMrktOps operasyon ──
  if (path === HZLMRKTOPS_BASE) {
    await sendPageHtml(response, request, renderOpsDashboardPage({ authRequired: auth.isEnabled(), auth }));
    return true;
  }
  if (path === `${HZLMRKTOPS_BASE}/siparisler`) {
    await sendPageHtml(response, request, views.renderHzlMrktOpsProfitPage());
    return true;
  }
  if (path === `${HZLMRKTOPS_BASE}/profit` || path === `${HZLMRKTOPS_BASE}/orders`) {
    return redirect(response, `${HZLMRKTOPS_BASE}/siparisler${qSuffix}`);
  }
  if (path === `${HZLMRKTOPS_BASE}/picking`) {
    await sendPageHtml(response, request, renderOpsPickingPage({ authRequired: auth.isEnabled(), auth }));
    return true;
  }
  if (path === `${HZLMRKTOPS_BASE}/orders/uber-eats` || path === `${HZLMRKTOPS_BASE}/orders/yemeksepeti` || path === `${HZLMRKTOPS_BASE}/orders/getir`) {
    return redirect(response, `${HZLMRKTOPS_BASE}/siparisler${qSuffix}`);
  }
  if (path === '/uber-eats' || path === '/yemeksepeti' || path === '/getir') {
    return redirect(response, `${HZLMRKTOPS_BASE}/siparisler${qSuffix}`);
  }
  if (path === `${HZLMRKTOPS_BASE}/integrations`) {
    await sendPageHtml(response, request, renderOpsIntegrationsPage({ authRequired: auth.isEnabled(), auth }));
    return true;
  }
  if (path === `${HZLMRKTOPS_BASE}/errors`) {
    await sendPageHtml(response, request, renderOpsHealthPage({ authRequired: auth.isEnabled(), auth, focus: 'errors' }));
    return true;
  }
  if (path === `${HZLMRKTOPS_BASE}/health`) {
    await sendPageHtml(response, request, renderOpsHealthPage({ authRequired: auth.isEnabled(), auth }));
    return true;
  }
  if (path === `${HZLMRKTOPS_BASE}/couriers`) {
    await sendPageHtml(response, request, renderPlaceholderPage({
      title: 'Kurye Yönetimi',
      module: 'hzlmrktops',
      item: 'couriers',
      lead: 'Mağaza kuryesi atama ve teslimat takibi.',
      auth
    }));
    return true;
  }

  if (path.startsWith('/quick-commerce')) {
    return redirect(response, `${path.replace('/quick-commerce', HZLMRKTOPS_BASE)}${qSuffix}`);
  }

  // ── Yönetim ──
  if (path === '/admin/branches') {
    await sendPageHtml(response, request, renderPlaceholderPage({
      title: 'Şubeler',
      module: 'admin',
      item: 'branches',
      lead: 'Şube tanımları ve kanal yapılandırmaları.',
      auth
    }));
    return true;
  }
  if (path === '/admin/users') {
    await sendPageHtml(response, request, renderPlaceholderPage({
      title: 'Kullanıcılar',
      module: 'admin',
      item: 'users',
      lead: 'Kullanıcı hesapları ve rol yönetimi.',
      auth
    }));
    return true;
  }
  if (path === '/admin/status') {
    await sendPageHtml(response, request, renderOpsHealthPage({ authRequired: auth.isEnabled(), auth }));
    return true;
  }
  if (path === '/admin/settings') {
    await sendPageHtml(response, request, views.renderSettingsPage());
    return true;
  }
  if (path === '/admin/integrations') {
    return redirect(response, `${HZLMRKTOPS_BASE}/integrations${qSuffix}`);
  }
  if (path === '/admin/audit') {
    return redirect(response, `${HZLMRKTOPS_BASE}${qSuffix}`);
  }

  return false;
}

/** Ops legacy URL → HzlMrktOps canonical */
export function redirectOpsLegacy(pathname, searchParams) {
  const path = pathname.endsWith('/') && pathname.length > 1 ? pathname.slice(0, -1) : pathname;
  const qs = searchParams?.toString();
  const suffix = qs ? `?${qs}` : '';
  const map = {
    '/ops': HZLMRKTOPS_BASE,
    '/ops/panel': HZLMRKTOPS_BASE,
    '/ops/integrations': '/admin/settings',
    '/ops/durum': '/admin/status'
  };
  const target = map[path];
  if (!target) return null;
  const trailing = pathname.endsWith('/') ? '/' : '';
  return `${target}${trailing}${suffix}`;
}
