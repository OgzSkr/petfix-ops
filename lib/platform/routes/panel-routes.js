import { sendHtml } from '../../http/respond.js';
import { emptyDashboardShell } from '../services/dashboard.js';
import { renderOpsPickingPage } from '../../ops-hub/views/picking-page.js';
import { renderOpsIntegrationsPage } from '../../ops-hub/views/integrations-page.js';
import { renderOpsDashboardPage } from '../../ops-hub/views/dashboard-page.js';
import { renderOpsHealthPage } from '../../ops-hub/views/health-page.js';
import { renderPetfixShell } from '../../panel/shell/petfix-shell.js';
import { escapeHtml } from '../views/format.js';
import { PLATFORM_SHORT } from '../brand.js';

function redirect(response, location) {
  response.writeHead(302, { Location: location });
  response.end();
  return true;
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
          <p class="pf-module-banner">Bu ekran PetFix Panel modül ayrımına taşındı. İşlevler aşamalı olarak burada birleştirilecek.</p>
        </div>
      </section>`
  });
}

/**
 * Yeni modül route'ları ve canonical URL'ler.
 * Eski URL'ler page-routes.js içinde alias olarak korunur.
 */
export async function handlePanelRoutes(ctx) {
  const { request, response, url, auth, views, dashboard } = ctx;
  if (request.method !== 'GET') return false;

  const path = url.pathname.endsWith('/') && url.pathname.length > 1
    ? url.pathname.slice(0, -1)
    : url.pathname;
  const qs = url.searchParams.toString();
  const qSuffix = qs ? `?${qs}` : '';

  // ── Ürün Merkezi ──
  if (path === '/products') {
    await sendHtml(response, views.renderMatchingCenterPage({ defaultTab: 'master' }));
    return true;
  }
  if (path === '/products/inbox') {
    await sendHtml(response, views.renderMatchingCenterPage({ defaultTab: 'workbench' }));
    return true;
  }
  if (path === '/products/mappings') {
    await sendHtml(response, views.renderMatchingCenterPage({ defaultTab: 'master', focus: 'mappings' }));
    return true;
  }
  if (path === '/products/data-quality') {
    await sendHtml(response, views.renderMatchingCenterPage({ defaultTab: 'data-quality' }));
    return true;
  }
  if (path === '/products/costs') {
    await sendHtml(response, views.renderOtherChannelCostsPage());
    return true;
  }

  // ── Pazaryeri & Buybox ──
  if (path === '/marketplace') {
    return redirect(response, `/marketplace/trendyol${qSuffix}`);
  }
  if (path === '/marketplace/trendyol') {
    await sendHtml(response, views.renderCommissionTariffPage());
    return true;
  }
  if (path === '/marketplace/buybox') {
    if (auth.isEnabled()) {
      await sendHtml(response, views.renderDashboard(emptyDashboardShell(), { authRequired: true }));
    } else {
      await sendHtml(response, views.renderDashboard(await dashboard.buildDashboard(), { authRequired: false }));
    }
    return true;
  }
  if (path === '/marketplace/profit') {
    const params = new URLSearchParams(url.searchParams);
    params.set('view', 'tariff');
    return redirect(response, `/marketplace/trendyol?${params.toString()}`);
  }
  if (path === '/marketplace/orders') {
    await sendHtml(response, views.renderOrdersPage());
    return true;
  }
  if (path === '/marketplace/products') {
    await sendHtml(response, views.renderProductsPage());
    return true;
  }
  if (path === '/marketplace/shipping') {
    await sendHtml(response, views.renderShippingPage());
    return true;
  }
  if (path === '/marketplace/reports') {
    return redirect(response, `/dashboard${qSuffix}`);
  }

  // ── Hızlı Teslimat ──
  if (path === '/quick-commerce') {
    await sendHtml(response, renderOpsDashboardPage({ authRequired: auth.isEnabled(), auth }));
    return true;
  }
  if (path === '/quick-commerce/orders') {
    await sendHtml(response, renderOpsDashboardPage({ authRequired: auth.isEnabled(), auth }));
    return true;
  }
  if (path === '/quick-commerce/picking') {
    await sendHtml(response, renderOpsPickingPage({ authRequired: auth.isEnabled(), auth }));
    return true;
  }
  if (path === '/quick-commerce/couriers') {
    await sendHtml(response, renderPlaceholderPage({
      title: 'Kurye Yönetimi',
      module: 'quickCommerce',
      item: 'couriers',
      lead: 'Mağaza kuryesi atama ve teslimat takibi — hızlı teslimat operasyon modülünde.',
      auth
    }));
    return true;
  }
  if (path === '/quick-commerce/integrations') {
    await sendHtml(response, renderOpsIntegrationsPage({ authRequired: auth.isEnabled(), auth }));
    return true;
  }
  if (path === '/quick-commerce/errors') {
    await sendHtml(response, renderOpsHealthPage({ authRequired: auth.isEnabled(), auth, focus: 'errors' }));
    return true;
  }
  if (path === '/quick-commerce/health') {
    await sendHtml(response, renderOpsHealthPage({ authRequired: auth.isEnabled(), auth }));
    return true;
  }

  // ── Yönetim ──
  if (path === '/admin/branches') {
    await sendHtml(response, renderPlaceholderPage({
      title: 'Şubeler',
      module: 'admin',
      item: 'branches',
      lead: 'Şube tanımları ve kanal yapılandırmaları.',
      auth
    }));
    return true;
  }
  if (path === '/admin/users') {
    await sendHtml(response, renderPlaceholderPage({
      title: 'Kullanıcılar',
      module: 'admin',
      item: 'users',
      lead: 'Kullanıcı hesapları ve rol yönetimi.',
      auth
    }));
    return true;
  }
  if (path === '/admin/status') {
    await sendHtml(response, renderOpsHealthPage({ authRequired: auth.isEnabled(), auth }));
    return true;
  }
  if (path === '/admin/settings') {
    await sendHtml(response, views.renderSettingsPage());
    return true;
  }
  if (path === '/admin/integrations') {
    return redirect(response, `/quick-commerce/integrations${qSuffix}`);
  }
  if (path === '/admin/audit') {
    return redirect(response, `/dashboard${qSuffix}`);
  }

  return false;
}

/** Ops legacy URL → quick-commerce canonical */
export function redirectOpsLegacy(pathname, searchParams) {
  const path = pathname.endsWith('/') && pathname.length > 1 ? pathname.slice(0, -1) : pathname;
  const qs = searchParams?.toString();
  const suffix = qs ? `?${qs}` : '';
  const map = {
    '/ops': '/quick-commerce/picking',
    '/ops/panel': '/quick-commerce',
    '/ops/integrations': '/quick-commerce/integrations',
    '/ops/durum': '/quick-commerce/health'
  };
  const target = map[path];
  if (!target) return null;
  const trailing = pathname.endsWith('/') ? '/' : '';
  return `${target}${trailing}${suffix}`;
}
