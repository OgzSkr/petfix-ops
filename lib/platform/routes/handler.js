import { sendJson } from '../../http/respond.js';
import { handlePageRoutes } from './page-routes.js';
import { handleApiRoutes } from './api-routes.js';
import { handleOpsHubRoutes } from '../../ops-hub/routes/ops-hub-routes.js';
import { handleWebhookRoutes } from '../../ops-hub/routes/webhook-routes.js';

export function createRouteHandler(deps) {
  return async function handleRequest(request, response) {
    try {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const ctx = { request, response, url, ...deps };

      if (await handleWebhookRoutes(ctx)) return;
      if (await handleOpsHubRoutes(ctx)) return;
      if (await handlePageRoutes(ctx)) return;
      if (await handleApiRoutes(ctx)) return;

      sendJson(response, { error: 'Not found' }, 404);
    } catch (error) {
      const statusCode = error.statusCode || 500;
      sendJson(response, { error: error.message }, statusCode);
    }
  };
}
