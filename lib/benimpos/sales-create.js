/**
 * BenimPOS stok düşümü — satış oluşturma (GELECEK AŞAMA)
 *
 * Doküman: BenimPOS API v1.0.7 — POST /sales, processType: "create"
 *
 * E-ticaret / pazaryeri siparişlerini BenimPOS'a gönderince stok otomatik düşer.
 * Bu modül şu an panelden otomatik çağrılmaz; yalnızca payload hazırlama ve
 * ileride kullanılacak createSale fonksiyonunu içerir.
 *
 * Ödeme tipleri: CASH (Nakit), CREDITCARD (Pos), OPENACCOUNT (Açık Hesap)
 * veya GET /paymentTypes listesindeki paymentTypeID.
 *
 * İptal: POST /sales — processType muhtemelen "cancel" (PDF'de create yazıyor, typo olabilir)
 *        data: { salesCode: "..." }
 */

import { resolveChannelLine } from '../product-matching/resolve.js';
import { resolveChannelLineForSale } from '../product-matching/sale-preview.js';
import {
  BENIMPOS_SALE_CONFIRM_LEVELS,
  mappingMeetsSaleConfirmLevel
} from '../product-matching/sales-readiness.js';
import { normalizeOrderTimestamp } from '../order-profitability.js';
import { applyGetirBenimposFinancials, applyUberBenimposFinancials } from './channel-sale-financials.js';
import { resolveTeraziSaleBarcode, resolveTeraziSaleQuantity, resolveTeraziSaleUnitPrice } from './terazi-barcode.js';

/** BenimPOS satış tarihi — Türkiye yerel saati (sunucu UTC olsa bile). */
export const BENIMPOS_SALE_TIMEZONE = 'Europe/Istanbul';

/** BenimPOS ödeme tipi ID'leri (GET /paymentTypes) */
export const BENIMPOS_PAYMENT = {
  TRENDGO: '27749256',
  YEMEKSEPETI: '87452757',
  GETIR: '31481957',
  INTERNET: '20867352'
};

/** Panel sipariş satırından BenimPOS satış kalemi */
export function mapOrderLineToSaleProduct(line) {
  return {
    barcode: String(line.saleBarcode || line.barcode || '').trim(),
    name: String(line.title || line.name || line.productName || '').trim(),
    price: Number(line.unitPrice ?? line.price ?? line.lineUnitPrice) || 0,
    quantity: Number(line.quantity) || 1,
    taxRate: Number(line.taxRate ?? line.vatRate) || 20,
    buyingPrice: line.buyingPrice != null ? Number(line.buyingPrice) : undefined
  };
}

export function orderTimestampToBenimposParts(
  timestamp,
  timeZone = BENIMPOS_SALE_TIMEZONE
) {
  const ms = normalizeOrderTimestamp(timestamp);
  if (!ms) return null;

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    hour12: false
  }).formatToParts(new Date(ms));

  const get = (type) => parts.find((part) => part.type === type)?.value || '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}:${get('second')}`
  };
}

function currentBenimposParts(timeZone = BENIMPOS_SALE_TIMEZONE) {
  return orderTimestampToBenimposParts(Date.now(), timeZone);
}

function resolveBenimposSaleDateTime(order = {}) {
  return orderTimestampToBenimposParts(
    order.orderDate ?? order.orderDateMs ?? order.ordered_at ?? order.orderedAt
  ) || currentBenimposParts();
}

/**
 * Tek sipariş için BenimPOS create payload'ı.
 * @param {object} order
 * @param {string} order.paymentType - CASH | CREDITCARD | OPENACCOUNT | paymentTypeID
 * @param {string} [order.date] - Y-m-d
 * @param {string} [order.time] - hh:mm:ss
 * @param {string} [order.note] - Satış notu (ör. Trendyol sipariş no)
 * @param {string} [order.customerCode]
 * @param {number} [order.discountRate]
 * @param {Array} order.lines - Sipariş kalemleri
 */
