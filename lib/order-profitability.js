import { costsForScope, COST_SCOPE } from './cost-scopes.js';
import { buildMasterCostIndex, mergeCostIndexes } from './product-matching/master-cost-sync.js';
import { computeProfitConfidence } from './production/profit-confidence.js';
import {
  createOrderLineResolver,
  normalizeMatchingMode,
  resolveLineCostDetails
} from './product-matching/resolve.js';
import { nameSimilarityScore, normalizeBarcode } from './product-matching/normalize.js';
import { resolveChannelDisplayName } from './product-matching/channel-ingest/uber-eats.js';
import { productPoolUrlForMappingStatus } from './product-matching/pool-url.js';
import { consolidateOrderLines, normalizeOrderLinePricingFields } from './channels/consolidate-order-lines.js';
import { resolveTeraziSaleBarcode } from './benimpos/terazi-barcode.js';

export const ORDER_LOOKBACK_DAYS = 14;
export const ORDER_PAGE_SIZE = 200;
/** Trendyol orderDate: epoch ms where UTC components equal Turkey (GMT+3) wall clock. */
export const TRENDYOL_ORDER_DATE_TIMEZONE = 'UTC';
/** Uber Eats / Go finance API and other channels use real UTC epoch ms — display in Turkey time. */
export const LOCAL_ORDER_TIMEZONE = 'Europe/Istanbul';
export const ORDER_TIMEZONE = TRENDYOL_ORDER_DATE_TIMEZONE;
const DEFAULT_VAT_RATE = 20;

export function orderDateTimezoneForChannel(channelId) {
  return LOCAL_ORDER_TIMEZONE;
}

function usesRealUtcOrderTimestamps(channelId) {
  return orderDateTimezoneForChannel(channelId) === LOCAL_ORDER_TIMEZONE;
}

function firstNumber(values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n !== 0) return n;
  }
  return 0;
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function roundMoney(value) {
  return Math.round(toNumber(value) * 100) / 100;
}

/** KDV Tutarı = KDV Dahil Tutar × KDV Oranı / (100 + KDV Oranı) */
export function extractVat(grossAmount, vatRatePercent = DEFAULT_VAT_RATE) {
  const gross = toNumber(grossAmount);
  const rate = toNumber(vatRatePercent);
  if (!gross || !rate) return 0;
  return gross * rate / (100 + rate);
}

function vatRateOrDefault(value, fallback = DEFAULT_VAT_RATE) {
  const rate = toNumber(value);
  return rate > 0 ? rate : fallback;
}

export function buildCostByBarcode(db, scope = COST_SCOPE.TRENDYOL_MARKETPLACE) {
  const channelIndex = {};

  for (const cost of costsForScope(db, scope)) {
    const barcode = String(cost.barcode || '');
    if (!barcode) continue;
    channelIndex[barcode] = {
      unitCost: toNumber(cost.productCost),
      desi: Math.ceil(toNumber(cost.desi)) || 0,
      extraCost: toNumber(cost.extraExpense),
      packagingCost: 0,
      commissionRate: toNumber(cost.commissionRate),
      costVatRate: vatRateOrDefault(cost.costVatRate),
      costSource: 'channel_cost'
    };
  }

  return mergeCostIndexes(channelIndex, buildMasterCostIndex(db));
}

function isGenericLineProductName(name) {
  const normalized = String(name || '').trim().toLowerCase();
  return !normalized || normalized === 'satış' || normalized === 'satis' || normalized === 'sale';
}

/** Sipariş satırı adı settlement/webhook'tan gelmedi mi (ör. Trendyol "Satış"). */
export function isGenericOrderLineProductName(name) {
  return isGenericLineProductName(name);
}

function titleLookupKeys(...values) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function resolveLineProductName(rawLineName, resolved, productTitlesByBarcode, channelBarcode, costBarcode) {
  if (!isGenericLineProductName(rawLineName)) {
    return String(rawLineName).trim();
  }
  const keys = titleLookupKeys(
    channelBarcode,
    costBarcode,
    resolved?.saleBarcode,
    resolved?.master?.benimposBarcode,
    resolved?.channelBarcode,
    resolved?.costBarcode
  );
  for (const key of keys) {
    const title = productTitlesByBarcode[key];
    if (title && !isGenericLineProductName(title)) return title;
  }
  const fallback = String(resolved?.channelProductName || '').trim();
  if (fallback && !isGenericLineProductName(fallback)) return fallback;
  return rawLineName && !isGenericLineProductName(rawLineName) ? String(rawLineName).trim() : '—';
}

/** Sipariş ekranı — yalnızca ilgili kanalın katalog/sipariş kaynağından ürün adı. */
export function buildChannelProductTitleByBarcode(db, channelId) {
  const titles = {};
  const scopedChannelId = String(channelId || '').trim();
  if (!scopedChannelId) return titles;

  for (const cp of db.productMatching?.channelProducts || []) {
    if (String(cp.channelId || '').trim() !== scopedChannelId) continue;
    const name = String(cp.channelName || cp.catalogTitle || '').trim();
    if (!name || isGenericLineProductName(name)) continue;
    for (const key of titleLookupKeys(cp.channelBarcode, cp.channelProductId)) {
      titles[key] = name;
    }
  }

  return titles;
}

/** Sipariş ekranı — yalnızca ilgili kanalın katalog görselleri. */
export function buildChannelProductImageByBarcode(db, channelId) {
  const images = {};
  const scopedChannelId = String(channelId || '').trim();
  if (!scopedChannelId) return images;

  for (const cp of db.productMatching?.channelProducts || []) {
    if (String(cp.channelId || '').trim() !== scopedChannelId) continue;
    for (const key of titleLookupKeys(cp.channelBarcode, cp.channelProductId)) {
      const imageUrl = String(cp.channelImageUrl || cp.catalogImageUrl || '').trim();
      if (imageUrl && !images[key]) images[key] = imageUrl;
    }
  }

  return images;
}

