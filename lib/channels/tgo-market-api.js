const PROD_BASE = 'https://api.tgoapis.com';
const STAGE_BASE = 'https://stageapi.tgoapis.com';

export function tgoMarketBaseUrl(environment = 'PROD') {
  return environment === 'STAGE' ? STAGE_BASE : PROD_BASE;
}

export function buildTgoMarketHeaders(cfg) {
  const supplierId = String(cfg.supplierId || '').trim();
  const headers = {
    Authorization: `Basic ${cfg.authToken}`,
    'supplier-id': supplierId,
    Accept: 'application/json',
    'x-agentname': cfg.agentName || 'BuyBoxPanel',
    'x-executor-user': cfg.executorUser || 'panel@petfix.local'
  };
  const integrationRef = String(cfg.integrationRef || '').trim();
  if (integrationRef) {
    headers['x-correlationid'] = integrationRef;
  }
  return headers;
}

/**
 * Şube storeId — env > kayıtlı meta > sipariş paketlerinden otomatik.
 */
export async function resolveUberStoreId(cfg, options = {}) {
  const fromEnv = String(cfg.storeId || options.storeId || '').trim();
  if (fromEnv && /^\d+$/.test(fromEnv)) {
    return Number(fromEnv);
  }

  const packages = await fetchTgoJson(
    cfg,
    `/integrator/order/grocery/suppliers/${encodeURIComponent(cfg.supplierId)}/packages?page=0&size=1`
  );

  const storeId = packages?.content?.[0]?.storeId;
  if (!storeId) {
    throw new Error(
      'Uber şube storeId bulunamadı. Ayarlar → Uber Eats → Şube Store ID alanına numeric ID girin '
      + '(Trendyol Go destek veya sipariş API yanıtından).'
    );
  }

  return Number(storeId);
}

export async function fetchTgoJson(cfg, path, { method = 'GET', body } = {}) {
  const url = `${tgoMarketBaseUrl(cfg.environment)}${path}`;
  const response = await fetch(url, {
    method,
    headers: {
      ...buildTgoMarketHeaders(cfg),
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const message = data?.message || data?.errors?.[0]?.message || text.slice(0, 300);
    throw new Error(`Trendyol Go API hatası (${response.status}): ${message}`);
  }

  return data;
}
