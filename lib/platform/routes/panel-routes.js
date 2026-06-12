import { sendHtml } from '../../http/respond.js';
import { emptyDashboardShell } from '../services/dashboard.js';
import { renderOpsPickingPage } from '../../ops-hub/views/picking-page.js';
import { renderOpsIntegrationsPage } from '../../ops-hub/views/integrations-page.js';
import { renderOpsDashboardPage } from '../../ops-hub/views/dashboard-page.js';
import { renderOpsHealthPage } from '../../ops-hub/views/health-page.js';
import { renderPetfixShell } from '../../panel/shell/petfix-shell.js';
import { escapeHtml } from '../views/format.js';

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
  sendPageHtml(response, request, html);
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
          <p class="pf-module-banner">Bu ekran MarketNext modül ayrımına taşındı. İşlevler aşamalı olarak burada birleştirilecek.</p>
        </div>
      </section>`
  });
}

function renderMarketNextMatchingPage(views, options = {}) {
  return views.renderMatchingCenterPage(options);
}

/**
 * MarketNext, Pazaryeri ve E-Ticaret modül route'ları.
 */
export async function handlePanelRoutes(ctx) {
  const { request, response, url, auth, views, dashboard } = ctx;
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;

  const path = url.pathname.endsWith('/') && url.pathname.length > 1
    ? url.pathname.slice(0, -1)
    : url.pathname;
  const qs = url.searchParams.toString();
  const qSuffix = qs ? `?${qs}` : '';

  // ── MarketNext — Ürün eşleştirme ──
  if (path === '/marketnext/matching' || path === '/marketnext/matching/masters') {
    await sendPageHtml(response, request, renderMarketNextMatchingPage(views, { defaultTab: 'master' }));
    return true;
  }
  if (path === '/marketnext/matching/inbox') {
    await sendPageHtml(response, request, renderMarketNextMatchingPage(views, { defaultTab: 'workbench' }));
    return true;
  }
  if (path === '/marketnext/matching/mappings') {
    await sendPageHtml(response, request, renderMarketNextMatchingPage(views, { defaultTab: 'master', focus: 'mappings' }));
    return true;
  }
  if (path === '/marketnext/matching/data-quality') {
    await sendPageHtml(response, request, renderMarketNextMatchingPage(views, { defaultTab: 'data-quality' }));
    return true;
  }

  // Legacy Ürün Merkezi → MarketNext
  if (path === '/products') {
    return redirect(response, `/marketnext/matching/masters${qSuffix}`);
  }
  if (path === '/products/inbox') {
    return redirect(response, `/marketnext/matching/inbox${qSuffix}`);
  }
  if (path === '/products/mappings') {
    return redirect(response, `/marketnext/matching/mappings${qSuffix}`);
  }
  if (path === '/products/data-quality') {
    return redirect(response, `/marketnext/matching/data-quality${qSuffix}`);
  }
  if (path === '/products/costs' || path === '/marketnext/costs' || path === '/kanal-maliyetleri') {
    return redirect(response, `/marketnext/matching/masters${qSuffix}`);
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

  // ── MarketNext operasyon ──
  if (path === '/marketnext' || path === '/marketnext/orders') {
    await sendPageHtml(response, request, renderOpsDashboardPage({ authRequired: auth.isEnabled(), auth }));
    return true;
  }
  if (path === '/marketnext/picking') {
    await sendPageHtml(response, request, renderOpsPickingPage({ authRequired: auth.isEnabled(), auth }));
    return true;
  }
  if (path === '/marketnext/orders/uber-eats') {
    await sendPageHtml(response, request, views.renderUberEatsPage());
    return true;
  }
  if (path === '/marketnext/orders/yemeksepeti') {
    await sendPageHtml(response, request, views.renderYemeksepetiPage());
    return true;
  }
  if (path === '/marketnext/orders/getir') {
    await sendPageHtml(response, request, views.renderGetirPage());
    return true;
  }
  if (path === '/marketnext/sync') {
    await sendPageHtml(response, request, renderPlaceholderPage({
      title: 'Stok & Fiyat Senkronizasyonu',
      module: 'marketnext',
      item: 'sync',
      lead: 'Hızlı market kanallarına stok ve fiyat aktarımı — MarketNext.',
      auth
    }));
    return true;
  }
  if (path === '/marketnext/profit') {
    await sendPageHtml(response, request, views.renderMarketNextProfitPage());
    return true;
  }
  if (path === '/marketnext/integrations') {
    await sendPageHtml(response, request, renderOpsIntegrationsPage({ authRequired: auth.isEnabled(), auth }));
    return true;
  }
  if (path === '/marketnext/errors') {
    await sendPageHtml(response, request, renderOpsHealthPage({ authRequired: auth.isEnabled(), auth, focus: 'errors' }));
    return true;
  }
  if (path === '/marketnext/health') {
    await sendPageHtml(response, request, renderOpsHealthPage({ authRequired: auth.isEnabled(), auth }));
    return true;
  }
  if (path === '/marketnext/couriers') {
    await sendPageHtml(response, request, renderPlaceholderPage({
      title: 'Kurye Yönetimi',
      module: 'marketnext',
      item: 'couriers',
      lead: 'Mağaza kuryesi atama ve teslimat takibi.',
      auth
    }));
    return true;
  }

  // Legacy quick-commerce → MarketNext
  if (path.startsWith('/quick-commerce')) {
    return redirect(response, `${path.replace('/quick-commerce', '/marketnext')}${qSuffix}`);
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
    return redirect(response, `/marketnext/integrations${qSuffix}`);
  }
  if (path === '/admin/audit') {
    return redirect(response, `/marketnext${qSuffix}`);
  }

  return false;
}

/** Ops legacy URL → MarketNext canonical */
export function redirectOpsLegacy(pathname, searchParams) {
  const path = pathname.endsWith('/') && pathname.length > 1 ? pathname.slice(0, -1) : pathname;
  const qs = searchParams?.toString();
  const suffix = qs ? `?${qs}` : '';
  const map = {
    '/ops': '/marketnext/picking',
    '/ops/panel': '/marketnext',
    '/ops/integrations': '/marketnext/integrations',
    '/ops/durum': '/marketnext/health'
  };
  const target = map[path];
  if (!target) return null;
  const trailing = pathname.endsWith('/') ? '/' : '';
  return `${target}${trailing}${suffix}`;
}