export function buildProductTitleByBarcode(db, scope = COST_SCOPE.TRENDYOL_MARKETPLACE) {
  const titles = {};

  for (const product of db.products || []) {
    const barcode = String(product.barcode || '').trim();
    if (barcode && product.title) titles[barcode] = String(product.title).trim();
  }

  for (const cost of costsForScope(db, scope)) {
    const barcode = String(cost.barcode || '').trim();
    if (barcode && cost.title && !titles[barcode]) {
      titles[barcode] = String(cost.title).trim();
    }
  }

  for (const cp of db.productMatching?.channelProducts || []) {
    const name = String(cp.channelName || '').trim();
    if (!name || isGenericLineProductName(name)) continue;
    for (const key of titleLookupKeys(cp.channelBarcode, cp.channelProductId)) {
      titles[key] = name;
    }
  }

  for (const master of db.productMatching?.masterProducts || []) {
    const barcode = String(master.benimposBarcode || '').trim();
    if (barcode && master.name && !titles[barcode]) {
      titles[barcode] = String(master.name).trim();
    }
  }

  const masterById = new Map();
  const masterByBarcode = new Map();
  for (const master of db.productMatching?.masterProducts || []) {
    if (master.id) masterById.set(master.id, master);
    const barcode = normalizeBarcode(master.benimposBarcode);
    if (barcode) masterByBarcode.set(barcode, master);
  }

  const channelProductById = new Map();
  for (const cp of db.productMatching?.channelProducts || []) {
    if (cp.id) channelProductById.set(cp.id, cp);
  }

  const mappingMasterByChannelKey = new Map();
  for (const mapping of db.productMatching?.mappings || []) {
    const master = masterById.get(mapping.masterProductId);
    const cp = channelProductById.get(mapping.channelProductId);
    if (!master || !cp) continue;
    for (const key of titleLookupKeys(cp.channelBarcode, cp.channelProductId)) {
      if (!mappingMasterByChannelKey.has(key)) mappingMasterByChannelKey.set(key, master);
    }
  }

  for (const cp of db.productMatching?.channelProducts || []) {
    for (const key of titleLookupKeys(cp.channelBarcode, cp.channelProductId)) {
      if (titles[key] && !isGenericLineProductName(titles[key])) continue;
      const master = mappingMasterByChannelKey.get(key)
        || masterByBarcode.get(normalizeBarcode(key))
        || (cp.suggestedMasterProductId ? masterById.get(cp.suggestedMasterProductId) : null);
      const displayName = String(resolveChannelDisplayName(cp, master) || '').trim();
      if (displayName && !isGenericLineProductName(displayName)) {
        titles[key] = displayName;
      }
    }
  }

  return titles;
}

export function buildProductImageByBarcode(db) {
  const images = {};

  for (const product of db.products || []) {
    const barcode = String(product.barcode || '').trim();
    const imageUrl = String(product.imageUrl || '').trim();
    if (barcode && imageUrl) images[barcode] = imageUrl;
  }

  for (const cp of db.productMatching?.channelProducts || []) {
    const barcode = String(cp.channelBarcode || cp.channelProductId || '').trim();
    const imageUrl = String(cp.channelImageUrl || cp.catalogImageUrl || '').trim();
    if (barcode && imageUrl && !images[barcode]) images[barcode] = imageUrl;
  }

  return images;
}

const COST_SOURCE_LABELS = {
  legacy_scope: 'Ürün Ayarları (barkod)',
  mapping_scope: 'Eşleştirme → Ürün Ayarları',
  mapping_master: 'Eşleştirme → BenimPOS alış fiyatı',
  master_buying_price: 'Ana havuz alış fiyatı (BenimPOS sync)',
  order_snapshot: 'Sipariş anı alış fiyatı (ana havuz)',
  backfill_snapshot: 'Geçmiş sipariş — güncel havuz alış fiyatı (tahmini)',
  mapping_no_cost: 'Eşleştirme var · maliyet yok',
  mapping_name_mismatch: 'Eşleştirme isim uyuşmaz — maliyet uygulanmadı',
  legacy_fallback: 'Eşleşme yok · barkod fallback',
  legacy_master: 'BenimPOS alış fiyatı (barkod)',
  unmapped: 'Onaylı eşleşme yok'
};

export function costSourceLabel(source) {
  return COST_SOURCE_LABELS[source] || source || '—';
}

function buildLineCostWarnings({
  productName,
  costProductName,
  mappingStatus,
  unitCost,
  totalProductCost,
  lineSalesAmount,
  channelBarcode,
  costBarcode
}) {
  const warnings = [];

  if (productName && costProductName) {
    const threshold = channelBarcode && costBarcode && channelBarcode !== costBarcode ? 35 : 25;
    if (nameSimilarityScore(productName, costProductName) < threshold) {
      warnings.push('Maliyet kaydı farklı ürüne ait görünüyor');
    }
  }

  if (!unitCost && lineSalesAmount) {
    warnings.push('Maliyet tanımlı değil');
  }

  if (totalProductCost > 0 && lineSalesAmount > 0 && totalProductCost > lineSalesAmount * 1.5) {
    warnings.push('Satır maliyeti satış tutarından belirgin yüksek');
  }

  if (mappingStatus === 'barcode_conflict') {
    warnings.push('Aynı barkoda birden fazla ana ürün');
  } else if (mappingStatus === 'review_required') {
    warnings.push('Eşleştirme kontrol gerektiriyor');
  } else if (mappingStatus === 'pending') {
    warnings.push('Eşleştirme henüz onaylanmadı');
  } else if (mappingStatus === 'missing_master') {
    warnings.push('BenimPOS ana ürünü bulunamadı');
  } else if (mappingStatus === 'unmapped') {
    warnings.push('Onaylı eşleştirme yok');
  } else if (mappingStatus === 'review_required') {
    warnings.push('Eşleştirme isim uyuşmazlığı — kontrol gerekli');
  }

  return warnings;
}

export function orderMatchesMatchingFilter(row, filter) {
  const value = String(filter || 'all').trim();
  if (!value || value === 'all') return true;

  const lines = row.lines || [];
  if (!lines.length) return false;

  if (value === 'unmapped') {
    return lines.some((line) =>
      line.mappingSource === 'unmapped'
      || line.mappingStatus === 'unmapped'
      || line.mappingStatus === 'missing_master'
    );
  }

  if (value === 'needs_review') {
    return lines.some((line) =>
      ['pending', 'review_required', 'barcode_conflict', 'missing_master', 'unmapped'].includes(line.mappingStatus)
      || line.mappingSource === 'unmapped'
      || line.mappingSource === 'legacy_fallback'
    );
  }

  return true;
}

export function collectOrderMatchingWarnings(lines = []) {
  const warnings = new Set();

  for (const line of lines || []) {
    for (const note of line.costWarnings || []) {
      warnings.add(note);
    }
    if (line.mappingStatus === 'barcode_conflict') {
      warnings.add('Siparişte barkod çakışmalı eşleştirme var');
    }
  }

  return [...warnings];
}

export function normalizeOrderTimestamp(value) {
  if (value === '' || value === null || value === undefined) return 0;

  let n = Number(value);
  if (Number.isFinite(n) && n > 0) {
    if (n < 1e12) n *= 1000;
    return n;
  }

  const parsed = Date.parse(String(value));
  if (Number.isFinite(parsed) && parsed > 0) return parsed;

  return 0;
}

