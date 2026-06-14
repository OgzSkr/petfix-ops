import { resolveRealUtcOrderDateRange } from '../order-profitability.js';
import { ORDER_SOURCES } from '../production/constants.js';
import { dedupeOrderPackages } from './dedupe-order-packages.js';
import { consolidateOrderLines } from './consolidate-order-lines.js';
import { normalizeYemeksepetiOrder } from './yemeksepeti-orders.js';
import { portalSummaryToProfitPackage } from './yemeksepeti-portal-orders.js';
import {
  hasRealYemeksepetiLines,
  isYsPortalPlaceholderLine
} from './yemeksepeti-order-enrich.js';

/** Ops Hub kanal id → buybox kanal id */
export const OPS_CHANNEL_BY_BUYBOX = Object.freeze({
  'uber-eats': 'trendyol_go',
  yemeksepeti: 'yemeksepeti'
});

export { dedupeOrderPackages } from './dedupe-order-packages.js';

async function resolveOpsPool() {
  try {
    const { bootstrapOpsHub, getOpsHubPool, isOpsHubReady } = await import('../ops-hub/bootstrap.js');
    const { readEnvFile } = await import('../env.js');
    const { paths } = await import('../config.js');
    if (!isOpsHubReady()) {
      await bootstrapOpsHub(await readEnvFile(paths.platformEnv));
    }
    return getOpsHubPool();
  } catch {
    return null;
  }
}

