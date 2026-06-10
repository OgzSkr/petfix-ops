import { getYemeksepetiAccessToken } from './yemeksepeti-auth.js';
import { resolveRealUtcOrderDateRange } from '../order-profitability.js';

const API_BASE = 'https://yemeksepeti.partner.deliveryhero.io/v2';
const PAGE_SIZE = 100;

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toIsoUtc(ms) {
  return new Date(ms).toISOString().slice(0, 19);
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

/**
 * Yemeksepeti Partner API — read-only sipariş geçmişi.
 * https://developer.yemeksepeti.com/en/documentation/pos-pelican-picking-use-cases
 */
export async function fetchYemeksepetiOrders(cfg, options = {}) {
  const chainId = String(cfg.chainId || '').trim();
  const vendorId = String(cfg.vendorId || '').trim();

  if (!chainId || !vendorId) {
    throw new Error('Yemeksepeti CHAIN_ID ve VENDOR_ID zorunludur.');
  }

  const accessToken = await getYemeksepetiAccessToken(cfg);
  const { startDate, endDate } = resolveRealUtcOrderDateRange(options);
  const packages = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const query = new URLSearchParams({
      start_time: toIsoUtc(startDate),
      end_time: toIsoUtc(endDate),
      page_size: String(PAGE_SIZE),
      page: String(page)
    });

    const response = await fetch(
      `${API_BASE}/chains/${encodeURIComponent(chainId)}/vendors/${encodeURIComponent(vendorId)}/orders?${query}`,
      {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`
        }
      }
    );

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Yemeksepeti sipariş hatası: HTTP ${response.status} - ${text.slice(0, 300)}`);
    }

    const data = text ? JSON.parse(text) : {};
    const orders = data.orders || [];
    packages.push(...orders.map((order) => ({
      ...normalizeYemeksepetiOrder(order),
      ingestSource: 'partner_api'
    })));

    totalPages = Math.max(Number(data.total_pages) || 1, 1);
    page += 1;

    if (!orders.length) {
      break;
    }
  }

  return packages;
}