export function formatOrderDate(timestamp, timeZone = ORDER_TIMEZONE) {
  const ms = normalizeOrderTimestamp(timestamp);
  if (!ms) return '';

  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return '';

  const parts = new Intl.DateTimeFormat('tr-TR', {
    timeZone,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);

  const get = (type) => parts.find((part) => part.type === type)?.value || '';
  const month = get('month').replace(/\.$/, '');

  return `${get('day')} ${month} ${get('year')} - ${get('hour')}:${get('minute')}`;
}

export function orderDayKey(timestamp, timeZone = ORDER_TIMEZONE) {
  const ms = normalizeOrderTimestamp(timestamp);
  if (!ms) return '';

  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(ms));
}

export function orderWeekKey(timestamp, timeZone = ORDER_TIMEZONE) {
  const ms = normalizeOrderTimestamp(timestamp);
  if (!ms) return '';

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(ms));

  const get = (type) => Number(parts.find((part) => part.type === type)?.value || 0);
  const date = new Date(Date.UTC(get('year'), get('month') - 1, get('day')));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);

  return date.toISOString().slice(0, 10);
}

export function shippingFeeForDesi(desi, cargoByDesi) {
  const d = Math.min(Math.max(Math.ceil(toNumber(desi)) || 1, 1), 25);
  return cargoByDesi[d] || cargoByDesi[25] || 0;
}

function getLineUnitSalesPrice(line) {
  const discountDetails = line.discountDetails || [];
  if (discountDetails.length) {
    const sum = discountDetails.reduce((acc, detail) => acc + toNumber(detail.lineItemPrice), 0);
    return sum / discountDetails.length;
  }

  const normalized = normalizeOrderLinePricingFields(line);
  return normalized.lineUnitPrice;
}

function getLineCommissionAmount(line, lineSalesAmount, commissionRate, quantity) {
  const direct = firstNumber([line.commissionAmount, line.lineCommissionAmount]);
  const rate = commissionRate || toNumber(line.commission);
  const rateBased = lineSalesAmount > 0 && rate > 0
    ? lineSalesAmount * rate / 100
    : 0;

  if (direct) {
    if (rateBased > 0 && direct > rateBased * 1.2) {
      return roundMoney(rateBased);
    }
    return direct;
  }

  const unitCommission = firstNumber([line.unitCommissionAmount]);
  if (unitCommission) return unitCommission * (quantity || 1);

  return rateBased;
}

function buildOrderLine(orderPackage, line, costByBarcode, orderDateTimezone = ORDER_TIMEZONE, lineContext = {}) {
  const channelBarcode = String(line.barcode || '');
  const resolved = lineContext.resolved || {
    channelBarcode,
    costBarcode: channelBarcode,
    saleBarcode: channelBarcode,
    source: 'legacy',
    mappingStatus: 'legacy',
    includeInSale: Boolean(channelBarcode)
  };
  const productTitlesByBarcode = lineContext.productTitlesByBarcode || {};
  const productImagesByBarcode = lineContext.productImagesByBarcode || {};
  const costDetails = lineContext.resolveCostDetails
    ? lineContext.resolveCostDetails(costByBarcode, resolved)
    : resolveLineCostDetails(costByBarcode, resolved, lineContext.resolveCostOptions || {});
  let cost = costDetails.cost;
  let costSource = costDetails.costSource || 'legacy_scope';
  let usedMasterOverlay = Boolean(costDetails.usedMasterOverlay);
  const costBarcode = costDetails.costBarcode || resolved.costBarcode || channelBarcode;

  const frozenUnitCost = toNumber(line.frozenUnitCost ?? line.unitCost ?? line.unit_cost);
  if (frozenUnitCost > 0) {
    cost = {
      ...cost,
      unitCost: frozenUnitCost
    };
    costSource = line.costSource || line.cost_source || 'order_snapshot';
    usedMasterOverlay = false;
  }
  const rawLineName = String(line.productName || line.name || line.title || '').trim();
  const baseSaleBarcode = resolved.master?.benimposBarcode || resolved.saleBarcode || channelBarcode;
  const orderGrams = line.orderGrams ?? line.totalWeightGrams ?? line.teraziOrderGrams ?? null;
  const terazi = resolved.master
    ? resolveTeraziSaleBarcode({
      baseBarcode: baseSaleBarcode,
      master: resolved.master,
      orderLineName: rawLineName,
      orderGrams
    })
    : { saleBarcode: baseSaleBarcode, teraziApplied: false, costRatio: 1, orderGrams: null, unitGrams: null };
  const quantity = toNumber(line.quantity) || 1;
  const costQuantity = terazi.orderGramsIsTotal
    ? (terazi.costRatio || 1)
    : quantity * (terazi.costRatio || 1);
  const unitSalesPrice = getLineUnitSalesPrice(line);
  const normalizedPricing = normalizeOrderLinePricingFields(line);
  const displayLineAmount = roundMoney(
    normalizedPricing.lineGrossAmount || unitSalesPrice * quantity
  );
  const revenueLineAmount = roundMoney(
    normalizedPricing.paidLineGross || displayLineAmount
  );
  const commissionRate = line.commission != null && String(line.commission).trim() !== ''
    ? toNumber(line.commission)
    : cost.commissionRate;
  const commissionAmount = getLineCommissionAmount(line, revenueLineAmount, commissionRate, quantity);
  const unitCost = toNumber(cost.unitCost);
  const extraCost = toNumber(cost.extraCost) * costQuantity;
  const packagingCost = toNumber(cost.packagingCost) * costQuantity;
  const totalProductCost = unitCost * costQuantity;
  const purchaseBase = totalProductCost + extraCost + packagingCost;
  const salesVatRate = vatRateOrDefault(line.vatRate);
  const purchaseVatRate = vatRateOrDefault(cost.costVatRate);
  const productName = resolveLineProductName(
    rawLineName,
    resolved,
    productTitlesByBarcode,
    channelBarcode,
    costBarcode
  );
  const costProductName = productTitlesByBarcode[costBarcode]
    || resolved.master?.name
    || productTitlesByBarcode[channelBarcode]
    || '';
  const imageUrl = productImagesByBarcode[costBarcode]
    || productImagesByBarcode[channelBarcode]
    || productImagesByBarcode[resolved.saleBarcode || '']
    || '';
  const costWarnings = buildLineCostWarnings({
    productName,
    costProductName,
    mappingStatus: resolved.mappingStatus || 'legacy',
    unitCost,
    totalProductCost,
    lineSalesAmount: displayLineAmount,
    channelBarcode,
    costBarcode
  });

  return {
    summaryKey: getOrderSummaryKey(orderPackage),
    line: {
      barcode: channelBarcode,
      costBarcode,
      saleBarcode: terazi.saleBarcode || baseSaleBarcode,
      teraziApplied: terazi.teraziApplied,
      teraziOrderGrams: terazi.orderGrams,
      teraziUnitGrams: terazi.unitGrams,
      teraziCostRatio: terazi.costRatio,
      masterBarcode: resolved.master?.benimposBarcode || '',
      mappingSource: resolved.source || 'legacy',
      mappingStatus: resolved.mappingStatus || 'legacy',
      costSource: costSource || costDetails.costSource || 'legacy_scope',
      costSourceLabel: costSourceLabel(costSource || costDetails.costSource),
      costProductName,
      costUsedMasterOverlay: usedMasterOverlay,
      costWarnings,
      poolMatchUrl: lineContext.channelId && resolved.mappingStatus && resolved.mappingStatus !== 'legacy'
        ? productPoolUrlForMappingStatus(lineContext.channelId, channelBarcode, resolved.mappingStatus)
        : null,
      productName,
      imageUrl: imageUrl || null,
      stockCode: line.stockCode || '',
      quantity,
      unitSalesPrice: roundMoney(unitSalesPrice),
      lineSalesAmount: displayLineAmount,
      paidLineSalesAmount: revenueLineAmount,
      commissionRate,
      commissionAmount: roundMoney(commissionAmount),
      unitCost,
      totalProductCost: roundMoney(totalProductCost),
      extraCost: roundMoney(extraCost),
      packagingCost: roundMoney(packagingCost),
      desi: cost.desi || 0,
      lineNetBeforeFees: roundMoney(revenueLineAmount - totalProductCost - extraCost - packagingCost - commissionAmount)
    },
    summaryData: {
      orderNumber: orderPackage.orderNumber || '',
      orderDate: formatOrderDate(orderPackage.orderDate, orderDateTimezone),
      orderDateMs: normalizeOrderTimestamp(orderPackage.orderDate),
      shipmentPackageId: orderPackage.shipmentPackageId || orderPackage.id || '',
      status: orderPackage.status || orderPackage.shipmentPackageStatus || '',
      salesAmount: revenueLineAmount,
      productCost: totalProductCost,
      extraCost,
      packagingCost,
      commissionAmount,
      salesVat: extractVat(revenueLineAmount, salesVatRate),
      purchaseVat: extractVat(purchaseBase, purchaseVatRate)
    }
  };
}

