import { getYemeksepetiAccessToken } from './yemeksepeti-auth.js';
import { resolveRealUtcOrderDateRange } from '../order-profitability.js';
import { listYemeksepetiVendorIds } from './yemeksepeti-vendor-ids.js';
import { dedupeOrderPackages } from './dedupe-order-packages.js';
import { fetchWithTimeout } from '../http/fetch-timeout.js';

const API_BASE = 'https://yemeksepeti.partner.deliveryhero.io/v2';
const PAGE_SIZE = 100;
const ORDER_ID_UUID = /^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/;

export function isYemeksepetiOrderUuid(orderId) {
  return ORDER_ID_UUID.test(String(orderId || '').trim());
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** YS API UTC ISO8601 — saniye hassasiyeti, Z suffix. */
function toIsoUtc(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function firstBarcode(value) {
  if (Array.isArray(value)) {
    return String(value[0] || '').trim();
  }
  return String(value || '').trim();
}

function lineItemsTotal(order) {
  return (order.items || []).reduce((sum, item) => {
    const pricing = item.pricing || item.original_pricing || {};
    const qty = toNumber(pricing.quantity) || 1;
    const unit = toNumber(pricing.unit_price);
    const total = toNumber(pricing.total_price);
    return sum + (total || unit * qty);
  }, 0);
}

export function normalizeYemeksepetiOrder(order) {
  const payment = order.payment || {};
  const createdAt = order.sys?.created_at || order.accepted_for || '';
  const grossFromPayment = toNumber(payment.order_total);
  const grossFromLines = lineItemsTotal(order);

  return {
    orderNumber: order.order_code || order.external_order_id || '',
    orderDate: createdAt,
    shipmentPackageId: order.order_id || '',
    status: order.status || '',
    packageGrossAmount: grossFromPayment || grossFromLines,
    packageTotalDiscount: Math.abs(toNumber(payment.discount)),
    cargoAmount: toNumber(payment.delivery_fee),
    cargoPrice: toNumber(payment.delivery_fee),
    serviceFee: toNumber(payment.service_fee),
    lines: (order.items || []).map((item) => {
      const pricing = item.pricing || item.original_pricing || {};
      return {
        barcode: firstBarcode(item.barcode),
        productName: item.name || '',
        quantity: toNumber(pricing.quantity) || 1,
        lineUnitPrice: toNumber(pricing.unit_price),
        unitPrice: toNumber(pricing.unit_price),
        vatRate: toNumber(pricing.vat_percent),
        stockCode: item.sku || ''
      };
    })
  };
}

function dedupePackages(packages) {
  return dedupeOrderPackages(packages);
}

/**
 * Tek vendor_id için Partner API sipariş geçmişi (max 60 gün).
 */
export async function fetchYemeksepetiOrdersForVendor(cfg, vendorId, options = {}) {
  const chainId = String(cfg.chainId || '').trim();
  const vendor = String(vendorId || '').trim();

  if (!chainId || !vendor) {
    throw new Error('Yemeksepeti CHAIN_ID ve VENDOR_ID zorunludur.');
  }

  const accessToken = await getYemeksepetiAccessToken(cfg);
  const { startDate, endDate } = resolveRealUtcOrderDateRange(options);
  const packages = [];
  let page = 1;
  let totalPages = null;

  while (true) {
    const query = new URLSearchParams({
      start_time: toIsoUtc(startDate),
      end_time: toIsoUtc(endDate),
      page_size: String(PAGE_SIZE),
      page: String(page)
    });

    const response = await fetchWithTimeout(
      `${API_BASE}/chains/${encodeURIComponent(chainId)}/vendors/${encodeURIComponent(vendor)}/orders?${query}`,
      {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`
        }
      }
    );

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Yemeksepeti sipariş hatası (${vendor}): HTTP ${response.status} - ${text.slice(0, 300)}`);
    }

    const data = text ? JSON.parse(text) : {};
    const orders = data.orders || [];
    packages.push(...orders.map((order) => ({
      ...normalizeYemeksepetiOrder(order),
      ingestSource: 'partner_api',
      ysVendorId: vendor
    })));

    if (totalPages === null) {
      totalPages = Number(data.total_pages) || 0;
    }

    if (!orders.length || page >= totalPages) {
      break;
    }

    page += 1;
  }

  return packages;
}

/**
 * Tek sipariş — önce chain path, gerekirse legacy /v2/orders/{id}.
 * @see https://developer.yemeksepeti.com/api-specifications#tag/Order
 */
export async function fetchYemeksepetiOrderById(cfg, orderId, options = {}) {
  const chainId = String(cfg.chainId || '').trim();
  const id = String(orderId || '').trim();

  if (!id) {
    throw new Error('order_id zorunlu.');
  }
  if (!isYemeksepetiOrderUuid(id)) {
    throw new Error(`Geçersiz YS order_id (UUID beklenir): ${id}`);
  }

  const accessToken = options.accessToken || (await getYemeksepetiAccessToken(cfg));
  const paths = chainId
    ? [`${API_BASE}/chains/${encodeURIComponent(chainId)}/orders/${encodeURIComponent(id)}`, `${API_BASE}/orders/${encodeURIComponent(id)}`]
    : [`${API_BASE}/orders/${encodeURIComponent(id)}`];

  let lastError = null;
  for (const url of paths) {
    const response = await fetchWithTimeout(url, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`
      }
    });

    const text = await response.text();
    if (response.status === 404) {
      lastError = new Error(`Sipariş bulunamadı: ${id}`);
      continue;
    }
    if (!response.ok) {
      throw new Error(`Yemeksepeti sipariş detayı (${id}): HTTP ${response.status} - ${text.slice(0, 300)}`);
    }

    const order = text ? JSON.parse(text) : null;
    if (!order?.order_id && !order?.order_code) {
      throw new Error(`Yemeksepeti sipariş yanıtı geçersiz: ${id}`);
    }

    return {
      ...normalizeYemeksepetiOrder(order),
      ingestSource: 'partner_api',
      ysVendorId: order.client?.store_id || cfg.vendorId || '',
      rawOrder: order
    };
  }

  throw lastError || new Error(`Sipariş bulunamadı: ${id}`);
}

/** Bilinen order_id listesi ile toplu çekim (portal export / webhook UUID). */
export async function fetchYemeksepetiOrdersByIds(cfg, orderIds = [], options = {}) {
  const unique = [...new Set(orderIds.map((row) => String(row || '').trim()).filter(isYemeksepetiOrderUuid))];
  const accessToken = await getYemeksepetiAccessToken(cfg);
  const results = [];
  const errors = [];

  for (const orderId of unique) {
    try {
      results.push(await fetchYemeksepetiOrderById(cfg, orderId, { ...options, accessToken }));
    } catch (error) {
      errors.push({ orderId, message: error.message || 'Hata' });
    }
  }

  return { packages: dedupePackages(results), errors, fetched: results.length, requested: unique.length };
}

/**
 * Yemeksepeti Partner API — read-only sipariş geçmişi.
 * Tüm bilinen vendor/store id'leri dener (max 60 gün).
 * options.orderIds verilirse listeye ek olarak GET /orders/{id} denenir.
 */
export async function fetchYemeksepetiOrders(cfg, options = {}) {
  const explicitIds = Array.isArray(options.orderIds) ? options.orderIds : [];
  const envIds = String(options.platformEnv?.YEMEKSEPETI_BACKFILL_ORDER_IDS || process.env.YEMEKSEPETI_BACKFILL_ORDER_IDS || '')
    .split(/[,;\s\n]+/)
    .map((row) => row.trim())
    .filter(Boolean);
  const orderIds = [...new Set([...explicitIds, ...envIds])];

  const vendorIds = options.vendorIds?.length
    ? options.vendorIds
    : await listYemeksepetiVendorIds(cfg, options.platformEnv || {}, options.pool || null);

  if (!vendorIds.length && !orderIds.length) {
    throw new Error('Yemeksepeti CHAIN_ID ve VENDOR_ID zorunludur.');
  }

  const merged = [];

  for (const vendorId of vendorIds) {
    try {
      const rows = await fetchYemeksepetiOrdersForVendor(cfg, vendorId, options);
      merged.push(...rows);
    } catch {
      /* vendor başına hata yutulur — diğer id'ler denenir */
    }
  }

  if (orderIds.length) {
    const byId = await fetchYemeksepetiOrdersByIds(cfg, orderIds, options);
    merged.push(...byId.packages);
  }

  const packages = dedupePackages(merged);
  return packages;
}
