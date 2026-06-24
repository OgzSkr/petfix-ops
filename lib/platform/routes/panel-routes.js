import { sendHtml } from '../../http/respond.js';
import { renderOpsIntegrationsPage } from '../../ops-hub/views/integrations-page.js';
import { renderOpsDashboardPage } from '../../ops-hub/views/dashboard-page.js';
import { renderOpsSystemPage } from '../../ops-hub/views/system-page.js';
import { renderOpsReportsPage } from '../../ops-hub/views/reports-page.js';
import { renderOpsOrderProfitReportPage } from '../../ops-hub/views/order-profit-report-page.js';
import { renderOpsCustomersPage } from '../../ops-hub/views/customers-page.js';
import { renderOpsHealthPage } from '../../ops-hub/views/health-page.js';
import { renderPetfixShell } from '../../panel/shell/petfix-shell.js';
import { escapeHtml } from '../views/format.js';
import { HZLMRKTOPS_BASE } from '../../hzlmrktops/constants.js';

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
  const { request, response, url, auth, views } = ctx;
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;

  const path = url.pathname.endsWith('/') && url.pathname.length > 1
    ? url.pathname.slice(0, -1)
    : url.pathname;
  const qs = url.searchParams.toString();
  const qSuffix = qs ? `?${qs}` : '';

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
    return redirect(response, `${HZLMRKTOPS_BASE}${qSuffix}`);
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
  if (path === `${HZLMRKTOPS_BASE}/sistem`) {
    await sendPageHtml(response, request, renderOpsSystemPage({ authRequired: auth.isEnabled(), auth }));
    return true;
  }
  if (path === `${HZLMRKTOPS_BASE}/raporlar`) {
    await sendPageHtml(response, request, renderOpsReportsPage({ authRequired: auth.isEnabled(), auth }));
    return true;
  }
  if (path === `${HZLMRKTOPS_BASE}/raporlar/siparis-karliligi`) {
    await sendPageHtml(response, request, renderOpsOrderProfitReportPage({ authRequired: auth.isEnabled(), auth }));
    return true;
  }
  if (path === `${HZLMRKTOPS_BASE}/musteriler`) {
    await sendPageHtml(response, request, renderOpsCustomersPage({ authRequired: auth.isEnabled(), auth }));
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
    await sendPageHtml(response, request, views.renderAdminBranchesPage());
    return true;
  }
  if (path === '/admin/users') {
    await sendPageHtml(response, request, views.renderAdminUsersPage());
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
    '/ops/integrations': `${HZLMRKTOPS_BASE}/integrations`,
    '/ops/durum': '/admin/status'
  };
  const target = map[path];
  if (!target) return null;
  const trailing = pathname.endsWith('/') ? '/' : '';
  return `${target}${trailing}${suffix}`;
}