function getOrderSummaryKey(orderPackage) {
  return `${orderPackage.orderNumber || ''}|${orderPackage.shipmentPackageId || orderPackage.id || ''}`;
}

function sumPackageLineGrossAmount(lines) {
  if (!lines?.length) return 0;

  let sum = 0;
  for (const line of lines) {
    if (line.lineGrossAmount != null && line.lineGrossAmount !== '') {
      sum += toNumber(line.lineGrossAmount);
      continue;
    }

    const qty = toNumber(line.quantity) || 1;
    const unitGross = firstNumber([line.lineUnitPrice, line.unitPrice, line.price]);
    if (unitGross) sum += unitGross * qty;
  }

  return roundMoney(sum);
}

function getPackageSalesAmount(orderPackage) {
  const lineGrossSum = sumPackageLineGrossAmount(orderPackage.lines);
  const packageField = firstNumber([
    orderPackage.packageGrossAmount,
    orderPackage.totalPrice,
    orderPackage.totalAmount
  ]);
  const discount = toNumber(orderPackage.packageTotalDiscount);

  if (lineGrossSum > 0) {
    if (!packageField) return lineGrossSum;

    const looksNetAfterDiscount = discount > 0
      && Math.abs(packageField - (lineGrossSum - discount)) < 0.05;
    const linesAreGrossPackage = lineGrossSum > packageField + 0.01
      && (!discount || Math.abs(lineGrossSum - packageField - discount) < 0.05);

    if (looksNetAfterDiscount || linesAreGrossPackage) {
      return lineGrossSum;
    }

    return roundMoney(Math.max(packageField, lineGrossSum));
  }

  if (!packageField) return 0;
  // Trendyol Go panelindeki "Satış Tutarı" brüt satır toplamına yakın; indirim satırda düşülür.
  return roundMoney(packageField);
}

function getPackageNetSalesAmount(orderPackage) {
  const grossAmount = getPackageSalesAmount(orderPackage);
  const totalDiscount = toNumber(orderPackage.packageTotalDiscount);
  return grossAmount ? roundMoney(Math.max(0, grossAmount - totalDiscount)) : 0;
}

function getPackageCargoCost(orderPackage, fallback) {
  return firstNumber([
    orderPackage.cargoPrice,
    orderPackage.cargoAmount,
    orderPackage.cargoCost
  ]) || fallback;
}

/** Satıcı kargo anlaşması (whoPays=1) — Trendyol kargo bedeli API'de güvenilir değildir. */
export function usesSellerCargoAgreement(orderPackage) {
  return toNumber(orderPackage.whoPays) === 1;
}

function shouldIgnoreTrendyolCargo(orderPackage, settings) {
  if (settings.ignoreTrendyolCargoCost) return true;
  return usesSellerCargoAgreement(orderPackage);
}

function resolvePackageShipping(orderPackage, settings) {
  const orderKey = getOrderSummaryKey(orderPackage);
  const dhlEntry = settings.shippingCostByOrderKey?.[orderKey];

  if (dhlEntry && toNumber(dhlEntry.total) > 0) {
    return {
      shippingCost: roundMoney(dhlEntry.total),
      outboundShippingCost: roundMoney(dhlEntry.outbound),
      returnShippingCost: roundMoney(dhlEntry.returnTotal),
      shippingCostSource: 'dhl',
      shippingCostEstimated: dhlEntry.source !== 'invoiced'
    };
  }

  const maxDesi = maxDesiForLines(orderPackage.lines, settings.costByBarcode);
  const shippingFromDesi = maxDesi ? shippingFeeForDesi(maxDesi, settings.cargoByDesi) : 0;
  const ignoreTrendyol = shouldIgnoreTrendyolCargo(orderPackage, settings);
  const desiOrDefault = shippingFromDesi || settings.defaultShippingCost;
  const fallback = ignoreTrendyol
    ? desiOrDefault
    : getPackageCargoCost(orderPackage, desiOrDefault);

  return {
    shippingCost: roundMoney(fallback),
    outboundShippingCost: roundMoney(fallback),
    returnShippingCost: 0,
    shippingCostSource: ignoreTrendyol
      ? (shippingFromDesi ? 'desi' : 'default')
      : (getPackageCargoCost(orderPackage, 0) ? 'trendyol' : (shippingFromDesi ? 'desi' : 'default')),
    shippingCostEstimated: true
  };
}

