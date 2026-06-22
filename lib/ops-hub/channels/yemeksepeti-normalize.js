import { readEnvFile } from '../../env.js';
import { paths, resolveRuntimeConfig } from '../../config.js';
import { resolveMatchingModeForChannel, resolveChannelLine } from '../../product-matching/resolve.js';
import { readDb } from '../../db/store.js';

const YS_STATUS_TO_OPS = Object.freeze({
  RECEIVED: 'received',
  ACCEPTED: 'received',
  IN_PREPARATION: 'picking',
  PICKING: 'picking',
  READY_FOR_PICKUP: 'picked',
  DISPATCHED: 'ready',
  DELIVERED: 'completed',
  COMPLETED: 'completed',
  PICKED_UP: 'completed',
  CANCELLED: 'cancelled',
  CANCELED: 'cancelled'
});

function firstBarcode(value) {
  if (Array.isArray(value)) {
    return String(value[0] || '').trim();
  }
  return String(value || '').trim();
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function extractYemeksepetiOrderPayload(body) {
  if (!body || typeof body !== 'object') {
    return null;
  }
  if (body.order && typeof body.order === 'object') {
    return body.order;
  }
  if (body.data?.order && typeof body.data.order === 'object') {
    return body.data.order;
  }
  if (body.payload?.order && typeof body.payload.order === 'object') {
    return body.payload.order;
  }
  if (body.order_id || body.items || body.products || body.order_items) {
    return body;
  }
  return null;
}

/** YS Partner API / webhook — farklı alan adlarından satırları çıkarır. */
export function extractYemeksepetiOrderItems(order) {
  if (!order || typeof order !== 'object') {
    return [];
  }
  const candidates = [
    order.items,
    order.products,
    order.order_items,
    order.line_items,
    order.articles,
    order.orderItems
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length) {
      return candidate;
    }
  }
  return [];
}

export function mapYemeksepetiOrderStatus(status) {
  const key = String(status || '').trim().toUpperCase();
  return YS_STATUS_TO_OPS[key] || 'received';
}

export function mapYemeksepetiDeliveryMode(order) {
  const logistics = order?.logistics || order?.delivery || {};
  const provider = String(logistics.provider || logistics.type || order?.delivery_type || '').toLowerCase();
  if (provider.includes('own') || provider.includes('vendor') || provider.includes('restaurant')) {
    return 'own_courier';
  }
  if (provider.includes('pickup') || provider.includes('collection')) {
    return 'pickup';
  }
  if (provider.includes('platform') || provider.includes('delivery_hero') || provider.includes('courier')) {
    return 'platform_courier';
  }
  return 'unknown';
}

function mapMatchingToOpsStatus(resolved, mode) {
  if (resolved.source === 'mapping') {
    return 'matched';
  }
  if (mode === 'strict') {
    return 'blocked';
  }
  if (resolved.mappingStatus === 'unmapped') {
    return 'unmapped';
  }
  return 'legacy';
}

function resolveChannelLineForOps(db, { channelProductId, channelBarcode, mode }) {
  return resolveChannelLine(db, {
    channelId: 'yemeksepeti',
    channelBarcode: channelBarcode || channelProductId,
    mode
  });
}

