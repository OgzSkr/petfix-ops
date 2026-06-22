const DEV_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function allowedOrigin(origin) {
  if (!origin) return null;
  if (DEV_ORIGIN.test(origin)) return origin;
  return null;
}

export function applyCorsHeaders(request, response) {
  const origin = allowedOrigin(request.headers.origin);
  if (!origin) return;

  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Access-Control-Allow-Credentials', 'true');
  response.setHeader(
    'Access-Control-Allow-Methods',
    'GET, POST, PUT, PATCH, DELETE, OPTIONS'
  );
  response.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Staff-Name, X-Device-Name'
  );
  response.setHeader('Vary', 'Origin');
}

export function handleCorsPreflight(request, response) {
  if (request.method !== 'OPTIONS') return false;
  if (!request.headers.origin) return false;

  applyCorsHeaders(request, response);
  response.writeHead(204);
  response.end();
  return true;
}
