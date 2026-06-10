import { fetchTgoJson, resolveUberStoreId } from './tgo-market-api.js';

/**
 * Trendyol Go sipariş + katalog API canlılık kontrolü (1 kayıt).
 */
export async function probeUberEatsApis(cfg) {
  const supplierId = String(cfg.supplierId || '').trim();
  const authToken = String(cfg.authToken || '').trim();
  const environment = cfg.environment || 'PROD';
  const result = {
    orders: { ok: false, source: null, message: 'Denenmedi' },
    catalog: { ok: false, storeId: null, message: 'Denenmedi' }
  };

  if (!supplierId || !authToken) {
    const msg = 'API Key / Secret eksik';
    result.orders.message = msg;
    result.catalog.message = msg;
    return result;
  }

  const orderHost = environment === 'STAGE'
    ? 'https://stageapigw.trendyol.com'
    : 'https://apigw.trendyol.com';

  try {
    const query = new URLSearchParams({
      supplierId,
      page: '0',
      size: '1',
      orderByField: 'PackageLastModifiedDate',
      orderByDirection: 'DESC'
    });
    const end = Date.now();
    const start = end - 7 * 24 * 60 * 60 * 1000;
    query.set('startDate', String(start));
    query.set('endDate', String(end));

    const response = await fetch(
      `${orderHost}/integration/order/sellers/${encodeURIComponent(supplierId)}/orders?${query}`,
      {
        headers: {
          Authorization: `Basic ${authToken}`,
          'User-Agent': `${supplierId} - SelfIntegration`,
          Accept: 'application/json'
        }
      }
    );
    const text = await response.text();

    if (response.ok) {
      result.orders = { ok: true, source: 'order-api', message: 'Sipariş API yanıt verdi' };
    } else if (response.status === 401 || response.status === 403
      || /UnauthorizedAccessException|TrendyolAuthorizationException/i.test(text)) {
      result.orders = {
        ok: true,
        source: 'finance-fallback',
        message: 'Sipariş API kısıtlı — finance fallback kullanılacak (normal)'
      };
    } else {
      result.orders = {
        ok: false,
        source: 'order-api',
        message: `Sipariş API HTTP ${response.status}: ${text.slice(0, 120)}`
      };
    }
  } catch (error) {
    result.orders = { ok: false, source: 'order-api', message: error.message || 'Sipariş API hatası' };
  }

  try {
    const storeId = await resolveUberStoreId(cfg, {});
    const data = await fetchTgoJson(
      cfg,
      `/integrator/product/grocery/suppliers/${encodeURIComponent(supplierId)}`
        + `/stores/${encodeURIComponent(storeId)}/products?page=0&size=1&listType=ALL_PRODUCT`
    );
    const count = Number(data.totalElements) || (data.content || []).length;
    result.catalog = {
      ok: true,
      storeId,
      message: `Katalog API OK · şube ${storeId}${count ? ` · ${count}+ ürün` : ''}`
    };
  } catch (error) {
    result.catalog = { ok: false, storeId: null, message: error.message || 'Katalog API hatası' };
  }

  return result;
}