function maxDesiForLines(lines, costByBarcode) {
  let maxDesi = 0;
  for (const line of lines || []) {
    const barcode = String(line.barcode || '');
    const cost = costByBarcode[barcode] || {};
    maxDesi = Math.max(maxDesi, cost.desi || 0);
  }
  return maxDesi;
}

function ensureOrderSummary(summaryByKey, key, orderPackage, settings) {
  if (summaryByKey[key]) return;

  const packageSalesAmount = getPackageSalesAmount(orderPackage);
  const shipping = resolvePackageShipping(orderPackage, settings);

  summaryByKey[key] = {
    orderNumber: orderPackage.orderNumber || '',
    orderDate: formatOrderDate(orderPackage.orderDate, settings.orderDateTimezone),
    orderDateMs: normalizeOrderTimestamp(orderPackage.orderDate),
    shipmentPackageId: orderPackage.shipmentPackageId || orderPackage.id || '',
    status: orderPackage.status || orderPackage.shipmentPackageStatus || '',
    salesAmount: packageSalesAmount,
    packageGrossAmount: packageSalesAmount,
    packageTotalDiscount: toNumber(orderPackage.packageTotalDiscount),
    salesAmountFromPackage: packageSalesAmount > 0,
    productCost: 0,
    extraCost: 0,
    packagingCost: 0,
    commissionAmount: 0,
    salesVat: 0,
    purchaseVat: 0,
    shippingCost: shipping.shippingCost,
    outboundShippingCost: shipping.outboundShippingCost,
    returnShippingCost: shipping.returnShippingCost,
    shippingCostSource: shipping.shippingCostSource,
    shippingCostEstimated: shipping.shippingCostEstimated,
    serviceFee: orderPackage.serviceFee != null
      ? toNumber(orderPackage.serviceFee)
      : settings.serviceFee,
    ingestSource: orderPackage.ingestSource || null,
    customerName: orderPackage.customerName || null,
    customerPhone: orderPackage.customerPhone || null,
    customerAddress: orderPackage.customerAddress || null,
    customerIdentityNumber: orderPackage.customerIdentityNumber || null,
    customerNote: orderPackage.customerNote || null,
    customerLocationMasked: orderPackage.customerLocationMasked ?? null,
    deliveryMethod: orderPackage.deliveryMethod || null,
    paymentMethod: orderPackage.paymentMethod || null,
    benimposSalesCode: orderPackage.benimposSalesCode || null,
    channel: orderPackage.channel || null,
    portalFinancials: orderPackage.portalFinancials || null,
    getirFinancials: orderPackage.getirFinancials || null,
    packagePortalCommissionAmount: toNumber(orderPackage.packagePortalCommissionAmount),
    packageDeliveryFee: toNumber(orderPackage.packageDeliveryFee),
    packagePartialRefund: toNumber(orderPackage.packagePartialRefund),
    packageProvisionAmount: toNumber(orderPackage.packageProvisionAmount),
    packageProvisionNet: orderPackage.packageProvisionNet,
    packageSellerRevenue: toNumber(orderPackage.packageSellerRevenue),
    packageDiscountSellerRevenue: toNumber(orderPackage.packageDiscountSellerRevenue),
    portalProvisionCredit: orderPackage.portalProvisionCredit,
    lines: []
  };
}

function ensureOrderSummaryFromLine(summaryByKey, key, data, settings) {
  if (!summaryByKey[key]) {
    summaryByKey[key] = {
      orderNumber: data.orderNumber,
      orderDate: data.orderDate,
      orderDateMs: data.orderDateMs,
      shipmentPackageId: data.shipmentPackageId,
      status: data.status,
      salesAmount: 0,
      salesAmountFromPackage: false,
      productCost: 0,
      extraCost: 0,
      packagingCost: 0,
      commissionAmount: 0,
      salesVat: 0,
      purchaseVat: 0,
      shippingCost: settings.defaultShippingCost,
      serviceFee: settings.serviceFee,
      lines: []
    };
  }
}

function addLineToOrderSummary(summaryByKey, key, data, settings) {
  ensureOrderSummaryFromLine(summaryByKey, key, data, settings);
  if (!summaryByKey[key].salesAmountFromPackage) {
    summaryByKey[key].salesAmount += data.salesAmount;
  }
  summaryByKey[key].productCost += data.productCost;
  summaryByKey[key].extraCost += data.extraCost;
  summaryByKey[key].packagingCost += data.packagingCost;
  summaryByKey[key].commissionAmount += data.commissionAmount;
  summaryByKey[key].salesVat += data.salesVat;
  summaryByKey[key].purchaseVat += data.purchaseVat;
}