function parseLinesJson(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function lineSalesTotal(lines) {
  return lines.reduce((sum, line) => {
    const qty = Number(line.quantity) || 1;
    const unit = Number(line.unit_price ?? line.unitPrice) || 0;
    return sum + qty * unit;
  }, 0);
}

/** Eski TGO ingest'te birim fiyatlar yanlışlıkla /100 kaydedildi; brüt tutarla hizala. */
function rescaleTgoOpsLinesIfNeeded(rawLines, grossAmount) {
  const lines = parseLinesJson(rawLines);
  if (!lines.length) return lines;

  const gross = Number(grossAmount) || 0;
  const computed = lineSalesTotal(lines);
  if (!gross || !computed || computed <= 0) return lines;

  const ratio = gross / computed;
  if (ratio < 50 || ratio > 150) return lines;

  return lines.map((line) => {
    const unit = Number(line.unit_price ?? line.unitPrice) || 0;
    const scaled = unit * ratio;
    return { ...line, unit_price: scaled, unitPrice: scaled };
  });
}

function extractNameFromRaw(raw) {
  const tgoCustomer = raw.customer || raw.package?.customer;
  if (tgoCustomer && typeof tgoCustomer === 'object') {
    const joined = [tgoCustomer.firstName, tgoCustomer.lastName].filter(Boolean).join(' ').trim();
    const name = tgoCustomer.fullName || tgoCustomer.name || joined || tgoCustomer.firstName || null;
    if (name) return String(name).trim();
  }
  const order = raw.yemeksepetiOrder || raw.order || raw;
  const customer = order.customer || order.delivery?.customer || {};
  const name = customer.name || customer.full_name || customer.fullName || null;
  return name ? String(name).trim() : null;
}

function extractCustomerName(row) {
  const fromRaw = extractNameFromRaw(row.raw_payload || {});
  const masked = String(row.customer_masked?.name || '').trim();
  if (fromRaw) return fromRaw;
  if (masked && !masked.includes('*')) return masked;
  return null;
}

function extractCustomerPhone(row) {
  const cm = row.customer_masked || {};
  if (cm.phone && !String(cm.phone).includes('*')) return String(cm.phone).trim();
  const raw = row.raw_payload || {};
  const customer = raw.customer || {};
  if (customer.phone) return String(customer.phone).trim();
  const order = raw.yemeksepetiOrder || raw.order || raw;
  const orderCustomer = order.customer || order.delivery?.customer || {};
  const phone = orderCustomer.phone || orderCustomer.mobile || null;
  return phone ? String(phone).trim() : null;
}

function extractCustomerAddress(row) {
  const cm = row.customer_masked || {};
  if (cm.address && !String(cm.address).includes('*')) return String(cm.address).trim();
  const raw = row.raw_payload || {};
  const customer = raw.customer || {};
  if (customer.address) return String(customer.address).trim();
  const shipment = raw.shipmentAddress || {};
  const invoice = raw.invoiceAddress || {};
  const parts = [
    shipment.addressDescription || shipment.address1 || shipment.address,
    shipment.neighborhood,
    shipment.district,
    shipment.city,
    invoice.addressDescription || invoice.address1 || invoice.address,
    invoice.district,
    invoice.city
  ]
    .map((part) => String(part || '').trim())
    .filter(Boolean);
  if (parts.length) return parts.join(' / ');
  const order = raw.yemeksepetiOrder || raw.order || raw;
  const delivery = order.delivery || order.delivery_address || {};
  const address = delivery.address || delivery.full_address || delivery.fullAddress || null;
  return address ? String(address).trim() : null;
}

function extractPaymentMethod(row) {
  const raw = row.raw_payload || {};
  const order = raw.yemeksepetiOrder || raw.order || raw;
  const payment = order.payment || raw.payment || {};
  const method = payment.method || payment.type || payment.payment_type || raw.paymentMethod || null;
  if (!method) return 'Online';
  const normalized = String(method).toLowerCase();
  if (normalized.includes('cash') || normalized.includes('nakit')) return 'Nakit';
  if (normalized.includes('card') || normalized.includes('online') || normalized.includes('credit')) return 'Online';
  return String(method);
}

function extractDeliveryMethod(row, channel) {
  const raw = row.raw_payload || {};
  const portalType = raw.portalSummary?.deliveryType;
  if (portalType) {
    const mapped = mapPortalDeliveryTypeFromRaw(portalType, channel);
    if (mapped) return mapped;
  }
  const dm = row.delivery_mode;
  const order = raw.yemeksepetiOrder || raw.order || raw;
  const fromOrder = order.delivery_type || order.delivery?.type || order.logistics?.provider || null;
  if (fromOrder) {
    const mapped = mapPortalDeliveryTypeFromRaw(fromOrder, channel);
    if (mapped) return mapped;
  }
  if (!dm) return null;
  const labels = {
    platform_courier: channel === 'uber-eats' ? 'Trendyol Kuryesi' : 'Platform Kuryesi',
    own_courier: 'Restoran Kuryesi',
    pickup: 'Gel Al',
    unknown: null
  };
  return labels[dm] ?? null;
}

function mapPortalDeliveryTypeFromRaw(deliveryType, channel) {
  const value = String(deliveryType || '').toLowerCase();
  if (value.includes('vendor') || value.includes('own') || value.includes('restaurant')) return 'Restoran Kuryesi';
  if (value.includes('pickup') || value.includes('collection')) return 'Gel Al';
  if (value.includes('platform') || value.includes('courier') || value.includes('hero')) {
    return channel === 'uber-eats' ? 'Trendyol Kuryesi' : 'Platform Kuryesi';
  }
  return null;
}

function opsCustomerFields(row, channel) {
  const raw = row.raw_payload || {};
  const customer = raw.customer || {};
  return {
    customerName: extractCustomerName(row),
    customerPhone: extractCustomerPhone(row),
    customerAddress: extractCustomerAddress(row),
    customerIdentityNumber: customer.identityNumber || null,
    customerNote: customer.note || null,
    customerLocationMasked: customer.locationMasked ?? raw.locationMasked ?? null,
    paymentMethod: extractPaymentMethod(row),
    deliveryMethod: extractDeliveryMethod(row, channel)
  };
}

function opsBenimposMeta(row) {
  const code = String(row.benimpos_sales_code || '').trim();
  return { benimposSalesCode: code || null };
}

function mapOpsLinesToProfitLines(lines) {
  return consolidateOrderLines(lines.map((line) => ({
    barcode: String(line.barcode || '').trim(),
    productName: line.title || '',
    quantity: Number(line.quantity) || 1,
    lineUnitPrice: Number(line.unit_price ?? line.unitPrice) || 0,
    unitPrice: Number(line.unit_price ?? line.unitPrice) || 0,
    stockCode: line.channel_product_id || line.channelProductId || '',
    imageUrl: String(line.image_url || line.imageUrl || '').trim() || null
  })));
}

function packageFromYemeksepetiDbRow(row, lines, raw) {
  if (!lines.length && !row.external_id) {
    return null;
  }

  return {
    orderNumber: row.display_id || row.external_id,
    shipmentPackageId: row.external_id,
    orderDate: row.ordered_at,
    status: row.channel_status || row.status || '',
    packageGrossAmount: Number(raw.grossAmount) || lineSalesTotal(parseLinesJson(row.lines)),
    lines,
    rawPayload: raw,
    partnerOrderId: raw.partnerOrderId || raw.partnerOrderUuid || null,
    ...opsCustomerFields(row, 'yemeksepeti'),
    ...opsBenimposMeta(row),
    ingestSource: row.ingest_source || ORDER_SOURCES.WEBHOOK
  };
}

export function packageFromYemeksepetiOpsRow(row) {
  const raw = row.raw_payload || {};
  const dbLines = mapOpsLinesToProfitLines(parseLinesJson(row.lines));
  const realDbLines = dbLines.filter((line) => !isYsPortalPlaceholderLine(line));

  const order = raw.yemeksepetiOrder || raw.order;
  if (order && typeof order === 'object') {
    const normalized = normalizeYemeksepetiOrder(order);
    if (hasRealYemeksepetiLines(normalized.lines)) {
      return {
        ...normalized,
        rawPayload: raw,
        partnerOrderId: String(order.order_id || order.id || raw.partnerOrderId || '').trim() || null,
        ...opsCustomerFields(row, 'yemeksepeti'),
        ...opsBenimposMeta(row),
        ingestSource: row.ingest_source || ORDER_SOURCES.WEBHOOK
      };
    }
  }

  if (hasRealYemeksepetiLines(realDbLines)) {
    return packageFromYemeksepetiDbRow(row, realDbLines, raw);
  }

  if (raw.portalSummary && typeof raw.portalSummary === 'object') {
    const pkg = portalSummaryToProfitPackage(raw.portalSummary, row.ingest_source || ORDER_SOURCES.PORTAL);
    if (pkg) {
      return {
        ...pkg,
        rawPayload: raw,
        ...opsCustomerFields(row, 'yemeksepeti'),
        ...opsBenimposMeta(row),
        deliveryMethod: pkg.deliveryMethod || extractDeliveryMethod(row, 'yemeksepeti')
      };
    }
  }

  if (dbLines.length) {
    return packageFromYemeksepetiDbRow(row, dbLines, raw);
  }

  return packageFromYemeksepetiDbRow(row, [], raw);
}

export function packageFromUberOpsRow(row) {
  const raw = row.raw_payload || {};
  const grossHint = raw.grossAmount ?? raw.totalPrice;
  const opsLines = rescaleTgoOpsLinesIfNeeded(row.lines, grossHint);
  const lines = mapOpsLinesToProfitLines(opsLines);
  const gross = Number(grossHint) || lineSalesTotal(opsLines);

  return {
    orderNumber: row.display_id || row.external_id,
    shipmentPackageId: row.external_id,
    orderDate: row.ordered_at,
    status: row.channel_status || row.status || '',
    packageGrossAmount: gross,
    lines,
    ...opsCustomerFields(row, 'uber-eats'),
    ...opsBenimposMeta(row),
    ingestSource: row.ingest_source || ORDER_SOURCES.WEBHOOK
  };
}

/**
 * Ops Postgres (webhook + poll) siparişlerini kârlılık paket formatına çevirir.
 */
export async function fetchOpsOrderPackages(buyboxChannelId, options = {}) {
  const opsChannel = OPS_CHANNEL_BY_BUYBOX[buyboxChannelId];
  if (!opsChannel) return [];

  const pool = await resolveOpsPool();
  if (!pool) return [];

  const { startDate, endDate } = resolveRealUtcOrderDateRange(options);
  const result = await pool.query(
    `SELECT o.external_id, o.display_id, o.status, o.channel_status, o.ordered_at,
            o.ingest_source, o.raw_payload, o.customer_masked, o.delivery_mode,
            o.benimpos_sales_code,
            COALESCE(
              json_agg(
                json_build_object(
                  'barcode', l.barcode,
                  'title', l.title,
                  'quantity', l.quantity,
                  'unit_price', l.unit_price,
                  'channel_product_id', l.channel_product_id
                )
                ORDER BY l.line_index
              ) FILTER (WHERE l.id IS NOT NULL),
              '[]'::json
            ) AS lines
     FROM ops_orders o
     LEFT JOIN ops_order_lines l ON l.order_id = o.id
     WHERE o.channel = $1
     GROUP BY o.id
     ORDER BY o.ordered_at DESC
     LIMIT 500`,
    [opsChannel]
  );

  const packages = [];
  for (const row of result.rows) {
    const orderedMs = row.ordered_at ? new Date(row.ordered_at).getTime() : 0;
    if (orderedMs && startDate && orderedMs < startDate) continue;
    if (orderedMs && endDate && orderedMs > endDate) continue;

    if (buyboxChannelId === 'yemeksepeti') {
      const pkg = packageFromYemeksepetiOpsRow(row);
      if (pkg) packages.push(pkg);
      continue;
    }

    if (buyboxChannelId === 'uber-eats') {
      packages.push(packageFromUberOpsRow(row));
    }
  }

  return packages;
}

export async function mergeChannelOrderSources(buyboxChannelId, apiPackages, options = {}) {
  const taggedApi = (apiPackages || []).map((pkg) => ({
    ...pkg,
    ingestSource: pkg.ingestSource || ORDER_SOURCES.PARTNER_API
  }));
  const opsPackages = await fetchOpsOrderPackages(buyboxChannelId, options);
  return dedupeOrderPackages([...taggedApi, ...opsPackages]);
}
