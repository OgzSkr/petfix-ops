import { readEnvFile } from '../../env.js';
import { paths, resolveRuntimeConfig } from '../../config.js';
import { resolveMatchingModeForChannel, resolveChannelLine } from '../../product-matching/resolve.js';
import { readDb } from '../../db/store.js';
import { ORDER_SOURCES } from '../../production/constants.js';
import { unwrapGetirOrderPayload, resolveGetirExternalId } from '../../channels/getir-order-payload.js';
import { parseWeightGrams } from '../../product-matching/normalize.js';

export { unwrapGetirOrderPayload, resolveGetirExternalId } from '../../channels/getir-order-payload.js';

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

/** Getir panelinde gerçekten tamamlanmış sayılan kanal kodları. */
export function isGetirChannelCompleted(channelStatus) {
  const code = String(channelStatus ?? '').trim();
  return code === '900' || code === '1500';
}

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

function isGetirWeightedLineType(type) {
  const key = String(type || '').trim().toLowerCase();
  return key === 'gr' || key === 'gram' || key === 'weight';
}

function stripLineTitleWeightSuffix(title) {
  return String(title || '').replace(/\s·\s*\d+\s*g\s*$/i, '').trim();
}

/** Getir gramajlı (type=gr) satırlarında verilen ağırlık — gram cinsinden. */
export function parseGetirLineWeightGrams(item) {
  if (!item || typeof item !== 'object') return null;

  const type = String(item.type || item.productType || '').trim().toLowerCase();

  // type=count: totalWeight = adet × paket ağırlığı (örn. 2×1 kg → 2200). Terazi değildir.
  if (!isGetirWeightedLineType(type)) {
    return null;
  }

  const weightFields = [
    item.totalWeight,
    item.finalTotalWeight,
    item.weight,
    item.weightInGrams,
    item.weightInGram,
    item.soldWeight,
    item.suppliedWeight
  ];

  for (const raw of weightFields) {
    const grams = Math.round(Number(raw));
    if (Number.isFinite(grams) && grams > 0) {
      return grams;
    }
  }

  const count = toNumber(item.count ?? item.quantity);
  if (count > 1 && count <= 9999) return Math.round(count);

  return null;
}

function formatLineTitleWithWeight(title, orderGrams) {
  const base = String(title || '').trim();
  if (!base || !orderGrams) return base;
  if (parseWeightGrams(base)) return base;
  return `${base} · ${orderGrams} g`;
}

function findGetirProductForLine(products, line, lineIndex) {
  if (!Array.isArray(products) || !products.length) return null;
  const byIndex = products[lineIndex];
  if (byIndex) return byIndex;

  const key = String(
    line?.channelProductId ||
    line?.channel_product_id ||
    line?.stockCode ||
    ''
  ).trim();
  if (!key) return null;

  return products.find((product) => {
    const ids = [
      product?.catalogProductId,
      product?.product,
      product?.id,
      product?._id,
      product?.menuProductId
    ].map((value) => String(value || '').trim()).filter(Boolean);
    return ids.includes(key);
  }) || null;
}

/** Mevcut satırlara raw_payload.products içinden gramaj ekler (eski ingest kayıtları). */
export function enrichGetirOrderLinesWithWeight(lines, rawPayload = {}) {
  const products = extractGetirLines(rawPayload);
  return (lines || []).map((line, lineIndex) => {
    const product = findGetirProductForLine(products, line, lineIndex);
    const orderGrams = parseGetirLineWeightGrams(product);
    const baseTitle = lineTitle(product)
      || stripLineTitleWeightSuffix(line.title || line.productName || '');

    if (!orderGrams) {
      if (!line.orderGrams && !line.totalWeightGrams) return line;
      return {
        ...line,
        orderGrams: null,
        totalWeightGrams: null,
        title: baseTitle || line.title
      };
    }

    return {
      ...line,
      orderGrams,
      totalWeightGrams: orderGrams,
      title: formatLineTitleWithWeight(baseTitle, orderGrams)
    };
  });
}

function resolveGetirLineProductId(item, externalId, lineIndex, barcode) {
  const direct = String(
    item?.catalogProductId ??
    item?.product ??
    item?.productId ??
    item?.getirId ??
    item?.id ??
    item?._id ??
    ''
  ).trim();
  if (direct) return direct;
  if (barcode) return `getir-barcode-${barcode}`;
  return `getir-line-${externalId}-${lineIndex}`;
}

export async function normalizeGetirPollOrder(orderInput, options = {}) {
  const order = unwrapGetirOrderPayload(orderInput);
  if (!order || typeof order !== 'object' || Array.isArray(order)) {
    return { ok: false, errors: ['Getir sipariş gövdesi geçersiz'] };
  }

  const externalId = resolveGetirExternalId(order);
  if (!externalId) {
    const keys = Object.keys(order).slice(0, 12).join(', ');
    return {
      ok: false,
      errors: [keys ? `Getir sipariş id eksik (alanlar: ${keys})` : 'Getir sipariş id eksik']
    };
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

  const gross = toNumber(
    order?.totalPriceWithPackaging ??
    order?.totalPrice ??
    order?.totalAmount ??
    order?.payment?.total ??
    order?.price
  );

  const lines = [];
  for (const [lineIndex, item] of extractGetirLines(order).entries()) {
    const barcode = lineBarcode(item);
    const quantity = toNumber(item?.count ?? item?.quantity) || 1;
    const unitPrice = lineUnitPrice(item);
    const channelProductId = resolveGetirLineProductId(item, externalId, lineIndex, barcode);
    const resolved = await resolveChannelLine(db, {
      channel: 'getir',
      barcode,
      channelProductId,
      title: lineTitle(item)
    });
    const orderGrams = parseGetirLineWeightGrams(item);
    const title = formatLineTitleWithWeight(
      lineTitle(item) || resolved.title || barcode,
      orderGrams
    );
    lines.push({
      channelProductId,
      barcode: resolved.barcode || barcode,
      title,
      quantity,
      unit_price: unitPrice,
      unitPrice,
      orderGrams: orderGrams || null,
      totalWeightGrams: orderGrams || null,
      matchingStatus: mapMatchingToOpsStatus(resolved, matchingMode)
    });
  }

  if (!lines.length && gross > 0) {
    lines.push({
      channelProductId: `getir-summary-${externalId}`,
      barcode: '',
      title: 'Getir sipariş',
      quantity: 1,
      unit_price: gross,
      unitPrice: gross,
      matchingStatus: 'legacy'
    });
  }

  const customer = order?.client || order?.customer || {};

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
  const order = unwrapGetirOrderPayload(body);
  if (!order || typeof order !== 'object' || Array.isArray(order)) {
    return Promise.resolve({ ok: false, errors: ['Getir webhook gövdesi geçersiz'] });
  }
  return normalizeGetirPollOrder(order, {
    ...options,
    ingestSource: options.ingestSource || ORDER_SOURCES.WEBHOOK
  });
}