function buildOrderSummary(summary, settings) {
  const salesAmount = roundMoney(summary.salesAmount);
  const productCost = roundMoney(summary.productCost);
  const extraCost = roundMoney(summary.extraCost);
  const packagingCost = roundMoney(summary.packagingCost);
  const commissionAmount = roundMoney(summary.commissionAmount);
  const shippingCost = roundMoney(summary.shippingCost);
  const serviceFee = roundMoney(summary.serviceFee);
  const marketplaceVatRate = vatRateOrDefault(settings.marketplaceVatRate);
  const stopajAmount = roundMoney((salesAmount / (1 + marketplaceVatRate / 100)) * (settings.stoppageRate / 100));
  const adCost = roundMoney(salesAmount * (settings.adCostRate / 100));

  const salesVat = roundMoney(summary.salesVat);
  const purchaseVat = roundMoney(summary.purchaseVat);
  const commissionVat = roundMoney(extractVat(commissionAmount, marketplaceVatRate));
  const shippingVat = roundMoney(extractVat(shippingCost, marketplaceVatRate));
  const serviceFeeVat = roundMoney(extractVat(serviceFee, marketplaceVatRate));

  const vatBalance = salesVat - purchaseVat - commissionVat - shippingVat - serviceFeeVat;
  const payableVat = roundMoney(Math.max(0, vatBalance));
  const carriedForwardVat = roundMoney(Math.max(0, -vatBalance));

  const netProfit = roundMoney(
    salesAmount
    - productCost
    - extraCost
    - packagingCost
    - commissionAmount
    - shippingCost
    - serviceFee
    - stopajAmount
    - adCost
    - payableVat
  );
  const profitRate = salesAmount ? roundMoney(netProfit / salesAmount * 100) : 0;
  const profitMarginBase = salesAmount - salesVat;
  const profitMargin = profitMarginBase ? roundMoney(netProfit / profitMarginBase * 100) : 0;

  return {
    orderNumber: summary.orderNumber,
    orderDate: formatOrderDate(summary.orderDateMs, settings.orderDateTimezone),
    orderDateMs: summary.orderDateMs,
    shipmentPackageId: summary.shipmentPackageId,
    status: summary.status,
    salesAmount,
    packageGrossAmount: roundMoney(summary.packageGrossAmount ?? salesAmount),
    packageTotalDiscount: roundMoney(summary.packageTotalDiscount || 0),
    productCost,
    extraCost,
    packagingCost,
    commissionAmount,
    shippingCost,
    outboundShippingCost: roundMoney(summary.outboundShippingCost),
    returnShippingCost: roundMoney(summary.returnShippingCost),
    shippingCostSource: summary.shippingCostSource || 'default',
    shippingCostEstimated: Boolean(summary.shippingCostEstimated),
    serviceFee,
    stopajAmount,
    adCost,
    salesVat,
    purchaseVat,
    commissionVat,
    shippingVat,
    serviceFeeVat,
    payableVat,
    carriedForwardVat,
    netProfit,
    profitRate,
    profitMargin,
    ingestSource: summary.ingestSource || null,
    customerName: summary.customerName || null,
    customerPhone: summary.customerPhone || null,
    customerAddress: summary.customerAddress || null,
    customerIdentityNumber: summary.customerIdentityNumber || null,
    customerNote: summary.customerNote || null,
    customerLocationMasked: summary.customerLocationMasked ?? null,
    deliveryMethod: summary.deliveryMethod || null,
    paymentMethod: summary.paymentMethod || null,
    benimposSalesCode: summary.benimposSalesCode || null,
    channel: summary.channel || null,
    portalFinancials: summary.portalFinancials || null,
    getirFinancials: summary.getirFinancials || null,
    packagePortalCommissionAmount: roundMoney(summary.packagePortalCommissionAmount || 0),
    packageDeliveryFee: roundMoney(summary.packageDeliveryFee || 0),
    packagePartialRefund: roundMoney(summary.packagePartialRefund || 0),
    packageProvisionAmount: roundMoney(summary.packageProvisionAmount || 0),
    packageProvisionNet: summary.packageProvisionNet,
    packageSellerRevenue: roundMoney(summary.packageSellerRevenue || 0),
    packageDiscountSellerRevenue: roundMoney(summary.packageDiscountSellerRevenue || 0),
    portalProvisionCredit: summary.portalProvisionCredit,
    matchingWarnings: collectOrderMatchingWarnings(summary.lines || []),
    lines: summary.lines || []
  };
}

export function analyzeOrderPackages(packages, db, settings = {}) {
  const costScope = settings.costScope || COST_SCOPE.TRENDYOL_MARKETPLACE;
  const costByBarcode = settings.costByBarcode || buildCostByBarcode(db, costScope);
  const channelId = String(settings.channelId || '').trim();
  const productTitlesByBarcode = settings.productTitlesByBarcode
    || (channelId
      ? buildChannelProductTitleByBarcode(db, channelId)
      : buildProductTitleByBarcode(db, costScope));
  const productImagesByBarcode = settings.productImagesByBarcode
    || (channelId
      ? buildChannelProductImageByBarcode(db, channelId)
      : buildProductImageByBarcode(db));
  const orderDateTimezone = settings.orderDateTimezone || ORDER_TIMEZONE;
  const productMatchingMode = normalizeMatchingMode(settings.productMatchingMode);
  const useMatching = channelId && productMatchingMode !== 'legacy';
  const resolveLine = useMatching ? createOrderLineResolver(db, channelId, productMatchingMode) : null;
  const resolveCostDetails = (byBarcode, resolved) => resolveLineCostDetails(byBarcode, resolved, {
    strictZeroCost: productMatchingMode === 'strict'
  });
  const mergedSettings = {
    costByBarcode,
    productTitlesByBarcode,
    orderDateTimezone,
    cargoByDesi: settings.cargoByDesi || {},
    shippingCostByOrderKey: settings.shippingCostByOrderKey || {},
    defaultShippingCost: toNumber(settings.defaultShippingCost),
    serviceFee: toNumber(settings.serviceFee) || 13.19,
    stoppageRate: toNumber(settings.stoppageRate) || 1,
    adCostRate: toNumber(settings.adCostRate) || 0,
    marketplaceVatRate: vatRateOrDefault(settings.marketplaceVatRate)
  };

  const summaryByKey = {};

  for (const orderPackage of packages) {
    const packageLines = consolidateOrderLines(orderPackage.lines || []);
    orderPackage.lines = packageLines;
    const key = getOrderSummaryKey(orderPackage);
    ensureOrderSummary(summaryByKey, key, orderPackage, mergedSettings);

    for (const line of orderPackage.lines || []) {
      const resolved = resolveLine?.(line) || null;
      const built = buildOrderLine(orderPackage, line, costByBarcode, orderDateTimezone, {
        resolved,
        channelId: useMatching ? channelId : '',
        productTitlesByBarcode,
        productImagesByBarcode,
        resolveCostDetails: useMatching ? resolveCostDetails : null,
        resolveCostOptions: useMatching ? { strictZeroCost: productMatchingMode === 'strict' } : {}
      });
      addLineToOrderSummary(summaryByKey, built.summaryKey, built.summaryData, mergedSettings);
      summaryByKey[built.summaryKey].lines.push(built.line);
    }
  }

  return Object.values(summaryByKey)
    .map((summary) => buildOrderSummary(summary, mergedSettings))
    .sort((a, b) => b.orderDateMs - a.orderDateMs);
}

function filterKpiRows(rows, options = {}) {
  const excludeSources = options.excludeSources || [];
  const excludeConfidence = options.excludeConfidence || ['missing_cost', 'invalid_data'];

  return rows.filter((row) => {
    if (excludeSources.includes(row.ingestSource)) return false;
    const confidence = row.profitConfidence || computeProfitConfidence(row);
    if (excludeConfidence.includes(confidence)) return false;
    return true;
  });
}

