import { sendHtml, serveStatic } from '../../http/respond.js';
import { emptyDashboardShell } from '../services/dashboard.js';
import { handlePanelRoutes, redirectOpsLegacy } from './panel-routes.js';

function mapTrendyolRedirectParams(searchParams) {
  const params = new URLSearchParams(searchParams);
  const legacyView = params.get('view');

  if (legacyView === 'missing' || legacyView === 'loss' || legacyView === 'profit') {
    params.set('view', 'catalog');
    params.set('catalogTab', legacyView);
  } else if (legacyView === 'all') {
    params.set('view', 'catalog');
    params.delete('catalogTab');
  } else if (legacyView === 'autotrack') {
    params.set('view', 'track');
  } else if (legacyView === 'tariff') {
    params.set('view', 'tariff');
  } else if (legacyView === 'analytics') {
    params.set('view', 'catalog');
    params.delete('catalogTab');
  } else if (!params.has('view')) {
    params.set('view', 'catalog');
  }

  return params;
}

/**
 * HTML sayfa rotaları — Trendyol + Uber Eats aktif; planlı kanallar placeholder.
 * @returns {Promise<boolean>} İstek işlendiyse true
 */
export async function handlePageRoutes(ctx) {
  const { request, response, url, auth, views, dashboard } = ctx;

  if (request.method === 'GET' && url.pathname.startsWith('/assets/')) {
    await serveStatic(response, url.pathname);
    return true;
  }

  // Yeni modül route'ları (canonical)
  if (await handlePanelRoutes(ctx)) {
    return true;
  }

  // Ops legacy → quick-commerce redirect (301 yerine 302 — güvenli geçiş)
  if (request.method === 'GET') {
    const opsRedirect = redirectOpsLegacy(url.pathname, url.searchParams);
    if (opsRedirect) {
      response.writeHead(302, { Location: opsRedirect });
      response.end();
      return true;
    }
  }

  if (request.method === 'GET' && url.pathname === '/login') {
    await sendHtml(response, views.renderLoginPage());
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/') {
    response.writeHead(302, { Location: '/dashboard' });
    response.end();
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/dashboard') {
    await sendHtml(response, views.renderGeneralDashboard());
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/trendyol') {
    const params = mapTrendyolRedirectParams(url.searchParams);
    response.writeHead(302, { Location: '/marketplace/trendyol?' + params.toString() });
    response.end();
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/trendyol-legacy') {
    const redirectParams = url.searchParams.toString();
    response.writeHead(302, {
      Location: redirectParams ? `/marketplace/buybox?${redirectParams}` : '/marketplace/buybox'
    });
    response.end();
    return true;
  }

  const channelPages = {
    '/getir': 'renderGetirPage',
    '/uber-eats': 'renderUberEatsPage',
    '/yemeksepeti': 'renderYemeksepetiPage',
    '/woocommerce': 'renderWooCommercePage'
  };

  if (request.method === 'GET' && channelPages[url.pathname]) {
    await sendHtml(response, views[channelPages[url.pathname]]());
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/urunler') {
    const redirectParams = url.searchParams.toString();
    response.writeHead(302, {
      Location: redirectParams ? `/marketplace/products?${redirectParams}` : '/marketplace/products'
    });
    response.end();
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/kanal-maliyetleri') {
    const redirectParams = url.searchParams.toString();
    response.writeHead(302, {
      Location: redirectParams ? `/products/costs?${redirectParams}` : '/products/costs'
    });
    response.end();
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/eslestirme-merkezi') {
    const redirectParams = url.searchParams.toString();
    response.writeHead(302, {
      Location: redirectParams ? `/products?${redirectParams}` : '/products'
    });
    response.end();
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/urun-havuzu') {
    const redirectParams = url.searchParams.toString();
    response.writeHead(302, {
      Location: redirectParams ? `/products?${redirectParams}` : '/products'
    });
    response.end();
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/ayarlar') {
    const redirectParams = url.searchParams.toString();
    response.writeHead(302, {
      Location: redirectParams ? `/admin/settings?${redirectParams}` : '/admin/settings'
    });
    response.end();
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/komisyon-tarifesi') {
    const redirectParams = url.searchParams.toString();
    response.writeHead(302, {
      Location: redirectParams ? `/marketplace/trendyol?${redirectParams}` : '/marketplace/trendyol'
    });
    response.end();
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/siparisler') {
    const redirectParams = url.searchParams.toString();
    response.writeHead(302, {
      Location: redirectParams ? `/marketplace/orders?${redirectParams}` : '/marketplace/orders'
    });
    response.end();
    return true;
  }

  return false;
}