export async function normalizeYemeksepetiWebhookOrder(rawOrder, options = {}) {
  const order = rawOrder;
  const externalId = String(order.order_id || order.id || '').trim();
  if (!externalId) {
    return { ok: false, errors: ['YS order_id eksik'] };
  }

  const db = options.db || (await readDb());
  const runtime = resolveRuntimeConfig(options.platformEnv || {});
  const mode = resolveMatchingModeForChannel(
    runtime.productMatchingMode,
    'yemeksepeti',
    runtime.productMatchingModeByChannel
  );

  const items = extractYemeksepetiOrderItems(order);
  if (!items.length && !options.allowEmptyLines) {
    return { ok: false, errors: ['YS sipariş satırı yok'] };
  }

  const lines = items.map((item, index) => {
    const pricing = item.pricing || item.original_pricing || {};
    const channelProductId = String(item.sku || item.remote_product_id || item.id || `line-${index}`).trim();
    const barcode = firstBarcode(item.barcode) || null;
    const resolved = resolveChannelLineForOps(db, { channelProductId, channelBarcode: barcode, mode });
    const quantity = toNumber(pricing.quantity) || 1;

    return {
      lineIndex: index,
      channelProductId,
      barcode,
      title: String(item.name || item.title || channelProductId).trim() || null,
      quantity,
      unitPrice: pricing.unit_price != null ? toNumber(pricing.unit_price) : null,
      matchingStatus: mapMatchingToOpsStatus(resolved, mode),
      reservedQty: resolved.source === 'mapping' ? quantity : 0
    };
  });

  const createdAt = order.sys?.created_at || order.accepted_for || order.created_at || new Date().toISOString();
  const customer = order.customer || order.delivery?.customer || {};

  return {
    ok: true,
    order: {
      channel: 'yemeksepeti',
      externalId,
      displayId: String(order.order_code || order.external_order_id || externalId).trim(),
      status: mapYemeksepetiOrderStatus(order.status),
      channelStatus: String(order.status || '').trim() || null,
      channelIntegrationMode: 'direct',
      deliveryMode: mapYemeksepetiDeliveryMode(order),
      shadowMode: options.shadowMode ?? true,
      customer: {
        name: customer.name || customer.full_name || null,
        phone: customer.phone || customer.mobile || null,
        address: order.delivery?.address?.formatted || order.delivery?.address || null
      },
      rawPayload: {
        source: 'webhook',
        orderId: externalId,
        orderCode: order.order_code || null,
        vendorId: order.vendor_id || order.vendorId || null,
        chainId: order.chain_id || order.chainId || null,
        yemeksepetiOrder: order
      },
      orderedAt: new Date(createdAt).toISOString(),
      ingestSource: 'webhook',
      lines
    }
  };
}

export async function normalizeYemeksepetiPollOrder(normalizedProfitOrder, options = {}) {
  const externalId = String(normalizedProfitOrder.shipmentPackageId || normalizedProfitOrder.orderNumber || '').trim();
  if (!externalId) {
    return { ok: false, errors: ['YS poll order id eksik'] };
  }

  const raw = {
    order_id: externalId,
    order_code: normalizedProfitOrder.orderNumber,
    status: normalizedProfitOrder.status || 'RECEIVED',
    sys: { created_at: normalizedProfitOrder.orderDate || new Date().toISOString() },
    items: (normalizedProfitOrder.lines || []).map((line) => ({
      sku: line.stockCode || line.barcode,
      barcode: line.barcode,
      name: line.productName,
      pricing: {
        quantity: line.quantity,
        unit_price: line.lineUnitPrice ?? line.unitPrice
      }
    }))
  };

  return normalizeYemeksepetiWebhookOrder(raw, options);
}

export async function normalizeYemeksepetiPortalSummaryOrder(summary, options = {}) {
  const externalId = String(summary?.orderId || '').trim();
  if (!externalId) {
    return { ok: false, errors: ['Portal orderId eksik'] };
  }

  const subtotal = Number(summary?.subtotal) || 0;
  const raw = {
    order_id: externalId,
    order_code: externalId,
    status: summary.orderStatus || 'PICKED_UP',
    delivery_type: summary.deliveryType || 'vendor_delivery',
    sys: { created_at: summary.placedTimestamp || new Date().toISOString() },
    items: subtotal > 0
      ? [{
          sku: 'portal-summary',
          name: 'Portal sipariş özeti',
          pricing: { quantity: 1, unit_price: subtotal }
        }]
      : []
  };

  const normalized = await normalizeYemeksepetiWebhookOrder(raw, options);
  if (!normalized.ok) {
    return normalized;
  }

  normalized.order.ingestSource = options.ingestSource || 'portal_api';
  normalized.order.rawPayload = {
    source: 'portal_api',
    orderId: externalId,
    portalSummary: summary,
    grossAmount: subtotal,
    netRevenue: summary?.billing?.netRevenue ?? null,
    commissionAmount: summary?.billing?.commissionAmount ?? null
  };
  return normalized;
}