export function buildOrderStats(rows, options = {}) {
  const kpiRows = filterKpiRows(rows, options);

  let totalSales = 0;
  let totalProfit = 0;
  let profitable = 0;
  let loss = 0;
  let zero = 0;

  for (const row of kpiRows) {
    totalSales += toNumber(row.salesAmount);
    totalProfit += toNumber(row.netProfit);
    if (row.netProfit > 0) profitable += 1;
    else if (row.netProfit < 0) loss += 1;
    else zero += 1;
  }

  const count = rows.length;
  const kpiCount = kpiRows.length;
  const avgProfit = kpiCount ? roundMoney(totalProfit / kpiCount) : 0;
  const avgOrderValue = kpiCount ? roundMoney(totalSales / kpiCount) : 0;
  const profitRate = totalSales ? roundMoney(totalProfit / totalSales * 100) : 0;

  return {
    count,
    kpiCount,
    excludedFromKpi: count - kpiCount,
    totalSales: roundMoney(totalSales),
    totalProfit: roundMoney(totalProfit),
    avgProfit,
    avgOrderValue,
    profitRate,
    profitable,
    loss,
    zero
  };
}

function formatBucketLabel(key, mode, timeZone = ORDER_TIMEZONE) {
  if (!key) return '';
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  if (mode === 'week') {
    return date.toLocaleDateString('tr-TR', {
      timeZone,
      day: '2-digit',
      month: 'short'
    }) + ' hft';
  }
  return date.toLocaleDateString('tr-TR', {
    timeZone,
    day: '2-digit',
    month: 'short'
  });
}

export function buildOrderTimeline(rows, mode = 'day', timeZone = ORDER_TIMEZONE) {
  const buckets = new Map();

  for (const row of rows) {
    const key = mode === 'week'
      ? orderWeekKey(row.orderDateMs, timeZone)
      : orderDayKey(row.orderDateMs, timeZone);
    if (!key) continue;

    if (!buckets.has(key)) {
      buckets.set(key, { key, label: formatBucketLabel(key, mode, timeZone), salesAmount: 0, netProfit: 0, count: 0 });
    }

    const bucket = buckets.get(key);
    bucket.salesAmount += toNumber(row.salesAmount);
    bucket.netProfit += toNumber(row.netProfit);
    bucket.count += 1;
  }

  return Array.from(buckets.values())
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((item) => ({
      ...item,
      salesAmount: roundMoney(item.salesAmount),
      netProfit: roundMoney(item.netProfit)
    }));
}

export function orderHourFromMs(timestamp, timeZone = LOCAL_ORDER_TIMEZONE) {
  if (!timestamp) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    hour12: false
  }).formatToParts(new Date(timestamp));
  const hour = parts.find((part) => part.type === 'hour')?.value;
  return hour != null ? Number(hour) : null;
}

export function buildCumulativeHourlyTimeline(rows, defaultTimeZone = LOCAL_ORDER_TIMEZONE) {
  const hourly = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: `${String(hour).padStart(2, '0')}:00`,
    periodProfit: 0,
    salesAmount: 0,
    count: 0
  }));

  for (const row of rows) {
    const timeZone = row.channelId
      ? orderDateTimezoneForChannel(row.channelId)
      : defaultTimeZone;
    const hour = orderHourFromMs(row.orderDateMs, timeZone);
    if (hour == null || hour < 0 || hour > 23) continue;
    hourly[hour].periodProfit += toNumber(row.netProfit);
    hourly[hour].salesAmount += toNumber(row.salesAmount);
    hourly[hour].count += 1;
  }

  let cumulative = 0;
  return hourly.map((bucket) => {
    cumulative += bucket.periodProfit;
    return {
      hour: bucket.hour,
      label: bucket.label,
      netProfit: roundMoney(cumulative),
      periodProfit: roundMoney(bucket.periodProfit),
      salesAmount: roundMoney(bucket.salesAmount),
      count: bucket.count
    };
  });
}

export function buildLivePerformanceStats(rows, options = {}) {
  const base = buildOrderStats(rows, options);
  const kpiRows = filterKpiRows(rows, options);
  let totalProductCost = 0;
  let totalSalesNet = 0;

  for (const row of kpiRows) {
    totalProductCost += toNumber(row.productCost);
    totalSalesNet += toNumber(row.salesAmount) - toNumber(row.salesVat);
  }

  totalProductCost = roundMoney(totalProductCost);
  const profitCostRatio = totalProductCost
    ? roundMoney((base.totalProfit / totalProductCost) * 100)
    : 0;
  const profitSalesRatio = base.profitRate;
  const profitMargin = totalSalesNet
    ? roundMoney((base.totalProfit / totalSalesNet) * 100)
    : 0;

  return {
    ...base,
    totalProductCost,
    profitCostRatio,
    profitSalesRatio,
    profitMargin
  };
}

function parseTrendyolWallDateInput(value, endOfDay = false) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (endOfDay) return Date.UTC(y, m - 1, d, 23, 59, 59, 999);
  return Date.UTC(y, m - 1, d, 0, 0, 0, 0);
}

export function nowTrendyolWallMs() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: LOCAL_ORDER_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(new Date());

  const get = (type) => Number(parts.find((part) => part.type === type)?.value || 0);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

/** Calendar date/time in Europe/Istanbul → real UTC epoch ms. */
export function realMsFromIstanbul(y, m, d, h = 0, min = 0, s = 0, ms = 0) {
  const iso = `${y}-${pad2(m)}-${pad2(d)}T${pad2(h)}:${pad2(min)}:${pad2(s)}.${String(ms).padStart(3, '0')}000+03:00`;
  return new Date(iso).getTime();
}

function nowIstanbulParts() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: LOCAL_ORDER_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(new Date());

  const get = (type) => Number(parts.find((part) => part.type === type)?.value || 0);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second')
  };
}

/** Date range for channels that return real UTC timestamps (Uber Eats Go finance API). */
export function resolveRealUtcOrderDateRange(options = {}) {
  const customStart = parseTrendyolWallDateInput(options.startDate, false);

  if (customStart && options.startDate) {
    const match = String(options.startDate).match(/^(\d{4})-(\d{2})-(\d{2})/);
    const endMatch = String(options.endDate || options.startDate).match(/^(\d{4})-(\d{2})-(\d{2})/);
    const startParts = match.slice(1).map(Number);
    const endParts = (endMatch || match).slice(1).map(Number);
    return {
      startDate: realMsFromIstanbul(startParts[0], startParts[1], startParts[2], 0, 0, 0, 0),
      endDate: realMsFromIstanbul(endParts[0], endParts[1], endParts[2], 23, 59, 59, 999)
    };
  }

  const lookbackDays = Math.min(Math.max(toNumber(options.days) || ORDER_LOOKBACK_DAYS, 1), 90);
  const now = nowIstanbulParts();
  const endDate = realMsFromIstanbul(now.year, now.month, now.day, 23, 59, 59, 999);
  const dayStart = realMsFromIstanbul(now.year, now.month, now.day, 0, 0, 0, 0);

  return {
    startDate: dayStart - (lookbackDays - 1) * 24 * 60 * 60 * 1000,
    endDate
  };
}

