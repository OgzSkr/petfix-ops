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
import { formatGetirPaymentMethod, mapGetirOrderStatus, enrichGetirOrderLinesWithWeight } from '../ops-hub/channels/getir-normalize.js';
import { buildCustomerPhoneDisplay } from '../ops-hub/customer/order-customer-view.js';
import { resolveTgoLinePricing } from './tgo-line-pricing.js';

/** Ops Hub kanal id → buybox kanal id */
export const OPS_CHANNEL_BY_BUYBOX = Object.freeze({
  'uber-eats': 'trendyol_go',
  yemeksepeti: 'yemeksepeti',
  getir: 'getir'
});

export { dedupeOrderPackages } from './dedupe-order-packages.js';

/** Ops Postgres üzerinden sipariş listelenebilir (API kimlik bilgisi şart değil). */
export async function canListOpsOrders(buyboxChannelId) {
  const opsChannel = OPS_CHANNEL_BY_BUYBOX[buyboxChannelId];
  if (!opsChannel) return false;
  const pool = await resolveOpsPool();
  return Boolean(pool);
}

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

/**
 * Eski TGO ingest'te birim fiyatlar yanlışlıkla /100 kaydedildi; brüt tutarla hizala.
 */
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

function extractPaymentMethod(row, channel) {
  const raw = row.raw_payload || {};
  const order = raw.yemeksepetiOrder || raw.order || raw;
  const payment = order.payment || raw.payment || {};

  if (channel === 'getir') {
    return formatGetirPaymentMethod({ ...raw, payment });
  }

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
  const opsChannel = row.channel || channel;
  return {
    customerName: extractCustomerName(row),
    customerPhone: buildCustomerPhoneDisplay(
      { ...row, channel: opsChannel },
      { displayId: row.display_id, externalId: row.external_id }
    ),
    customerAddress: extractCustomerAddress(row),
    customerIdentityNumber: customer.identityNumber || null,
    customerNote: customer.note || null,
    customerLocationMasked: customer.locationMasked ?? raw.locationMasked ?? null,
    paymentMethod: extractPaymentMethod(row, channel),
    deliveryMethod: extractDeliveryMethod(row, channel)
  };
}

function opsBenimposMeta(row) {
  const code = String(row.benimpos_sales_code || '').trim();
  return { benimposSalesCode: code || null };
}

/**
 * Eski TGO ingest kayıtlarında unit_price indirimli birim (150) olarak kalmış olabilir;
 * raw_payload.tgoSourceLines varsa katalog birim fiyatını yeniden çöz.
 */
function enrichTgoOpsDbLines(rawLines, rawPayload = {}) {
  const lines = parseLinesJson(rawLines);
  const sourceLines = rawPayload?.tgoSourceLines;
  if (!Array.isArray(sourceLines) || !sourceLines.length || !lines.length) {
    return lines;
  }

  return lines.map((line, index) => {
    const sourceLine = sourceLines[index]
      || sourceLines.find((row) => String(row?.barcode || '').trim() === String(line.barcode || '').trim());
    if (!sourceLine) return line;

    const pricing = resolveTgoLinePricing(sourceLine);
    return {
      ...line,
      unit_price: pricing.unitPrice,
      unitPrice: pricing.unitPrice,
      paidUnitPrice: pricing.paidUnitPrice,
      paidLineGross: pricing.paidLineGross,
      lineGrossAmount: pricing.lineGross,
      lineSalesAmount: pricing.lineGross
    };
  });
}

