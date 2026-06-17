import { sendJson } from '../../http/respond.js';
import { handlePageRoutes } from './page-routes.js';
import { handleApiRoutes } from './api-routes.js';
import { handleOpsHubRoutes } from '../../ops-hub/routes/ops-hub-routes.js';
import { handleWebhookRoutes } from '../../ops-hub/routes/webhook-routes.js';
import { createLogger } from '../../logger.js';

const log = createLogger('HTTP');

export function createRouteHandler(deps) {
  return async function handleRequest(request, response) {
    const url = new URL(request.url, `http://${request.headers.host}`);

    try {
      const ctx = { request, response, url, ...deps };

      if (await handleWebhookRoutes(ctx)) return;
      if (await handleOpsHubRoutes(ctx)) return;
      if (await handlePageRoutes(ctx)) return;
      if (await handleApiRoutes(ctx)) return;

      sendJson(response, { error: 'Not found' }, 404);
    } catch (error) {
      const statusCode = Number(error.statusCode) || 500;
      const path = url.pathname;
      const meta = {
        method: request.method,
        path,
        statusCode
      };

      if (statusCode >= 500) {
        log.error(`${request.method} ${path} → ${statusCode}: ${error.message}`, meta);
      } else if (statusCode >= 400) {
        log.warn(`${request.method} ${path} → ${statusCode}: ${error.message}`, meta);
      }

      sendJson(response, { error: error.message || 'İstek işlenemedi' }, statusCode);
    }
  };
}