export function buildSalesCreatePayload(order) {
  const saleWhen = resolveBenimposSaleDateTime(order);
  const date = order.date || saleWhen.date;
  const time = order.time || saleWhen.time;

  const products = (order.lines || [])
    .map(mapOrderLineToSaleProduct)
    .filter((p) => p.barcode && p.quantity > 0);

  if (!products.length) {
    throw new Error('Satış için en az bir geçerli ürün satırı gerekli.');
  }

  const paymentType = String(order.paymentType || 'OPENACCOUNT').trim();
  if (!paymentType) {
    throw new Error('paymentType zorunlu (CASH, CREDITCARD, OPENACCOUNT veya özel ID).');
  }

  const sale = {
    paymentType,
    date,
    time,
    note: String(order.note || '').slice(0, 500),
    products
  };

  if (order.customerCode) {
    sale.customerCode = String(order.customerCode);
  }
  if (order.discountRate != null && Number(order.discountRate) > 0) {
    sale.discountRate = Number(order.discountRate);
  }

  return {
    processType: 'create',
    data: sale
  };
}

/**
 * Stok düşümü için satış oluşturur. Yalnızca açıkça etkinleştirildiğinde kullanın.
 * @param {ReturnType<import('./client.js').createBenimposClient>} client
 */
export async function createSale(client, order, { dryRun = false } = {}) {
  const payload = buildSalesCreatePayload(order);

  if (dryRun) {
    return { ok: true, dryRun: true, payload };
  }

  const result = await client.request('sales', payload);
  return {
    ok: true,
    salesCode: result.salesCode,
    message: result.message,
    raw: result
  };
}

/** Uber Eats / Trendyol Go siparişi → TRENDGO satış payload'ı */
export function buildTrendgoSaleFromOrder(order) {
  const built = buildChannelSaleFromOrder(order, null, {
    channelId: 'uber-eats',
    mode: 'legacy',
    paymentType: BENIMPOS_PAYMENT.TRENDGO,
    notePrefix: 'TRENDGO'
  });
  return built.payload;
}

/**
 * Kanal siparişinden BenimPOS satış payload'ı — eşleştirme moduna göre barkod çözümü.
 * @param {object|null} db - productMatching için; null ise legacy barkod
 */
export function buildChannelSaleFromOrder(order, db, options = {}) {
  const channelId = String(options.channelId || 'uber-eats').trim();
  const mode = String(options.mode || 'legacy').trim();
  const salePolicy = String(options.salePolicy || 'sale-strict').trim();
  const confirmLevel = options.confirmLevel || BENIMPOS_SALE_CONFIRM_LEVELS.AUTO_OR_MANUAL;
  const paymentType = options.paymentType || paymentTypeForChannel(channelId);
  const saleLines = [];
  const skippedLines = [];
  const previewLines = [];

  for (const rawLine of order.lines || order.items || []) {
    let resolved;
    if (!db || salePolicy === 'legacy') {
      resolved = db && salePolicy !== 'legacy'
        ? resolveChannelLine(db, { channelId, channelBarcode: rawLine.barcode, mode })
        : {
          saleBarcode: String(rawLine.barcode || '').trim(),
          includeInSale: Boolean(rawLine.barcode),
          master: null,
          mappingStatus: 'legacy',
          source: 'legacy'
        };
    } else {
      resolved = resolveChannelLineForSale(db, {
        channelId,
        rawLine
      });
    }

    previewLines.push(resolved);

    if (!resolved.includeInSale) {
      skippedLines.push({
        channelBarcode: rawLine.barcode,
        reason: resolved.blockReason || resolved.skipReason || 'eslestirme_yok',
        mappingStatus: resolved.mappingStatus,
        warning: resolved.warning
      });
      continue;
    }

    if (!mappingMeetsSaleConfirmLevel(resolved.mappingStatus, confirmLevel)) {
      skippedLines.push({
        channelBarcode: rawLine.barcode,
        reason: 'manuel_onay_gerekli',
        mappingStatus: resolved.mappingStatus,
        warning: 'Otomatik eşleşti — gerçek satış için manuel onay gerekli',
        masterProductId: resolved.master?.id || null
      });
      continue;
    }

    const baseBarcode = resolved.master?.benimposBarcode || resolved.saleBarcode;
    const orderLineName = String(
      rawLine.productName || rawLine.name || rawLine.title || ''
    ).trim();
    const orderGrams = rawLine.orderGrams ?? rawLine.totalWeightGrams ?? rawLine.teraziOrderGrams ?? null;
    const terazi = resolveTeraziSaleBarcode({
      baseBarcode,
      master: resolved.master,
      orderLineName,
      orderGrams
    });
    const orderQty = Number(rawLine.quantity) || 1;
    const saleUnitPrice = Number(
      rawLine.listUnitPrice
      ?? rawLine.lineUnitPrice
      ?? rawLine.unitSalesPrice
      ?? rawLine.price
      ?? rawLine.unitPrice
    ) || 0;

    saleLines.push({
      saleBarcode: terazi.saleBarcode,
      barcode: terazi.saleBarcode,
      title: resolved.master?.name || orderLineName,
      unitPrice: resolveTeraziSaleUnitPrice(saleUnitPrice, terazi),
      quantity: resolveTeraziSaleQuantity(terazi, orderQty),
      taxRate: rawLine.taxRate ?? rawLine.vatRate ?? 20,
      buyingPrice: resolved.master?.buyingPrice,
      mappingSource: resolved.source,
      mappingStatus: resolved.mappingStatus,
      channelBarcode: resolved.channelBarcode,
      teraziApplied: terazi.teraziApplied,
      teraziOrderGrams: terazi.orderGrams,
      teraziUnitGrams: terazi.unitGrams,
      teraziCostRatio: terazi.costRatio,
      teraziSuffixBarcode: terazi.suffixBarcode || null
    });
  }

  if (!saleLines.length) {
    const blockReason = 'Satış için güvenli eşleşen ürün satırı yok.';
    if (options.allowEmpty) {
      return {
        payload: null,
        saleLines: [],
        skippedLines,
        previewLines,
        mode,
        channelId,
        salePolicy,
        financials: null,
        saleBlocked: true,
        blockReason
      };
    }
    const error = new Error(blockReason);
    error.skippedLines = skippedLines;
    error.previewLines = previewLines;
    error.mode = mode;
    error.salePolicy = salePolicy;
    throw error;
  }

  const saleWhen = resolveBenimposSaleDateTime(order);
  const payload = buildSalesCreatePayload({
    paymentType,
    note: buildChannelSaleNote(channelId, order),
    date: saleWhen.date,
    time: saleWhen.time,
    ...(order.customerCode ? { customerCode: order.customerCode } : {}),
    lines: saleLines
  });

  let financials = null;
  if (channelId === 'uber-eats') {
    const adjusted = applyUberBenimposFinancials(payload, order);
    financials = adjusted.financials;
  } else if (channelId === 'getir') {
    const adjusted = applyGetirBenimposFinancials(payload, order);
    financials = adjusted.financials;
  }

  return {
    payload,
    saleLines,
    skippedLines,
    previewLines,
    mode,
    channelId,
    salePolicy,
    financials
  };
}