function mapOpsLinesToProfitLines(lines) {
  return consolidateOrderLines(lines.map((line) => ({
    barcode: String(line.barcode || '').trim(),
    productName: line.title || '',
    name: line.title || '',
    title: line.title || '',
    quantity: Number(line.quantity) || 1,
    lineUnitPrice: Number(line.unit_price ?? line.unitPrice) || 0,
    unitPrice: Number(line.unit_price ?? line.unitPrice) || 0,
    lineGrossAmount: line.lineGrossAmount ?? line.lineSalesAmount ?? undefined,
    lineSalesAmount: line.lineGrossAmount ?? line.lineSalesAmount ?? undefined,
    paidLineGross: line.paidLineGross != null ? Number(line.paidLineGross) : undefined,
    stockCode: line.channel_product_id || line.channelProductId || '',
    orderGrams: line.orderGrams ?? line.totalWeightGrams ?? null,
    imageUrl: String(line.image_url || line.imageUrl || '').trim() || null,
    frozenUnitCost: line.unit_cost != null ? Number(line.unit_cost) : (line.unitCost ?? null),
    unitCost: line.unit_cost != null ? Number(line.unit_cost) : (line.unitCost ?? null),
    costSource: line.cost_source || line.costSource || null
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

export function packageFromGetirOpsRow(row) {
  const raw = row.raw_payload || {};
  const lines = mapOpsLinesToProfitLines(
    enrichGetirOrderLinesWithWeight(parseLinesJson(row.lines), raw)
  );
  const gross = Number(raw.grossAmount ?? raw.totalPriceWithPackaging ?? raw.totalPrice)
    || lineSalesTotal(parseLinesJson(row.lines));
  const opsStatus = String(row.status || '').trim();
  const status = opsStatus && !/^\d+$/.test(opsStatus)
    ? opsStatus
    : mapGetirOrderStatus({ ...raw, status: row.channel_status || row.status || raw.status });

  return {
    channel: 'getir',
    orderNumber: row.display_id || row.external_id,
    shipmentPackageId: row.external_id,
    orderDate: row.ordered_at,
    status,
    packageGrossAmount: gross,
    lines,
    rawPayload: raw,
    paymentMethod: formatGetirPaymentMethod(raw),
    ...opsCustomerFields(row, 'getir'),
    ...opsBenimposMeta(row),
    ingestSource: row.ingest_source || ORDER_SOURCES.WEBHOOK
  };
}

/** Poll/webhook normalize çıktısı → kârlılık paketi (canlı API birleştirmesi). */
export function profitPackageFromGetirNormalized(order) {
  const raw = order.rawPayload || {};
  const lines = mapOpsLinesToProfitLines(
    enrichGetirOrderLinesWithWeight((order.lines || []).map((line) => ({
      barcode: line.barcode,
      title: line.title,
      quantity: line.quantity,
      unit_price: line.unitPrice ?? line.unit_price,
      channel_product_id: line.channelProductId,
      orderGrams: line.orderGrams ?? line.totalWeightGrams ?? null
    })), raw)
  );
  const gross = Number(raw.grossAmount ?? raw.totalPriceWithPackaging ?? raw.totalPrice)
    || lineSalesTotal(order.lines || []);

  return {
    channel: 'getir',
    orderNumber: order.displayId || order.externalId,
    shipmentPackageId: order.externalId,
    orderDate: order.orderedAt,
    status: order.status || mapGetirOrderStatus(raw),
    packageGrossAmount: gross,
    lines,
    rawPayload: raw,
    paymentMethod: formatGetirPaymentMethod(raw),
    ingestSource: order.ingestSource || ORDER_SOURCES.WEBHOOK
  };
}

export function packageFromUberOpsRow(row) {
  const raw = row.raw_payload || {};
  const grossHint = raw.grossAmount ?? raw.totalPrice;
  const opsLines = rescaleTgoOpsLinesIfNeeded(
    enrichTgoOpsDbLines(row.lines, raw),
    grossHint
  );
  const lines = mapOpsLinesToProfitLines(opsLines);
  const computedGross = lineSalesTotal(opsLines);
  const gross = computedGross > 0 ? computedGross : (Number(grossHint) || 0);

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
  const startTs = startDate ? new Date(startDate) : null;
  const endTs = endDate ? new Date(endDate) : null;
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
                  'channel_product_id', l.channel_product_id,
                  'unit_cost', l.unit_cost,
                  'cost_source', l.cost_source
                )
                ORDER BY l.line_index
              ) FILTER (WHERE l.id IS NOT NULL),
              '[]'::json
            ) AS lines
     FROM ops_orders o
     LEFT JOIN ops_order_lines l ON l.order_id = o.id
     WHERE o.channel = $1
       AND ($2::timestamptz IS NULL OR o.ordered_at >= $2)
       AND ($3::timestamptz IS NULL OR o.ordered_at <= $3)
     GROUP BY o.id
     ORDER BY o.ordered_at DESC
     LIMIT 500`,
    [opsChannel, startTs, endTs]
  );

  const packages = [];
  for (const row of result.rows) {
    if (buyboxChannelId === 'yemeksepeti') {
      const pkg = packageFromYemeksepetiOpsRow(row);
      if (pkg) packages.push(pkg);
      continue;
    }

    if (buyboxChannelId === 'uber-eats') {
      packages.push(packageFromUberOpsRow(row));
      continue;
    }

    if (buyboxChannelId === 'getir') {
      packages.push(packageFromGetirOpsRow(row));
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

const BUYBOX_BY_OPS_CHANNEL = Object.freeze({
  trendyol_go: 'uber-eats',
  yemeksepeti: 'yemeksepeti',
  getir: 'getir'
});

const OPS_ORDERS_LIST_SQL = `
  SELECT o.channel, o.external_id, o.display_id, o.status, o.channel_status, o.ordered_at,
         o.ingest_source, o.raw_payload, o.customer_masked, o.delivery_mode,
         o.benimpos_sales_code,
         COALESCE(
           json_agg(
             json_build_object(
               'barcode', l.barcode,
               'title', l.title,
               'quantity', l.quantity,
               'unit_price', l.unit_price,
               'channel_product_id', l.channel_product_id,
               'unit_cost', l.unit_cost,
               'cost_source', l.cost_source
             )
             ORDER BY l.line_index
           ) FILTER (WHERE l.id IS NOT NULL),
           '[]'::json
         ) AS lines
  FROM ops_orders o
  LEFT JOIN ops_order_lines l ON l.order_id = o.id`;

function resolveOpsChannelsForFilter(channelFilter = 'all') {
  const focus = String(channelFilter || 'all').trim();
  if (focus && focus !== 'all') {
    const ops = OPS_CHANNEL_BY_BUYBOX[focus];
    return ops ? [ops] : [];
  }
  return Object.values(OPS_CHANNEL_BY_BUYBOX);
}

function opsLifecycleClause(lifecycle) {
  if (lifecycle === 'completed') {
    return `AND o.status IN ('completed', 'cancelled')`;
  }
  if (lifecycle === 'active') {
    return `AND o.status NOT IN ('completed', 'cancelled')`;
  }
  return '';
}

function opsSearchClause(q, params) {
  const term = String(q || '').trim();
  if (!term) return '';
  params.push(`%${term}%`);
  const idx = params.length;
  return `AND (
    o.display_id ILIKE $${idx}
    OR o.external_id ILIKE $${idx}
    OR COALESCE(o.customer_masked::text, '') ILIKE $${idx}
    OR EXISTS (
      SELECT 1 FROM ops_order_lines l2
      WHERE l2.order_id = o.id
        AND (l2.title ILIKE $${idx} OR l2.barcode ILIKE $${idx})
    )
  )`;
}

function packageFromOpsDbRow(row) {
  const buyboxChannel = BUYBOX_BY_OPS_CHANNEL[row.channel];
  if (buyboxChannel === 'yemeksepeti') return packageFromYemeksepetiOpsRow(row);
  if (buyboxChannel === 'uber-eats') return packageFromUberOpsRow(row);
  if (buyboxChannel === 'getir') return packageFromGetirOpsRow(row);
  return null;
}

/**
 * Ops Postgres'ten sayfalı sipariş listesi — partner API çağrısı yapmaz.
 */
export async function listOpsProfitOrdersPaginated(options = {}) {
  const pool = await resolveOpsPool();
  if (!pool) return null;

  const opsChannels = resolveOpsChannelsForFilter(options.channelFilter);
  if (!opsChannels.length) {
    return {
      rows: [],
      total: 0,
      page: 1,
      limit: 25,
      totalPages: 1,
      lifecycleCounts: { active: 0, completed: 0 }
    };
  }

  const { startDate, endDate } = resolveRealUtcOrderDateRange(options);
  const startTs = startDate ? new Date(startDate) : null;
  const endTs = endDate ? new Date(endDate) : null;
  const lifecycle = options.lifecycle === 'completed' ? 'completed' : 'active';
  const page = Math.max(1, Number(options.page) || 1);
  const limit = Math.min(100, Math.max(5, Number(options.limit) || 25));
  const offset = (page - 1) * limit;

  const baseParams = [opsChannels, startTs, endTs];
  const rangeClause = `o.channel = ANY($1::text[])
    AND ($2::timestamptz IS NULL OR o.ordered_at >= $2)
    AND ($3::timestamptz IS NULL OR o.ordered_at <= $3)`;

  const countParams = [...baseParams];
  const searchClause = opsSearchClause(options.q, countParams);
  const lifecycleActiveParams = [...countParams];
  const lifecycleCompletedParams = [...countParams];

  const countsResult = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE o.status NOT IN ('completed', 'cancelled'))::int AS active_count,
       COUNT(*) FILTER (WHERE o.status IN ('completed', 'cancelled'))::int AS completed_count
     FROM ops_orders o
     WHERE ${rangeClause}
     ${searchClause}`,
    countParams
  );
  const lifecycleCounts = {
    active: Number(countsResult.rows[0]?.active_count) || 0,
    completed: Number(countsResult.rows[0]?.completed_count) || 0
  };

  const listParams = [...baseParams];
  const listSearch = opsSearchClause(options.q, listParams);
  const lifecycleClause = opsLifecycleClause(lifecycle);
  listParams.push(limit, offset);

  const listResult = await pool.query(
    `${OPS_ORDERS_LIST_SQL}
     WHERE ${rangeClause}
     ${listSearch}
     ${lifecycleClause}
     GROUP BY o.id
     ORDER BY o.ordered_at DESC
     LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );

  const totalParams = [...baseParams];
  const totalSearch = opsSearchClause(options.q, totalParams);
  const totalLifecycle = opsLifecycleClause(lifecycle);
  const totalResult = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM ops_orders o
     WHERE ${rangeClause}
     ${totalSearch}
     ${totalLifecycle}`,
    totalParams
  );
  const total = Number(totalResult.rows[0]?.total) || 0;

  return {
    dbRows: listResult.rows,
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    lifecycleCounts
  };
}

export async function analyzeOpsDbOrderRows(dbRows, db, options = {}) {
  const { getChannel } = await import('./registry.js');
  const { analyzeOrderPackages, orderDateTimezoneForChannel } = await import('../order-profitability.js');
  const { profitAnalysisSettingsForChannel } = await import('../profit-constants.js');
  const { costScopeForChannel } = await import('../cost-scopes.js');
  const { resolveMatchingModeForChannel } = await import('../product-matching/resolve.js');
  const { computeProfitConfidence } = await import('../production/profit-confidence.js');
  const { enrichRowsWithBenimposTransferStatus } = await import('../product-matching/benimpos-transfer-status.js');
  const { readEnvFile } = await import('../env.js');
  const { paths, resolveRuntimeConfig } = await import('../config.js');

  const platformEnv = options.platformEnv || (await readEnvFile(paths.platformEnv));
  const runtimeConfig = resolveRuntimeConfig(platformEnv);
  const rows = [];

  for (const dbRow of dbRows || []) {
    const buyboxChannelId = BUYBOX_BY_OPS_CHANNEL[dbRow.channel];
    if (!buyboxChannelId) continue;
    const channel = getChannel(buyboxChannelId);
    const pkg = packageFromOpsDbRow(dbRow);
    if (!pkg) continue;

    const productMatchingMode = resolveMatchingModeForChannel(
      runtimeConfig.productMatchingMode,
      buyboxChannelId,
      runtimeConfig.productMatchingModeByChannel
    );
    const orderDateTimezone = orderDateTimezoneForChannel(buyboxChannelId);
    const analyzed = analyzeOrderPackages([pkg], db, {
      ...profitAnalysisSettingsForChannel(buyboxChannelId),
      costScope: costScopeForChannel(buyboxChannelId),
      orderDateTimezone,
      channelId: buyboxChannelId,
      productMatchingMode
    }).map((row) => ({
      ...row,
      ingestSource: row.ingestSource || ORDER_SOURCES.WEBHOOK,
      profitConfidence: computeProfitConfidence(row),
      channel: buyboxChannelId,
      channelLabel: channel?.label || buyboxChannelId
    }));

    enrichRowsWithBenimposTransferStatus(analyzed, db, buyboxChannelId);
    rows.push(...analyzed);
  }

  return rows;
}
