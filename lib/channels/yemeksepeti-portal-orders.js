import { ORDER_SOURCES } from '../production/constants.js';

const PORTAL_STATUS = Object.freeze({
  PICKED_UP: 'PICKED_UP',
  CANCELLED: 'CANCELLED',
  RECEIVED: 'RECEIVED'
});

export function parsePortalListOrdersPayload(body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body || {});
  if (!text.includes('listOrders')) {
    return [];
  }

  try {
    const json = typeof body === 'object' ? body : JSON.parse(text);
    const orders = json?.data?.orders?.listOrders?.orders;
    return Array.isArray(orders) ? orders : [];
  } catch {
    return [];
  }
}

function mapPortalDeliveryType(deliveryType) {
  const value = String(deliveryType || '').toLowerCase();
  if (value.includes('vendor') || value.includes('own') || value.includes('restaurant')) return 'Restoran Kuryesi';
  if (value.includes('pickup') || value.includes('collection')) return 'Gel Al';
  if (value.includes('platform') || value.includes('courier')) return 'Platform Kuryesi';
  return null;
}

export function portalSummaryToProfitPackage(summary, ingestSource = ORDER_SOURCES.PORTAL) {
  const orderId = String(summary?.orderId || '').trim();
  if (!orderId) {
    return null;
  }

  const subtotal = Number(summary?.subtotal) || 0;
  const netRevenue = Number(summary?.billing?.netRevenue) || null;
  const commission = Number(summary?.billing?.commissionAmount) || null;

  return {
    orderNumber: orderId,
    shipmentPackageId: orderId,
    orderDate: summary.placedTimestamp || summary.placed_at || new Date().toISOString(),
    status: String(summary.orderStatus || PORTAL_STATUS.PICKED_UP).trim(),
    packageGrossAmount: subtotal,
    deliveryMethod: mapPortalDeliveryType(summary.deliveryType),
    packageTotalDiscount: 0,
    cargoAmount: 0,
    lines: subtotal > 0
      ? [{
          barcode: '',
          productName: 'Portal sipariş özeti (satır detayı yok)',
          quantity: 1,
          lineUnitPrice: subtotal,
          unitPrice: subtotal,
          stockCode: 'portal-summary'
        }]
      : [],
    ingestSource,
    portalSummary: {
      orderId,
      vendorId: summary.vendorId || null,
      orderStatus: summary.orderStatus || null,
      subtotal,
      netRevenue,
      commission,
      placedTimestamp: summary.placedTimestamp || null
    }
  };
}

export function portalSummariesToProfitPackages(summaries = []) {
  return summaries
    .map((summary) => portalSummaryToProfitPackage(summary))
    .filter(Boolean);
}
