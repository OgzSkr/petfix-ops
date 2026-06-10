import { ORDER_PAGE_SIZE, resolveRealUtcOrderDateRange } from '../order-profitability.js';

const WC_PAGE_SIZE = 100;
const ACTIVE_STATUSES = new Set(['pending', 'processing', 'on-hold', 'completed']);

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toIso8601(ms) {
  return new Date(ms).toISOString();
}

function buildAuthHeader(key, secret) {
  return `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`;
}

function extractLineBarcode(item) {
  const sku = String(item.sku || '').trim();
  if (sku) return sku;

  for (const meta of item.meta_data || []) {
    const key = String(meta.key || '').toLowerCase();
    if (key === 'barcode' || key === '_barcode' || key === 'ean' || key === '_ean') {
      const value = String(meta.value || '').trim();
      if (value) return value;
    }
  }

  return '';
}

export function normalizeWooCommerceOrder(order) {
  const discountTotal = toNumber(order.discount_total);
  const shippingTotal = toNumber(order.shipping_total);
  const orderTotal = toNumber(order.total);

  return {
    orderNumber: String(order.number || order.id || ''),
    orderDate: order.date_created_gmt || order.date_created || '',
    shipmentPackageId: String(order.id || ''),
    status: order.status || '',
    packageGrossAmount: orderTotal + discountTotal,
    packageTotalDiscount: discountTotal,
    cargoAmount: shippingTotal,
    cargoPrice: shippingTotal,
    serviceFee: 0,
    lines: (order.line_items || []).map((item) => {
      const quantity = toNumber(item.quantity) || 1;
      const unitPrice = toNumber(item.price) || (quantity ? toNumber(item.total) / quantity : 0);
      return {
        barcode: extractLineBarcode(item),
        productName: item.name || '',
        quantity,
        lineUnitPrice: unitPrice,
        unitPrice,
        commission: 0,
        vatRate: 20,
        stockCode: item.sku || ''
      };
    })
  };
}

/**
 * WooCommerce REST API v3 — read-only sipariş çekimi (sayfalı).
 */
export async function fetchWooCommerceOrders(cfg, options = {}) {
  const baseUrl = String(cfg.baseUrl || '').replace(/\/$/, '');
  if (!baseUrl || !cfg.key || !cfg.secret) {
    throw new Error('WooCommerce REST bilgileri eksik.');
  }

  const { startDate, endDate } = resolveRealUtcOrderDateRange(options);
  const headers = {
    Authorization: buildAuthHeader(cfg.key, cfg.secret),
    Accept: 'application/json'
  };

  const packages = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const url = new URL(`${baseUrl}/wp-json/wc/v3/orders`);
    url.searchParams.set('per_page', String(WC_PAGE_SIZE));
    url.searchParams.set('page', String(page));
    url.searchParams.set('orderby', 'date');
    url.searchParams.set('order', 'desc');
    url.searchParams.set('after', toIso8601(startDate));
    url.searchParams.set('before', toIso8601(endDate));

    const response = await fetch(url, { headers });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`WooCommerce orders HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
    }

    const orders = await response.json();
    totalPages = Math.max(1, Number(response.headers.get('x-wp-totalpages') || 1));

    for (const order of orders || []) {
      if (!ACTIVE_STATUSES.has(String(order.status || ''))) continue;
      packages.push(normalizeWooCommerceOrder(order));
    }

    if (!orders?.length) break;
    page += 1;

    if (packages.length >= (options.limit || ORDER_PAGE_SIZE * 20)) break;
  }

  return packages;
}
