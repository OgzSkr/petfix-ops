import { readEnvFile } from '../../env.js';
import { paths, resolveRuntimeConfig } from '../../config.js';
import { resolveMatchingModeForChannel, resolveChannelLine } from '../../product-matching/resolve.js';
import { readDb } from '../../db/store.js';
import { ORDER_SOURCES } from '../../production/constants.js';

const GETIR_STATUS_TO_OPS = Object.freeze({
  400: 'received',
  500: 'picking',
  550: 'picking',
  600: 'ready',
  700: 'ready',
  800: 'ready',
  900: 'completed',
  1500: 'completed',
  1600: 'cancelled'
});

/** Getir Çarşı paymentMethod kodları — delivered API çoğu zaman yalnızca sayı döner. */
export const GETIR_PAYMENT_METHOD_LABELS = Object.freeze({
  1: 'Online',
  2: 'Nakit',
  3: 'Kapıda kart'
});

export function formatGetirPaymentMethod(source = {}) {
  const text = source.paymentMethodText || source.payment_method_text;
  if (text && typeof text === 'object') {
    const label = String(text.tr || text.en || '').trim();
    if (label) return label;
  }

  const code = source.paymentMethod ?? source.payment_method ?? source.payment?.method;
  if (code == null || code === '') return 'Online';

  const numeric = Number(code);
  if (Number.isFinite(numeric) && GETIR_PAYMENT_METHOD_LABELS[numeric]) {
    return GETIR_PAYMENT_METHOD_LABELS[numeric];
  }

  const key = String(code).trim().toLowerCase();
  if (key.includes('cash') || key.includes('nakit')) return 'Nakit';
  if (key.includes('card') || key.includes('online') || key.includes('credit')) return 'Online';

  return 'Online';
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function mapMatchingToOpsStatus(resolved, mode) {
  if (resolved.source === 'mapping') return 'matched';
  if (mode === 'strict') return 'blocked';
  if (resolved.mappingStatus === 'unmapped') return 'unmapped';
  return 'legacy';
}

export function mapGetirOrderStatus(order, endpointKind = '') {
  if (endpointKind === 'cancelled') return 'cancelled';
  if (endpointKind === 'delivered') return 'completed';
  const status = order?.status ?? order?.orderStatus ?? order?.state;
  const code = Number(status);
  if (Number.isFinite(code) && GETIR_STATUS_TO_OPS[code]) {
    return GETIR_STATUS_TO_OPS[code];
  }
  const key = String(status || '').trim().toUpperCase();
  if (key.includes('CANCEL')) return 'cancelled';
  if (key.includes('DELIVER') || key.includes('COMPLETE')) return 'completed';
  return 'received';
}

export function mapGetirDeliveryMode(order) {
  const deliveryType = Number(order?.deliveryType ?? order?.delivery?.type);
  if (deliveryType === 1) return 'platform_courier';
  if (deliveryType === 2) return 'own_courier';
  return 'unknown';
}

function extractGetirLines(order) {
  const candidates = [
    order?.products,
    order?.items,
    order?.orderProducts,
    order?.lines
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length) return candidate;
  }
  return [];
}

function lineBarcode(item) {
  const fromList = Array.isArray(item?.barcodes) ? item.barcodes[0] : '';
  return String(
    item?.barcode ||
    fromList ||
    item?.productBarcode ||
    item?.barcodeNo ||
    item?.sku ||
    ''
  ).trim();
}

function lineTitle(item) {
  const name = item?.name;
  if (name && typeof name === 'object') {
    const localized = String(name.tr || name.en || '').trim();
    if (localized) return localized;
  }
  return String(
    name ||
    item?.productName ||
    item?.title ||
    item?.product?.name ||
    ''
  ).trim();
}

function lineUnitPrice(item) {
  const direct = toNumber(item?.price ?? item?.unitPrice ?? item?.salePrice);
  if (direct) return direct;
  const total = toNumber(item?.totalPrice ?? item?.amount);
  const qty = toNumber(item?.count ?? item?.quantity) || 1;
  return qty > 0 ? total / qty : 0;
}

export async function normalizeGetirPollOrder(order, options = {}) {
  const externalId = String(
    order?.id ||
    order?.orderId ||
    order?.order_id ||
    ''
  ).trim();
  if (!externalId) {
    return { ok: false, errors: ['Getir sipariş id eksik'] };
  }

  const displayId = String(
    order?.confirmationId ||
    order?.orderNumber ||
    order?.code ||
    externalId
  ).trim();

  const platformEnv = options.platformEnv || (await readEnvFile(paths.platformEnv));
  const runtimeConfig = resolveRuntimeConfig(platformEnv);
  const matchingMode = resolveMatchingModeForChannel('getir', runtimeConfig);
  const db = options.db || (await readDb());

  const lines = [];
  for (const item of extractGetirLines(order)) {
    const barcode = lineBarcode(item);
    const quantity = toNumber(item?.count ?? item?.quantity) || 1;
    const unitPrice = lineUnitPrice(item);
    const channelProductId = String(
      item?.catalogProductId ?? item?.product ?? item?.productId ?? item?.getirId ?? item?.id ?? ''
    ).trim();
    const resolved = await resolveChannelLine(db, {
      channel: 'getir',
      barcode,
      channelProductId,
      title: lineTitle(item)
    });
    lines.push({
      channelProductId,
      barcode: resolved.barcode || barcode,
      title: lineTitle(item) || resolved.title || barcode,
      quantity,
      unit_price: unitPrice,
      unitPrice,
      matchingStatus: mapMatchingToOpsStatus(resolved, matchingMode)
    });
  }

  const customer = order?.client || order?.customer || {};
  const gross = toNumber(
    order?.totalPrice ??
    order?.totalAmount ??
    order?.payment?.total ??
    order?.price
  );

  return {
    ok: true,
    order: {
      channel: 'getir',
      externalId,
      displayId,
      channelStatus: String(order?.status ?? ''),
      status: mapGetirOrderStatus(order, options.endpointKind),
      channelIntegrationMode: 'direct',
      deliveryMode: mapGetirDeliveryMode(order),
      orderedAt: order?.checkoutDate || order?.createdAt || order?.orderDate || new Date().toISOString(),
      ingestSource: options.ingestSource || ORDER_SOURCES.PARTNER_API,
      customer: {
        name: String(customer?.name || customer?.fullName || '').trim() || null,
        phone: String(customer?.phone || customer?.mobile || '').trim() || null,
        address: String(customer?.address || customer?.deliveryAddress || '').trim() || null,
        note: String(order?.clientNote || order?.note || '').trim() || null
      },
      rawPayload: {
        ...order,
        shopId: options.shopId || order?.shopId || null,
        grossAmount: gross || null
      },
      lines
    }
  };
}

export function normalizeGetirWebhookOrder(body, options = {}) {
  const order = body?.order || body?.data?.order || body?.data || body;
  if (!order || typeof order !== 'object') {
    return Promise.resolve({ ok: false, errors: ['Getir webhook gövdesi geçersiz'] });
  }
  return normalizeGetirPollOrder(order, {
    ...options,
    ingestSource: options.ingestSource || ORDER_SOURCES.WEBHOOK
  });
}