/** buildChannelSaleFromOrder çıktısından BenimPOS createSale argümanı */
export function saleOrderFromBuilt(built) {
  const data = built.payload?.data || {};
  const saleOrder = {
    paymentType: data.paymentType,
    note: data.note,
    discountRate: data.discountRate,
    date: data.date,
    time: data.time,
    lines: built.saleLines
  };
  if (data.customerCode) {
    saleOrder.customerCode = data.customerCode;
  }
  return saleOrder;
}

function paymentTypeForChannel(channelId) {
  if (channelId === 'uber-eats') return BENIMPOS_PAYMENT.TRENDGO;
  if (channelId === 'yemeksepeti') return BENIMPOS_PAYMENT.YEMEKSEPETI;
  if (channelId === 'getir') return BENIMPOS_PAYMENT.GETIR;
  if (channelId === 'trendyol-marketplace') return BENIMPOS_PAYMENT.INTERNET;
  return BENIMPOS_PAYMENT.INTERNET;
}

function channelNotePrefix(channelId) {
  if (channelId === 'uber-eats') return 'Uber Eats';
  if (channelId === 'yemeksepeti') return 'Yemeksepeti';
  if (channelId === 'getir') return 'Getir';
  if (channelId === 'trendyol-marketplace') return 'Trendyol';
  return String(channelId || 'KANAL');
}

function buildChannelSaleNote(channelId, order) {
  const prefix = channelNotePrefix(channelId);
  const orderRef = String(order.orderNumber || order.id || '').trim();
  return orderRef ? `${prefix} #${orderRef}` : prefix;
}

/** Trendyol pazaryeri siparişi için örnek not + ödeme tipi */
export function buildMarketplaceSaleFromOrder(order, channelLabel = 'Trendyol') {
  return buildSalesCreatePayload({
    paymentType: 'OPENACCOUNT',
    note: `${channelLabel} #${order.orderNumber || order.id || ''}`.trim(),
    lines: order.lines || order.items || []
  });
}
