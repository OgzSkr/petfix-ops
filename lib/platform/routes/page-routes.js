import { sendHtml, serveStatic } from '../../http/respond.js';
import { handlePanelRoutes, redirectOpsLegacy } from './panel-routes.js';
import { buildLegacyRedirect } from '../../panel/nav-config.js';
import { HZLMRKTOPS_BASE } from '../../hzlmrktops/constants.js';

/**
 * HTML sayfa rotaları.
 * @returns {Promise<boolean>} İstek işlendiyse true
 */
export async function handlePageRoutes(ctx) {
  const { request, response, url, views } = ctx;

  if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname.startsWith('/assets/')) {
    await serveStatic(response, url.pathname, undefined, request.method);
    return true;
  }

  if (await handlePanelRoutes(ctx)) {
    return true;
  }

  if (request.method === 'GET') {
    const opsRedirect = redirectOpsLegacy(url.pathname, url.searchParams);
    if (opsRedirect) {
      response.writeHead(302, { Location: opsRedirect });
      response.end();
      return true;
    }

    const legacyRedirect = buildLegacyRedirect(url.pathname, url.searchParams);
    if (legacyRedirect) {
      response.writeHead(302, { Location: legacyRedirect });
      response.end();
      return true;
    }
  }

  if (request.method === 'GET' && url.pathname === '/login') {
    await sendHtml(response, views.renderLoginPage());
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/') {
    response.writeHead(302, { Location: HZLMRKTOPS_BASE });
    response.end();
    return true;
  }

  if (request.method === 'GET' && (url.pathname === '/trendyol' || url.pathname === '/trendyol-legacy' || url.pathname === '/komisyon-tarifesi' || url.pathname.startsWith('/marketplace'))) {
    response.writeHead(302, { Location: HZLMRKTOPS_BASE });
    response.end();
    return true;
  }

  return false;
}