export function resolveOrderDateRangeForChannel(channelId, options = {}) {
  if (usesRealUtcOrderTimestamps(channelId)) {
    return resolveRealUtcOrderDateRange(options);
  }
  return resolveOrderDateRange(options);
}

export function filterRowsByOrderDate(rows, range) {
  const start = range?.startDate || 0;
  const end = range?.endDate || 0;
  if (!start && !end) return rows;

  return rows.filter((row) => {
    const ms = normalizeOrderTimestamp(row.orderDateMs);
    if (!ms) return false;
    if (start && ms < start) return false;
    if (end && ms > end) return false;
    return true;
  });
}

export function resolveOrderDateRange(options = {}) {
  const customStart = parseTrendyolWallDateInput(options.startDate, false);

  if (customStart && options.startDate) {
    const customEndDay = parseTrendyolWallDateInput(options.endDate, false);
    const now = new Date(nowTrendyolWallMs());
    const endBase = customEndDay ? new Date(customEndDay) : now;
    const endDate = Date.UTC(
      endBase.getUTCFullYear(),
      endBase.getUTCMonth(),
      endBase.getUTCDate(),
      23, 59, 59, 999
    );
    return { startDate: customStart, endDate };
  }

  const lookbackDays = Math.min(Math.max(toNumber(options.days) || ORDER_LOOKBACK_DAYS, 1), 90);
  const now = new Date(nowTrendyolWallMs());
  const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0);
  const endDate = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999);

  return {
    startDate: dayStart - (lookbackDays - 1) * 24 * 60 * 60 * 1000,
    endDate
  };
}

export function orderRowToCsv(rows) {
  const header = [
    'Siparis numarasi',
    'Siparis tarihi',
    'Durum',
    'Siparis tutari',
    'Urun maliyeti',
    'Ek maliyet',
    'Komisyon',
    'Kurye ucreti',
    'Hizmet bedeli',
    'Stopaj',
    'Satis KDV',
    'Alis KDV',
    'Komisyon KDV',
    'Kurye KDV',
    'Hizmet KDV',
    'Net odenecek KDV',
    'Devreden KDV',
    'Net kar',
    'Kar orani %',
    'Kar marji %'
  ];

  const lines = [header.join(';')];
  for (const row of rows) {
    lines.push([
      row.orderNumber,
      row.orderDate,
      row.status,
      row.salesAmount,
      row.productCost,
      row.extraCost,
      row.commissionAmount,
      row.shippingCost,
      row.serviceFee,
      row.stopajAmount,
      row.salesVat,
      row.purchaseVat,
      row.commissionVat,
      row.shippingVat,
      row.serviceFeeVat,
      row.payableVat,
      row.carriedForwardVat,
      row.netProfit,
      row.profitRate,
      row.profitMargin
    ].join(';'));
  }

  return '\uFEFF' + lines.join('\n');
}

const LOSS_PRODUCT_MATCHING_SEVERITY = {
  barcode_conflict: 6,
  missing_master: 5,
  unmapped: 4,
  review_required: 4,
  pending: 3,
  auto_matched: 2,
  legacy_fallback: 2,
  manual_confirmed: 1,
  legacy: 0
};

function worseMatchingStatus(current, next) {
  const a = LOSS_PRODUCT_MATCHING_SEVERITY[current] ?? 0;
  const b = LOSS_PRODUCT_MATCHING_SEVERITY[next] ?? 0;
  return b >= a ? next : current;
}

export function isLossProductMatchingIssue(status) {
  return ['missing_master', 'barcode_conflict', 'review_required', 'pending', 'unmapped'].includes(
    String(status || '').trim()
  );
}

export function aggregateLossProducts(rows) {
  const byBarcode = new Map();

  for (const order of rows || []) {
    if (Number(order.netProfit) >= 0) continue;

    for (const line of order.lines || []) {
      const barcode = String(line.barcode || '').trim();
      if (!barcode) continue;

      let entry = byBarcode.get(barcode);
      if (!entry) {
        entry = {
          barcode,
          productName: line.productName || barcode,
          masterBarcode: line.masterBarcode || '',
          mappingStatus: line.mappingStatus || 'legacy',
          costWarnings: [],
          costWarningSet: new Set(),
          lossOrderNumbers: [],
          lossOrderSet: new Set(),
          lineCount: 0,
          quantity: 0,
          totalSales: 0,
          totalCost: 0,
          totalCommission: 0,
          totalLineNet: 0,
          poolMatchUrl: line.poolMatchUrl || null
        };
        byBarcode.set(barcode, entry);
      }

      entry.lineCount += 1;
      entry.quantity += Number(line.quantity || 0);
      entry.totalSales += Number(line.lineSalesAmount || 0);
      entry.totalCost += Number(line.totalProductCost || 0);
      entry.totalCommission += Number(line.commissionAmount || 0);
      entry.totalLineNet += Number(line.lineNetBeforeFees || 0);
      entry.mappingStatus = worseMatchingStatus(entry.mappingStatus, line.mappingStatus || 'legacy');
      if (line.masterBarcode && !entry.masterBarcode) entry.masterBarcode = line.masterBarcode;
      if (line.poolMatchUrl && !entry.poolMatchUrl) entry.poolMatchUrl = line.poolMatchUrl;

      const orderNumber = String(order.orderNumber || '').trim();
      if (orderNumber && !entry.lossOrderSet.has(orderNumber)) {
        entry.lossOrderSet.add(orderNumber);
        entry.lossOrderNumbers.push(orderNumber);
      }

      for (const warning of line.costWarnings || []) {
        const text = String(warning || '').trim();
        if (!text || entry.costWarningSet.has(text)) continue;
        entry.costWarningSet.add(text);
        entry.costWarnings.push(text);
      }
    }
  }

  return Array.from(byBarcode.values())
    .map(({ costWarningSet, lossOrderSet, ...item }) => ({
      ...item,
      totalSales: roundMoney(item.totalSales),
      totalCost: roundMoney(item.totalCost),
      totalCommission: roundMoney(item.totalCommission),
      totalLineNet: roundMoney(item.totalLineNet),
      lossOrderCount: item.lossOrderNumbers.length,
      hasMatchingIssue: isLossProductMatchingIssue(item.mappingStatus),
      hasCostWarning: item.costWarnings.length > 0
    }))
    .sort((a, b) => a.totalLineNet - b.totalLineNet || b.lossOrderCount - a.lossOrderCount);
}
