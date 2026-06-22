import {
  MAPPING_STATUS,
  CHANNEL_PRODUCT_REVIEW,
  CHANNEL_PRODUCT_REVIEW_LABELS
} from './constants.js';
import { normalizeBarcode } from './normalize.js';
import {
  findChannelProductForLine,
  findMappingForChannelLine,
  resolveMappingForChannelLine
} from './lookup.js';
import { resolveChannelDisplayName } from './channel-ingest/uber-eats.js';
import { productPoolUrlForMappingStatus } from './pool-url.js';
import { resolveTeraziSaleBarcode, resolveTeraziSaleQuantity, resolveTeraziSaleUnitPrice } from '../benimpos/terazi-barcode.js';
import { proposeMatchForChannelProduct } from './matcher.js';
import { getProductMatching } from './store.js';

export { CHANNEL_PRODUCT_REVIEW, CHANNEL_PRODUCT_REVIEW_LABELS };

const SALE_ALLOWED_STATUSES = new Set([
  MAPPING_STATUS.MANUAL_CONFIRMED,
  MAPPING_STATUS.AUTO_MATCHED
]);

const SALE_BLOCKED_STATUSES = new Set([
  MAPPING_STATUS.MISSING_MASTER,
  MAPPING_STATUS.BARCODE_CONFLICT,
  MAPPING_STATUS.REVIEW_REQUIRED,
  MAPPING_STATUS.PENDING,
  MAPPING_STATUS.MISSING_CHANNEL
]);

const REVIEW_BLOCKS_SALE = new Set([
  CHANNEL_PRODUCT_REVIEW.SALES_BLOCKED,
  CHANNEL_PRODUCT_REVIEW.OUT_OF_SCOPE
]);

const STATUS_WARNINGS = {
  [MAPPING_STATUS.MISSING_MASTER]: 'BenimPOS ana ürünü bulunamadı',
  [MAPPING_STATUS.BARCODE_CONFLICT]: 'Aynı barkoda birden fazla ana ürün',
  [MAPPING_STATUS.REVIEW_REQUIRED]: 'Eşleştirme kontrol gerektiriyor',
  [MAPPING_STATUS.PENDING]: 'Eşleştirme henüz onaylanmadı',
  unmapped: 'Onaylı eşleştirme yok',
  legacy_blocked: 'Legacy barkod fallback satışta kapalı'
};

function findChannelProduct(db, channelId, channelBarcode) {
  return findChannelProductForLine(db, channelId, channelBarcode);
}

function reviewBlocksSale(channelProduct, mappingRecord = null) {
  const cls = channelProduct?.reviewClassification;
  if (!cls) return false;
  if (cls === CHANNEL_PRODUCT_REVIEW.SALES_BLOCKED) return true;
  if (cls === CHANNEL_PRODUCT_REVIEW.OUT_OF_SCOPE) {
    const status = mappingRecord?.status;
    if (status === MAPPING_STATUS.MANUAL_CONFIRMED || status === MAPPING_STATUS.AUTO_MATCHED) {
      return false;
    }
    return true;
  }
  return false;
}

function reviewWarning(channelProduct) {
  const cls = channelProduct?.reviewClassification;
  if (!cls || cls === CHANNEL_PRODUCT_REVIEW.UNREVIEWED) return null;
  return CHANNEL_PRODUCT_REVIEW_LABELS[cls] || cls;
}

/**
 * Sipariş satırından eşleştirme arama anahtarları (barkod boş kanallar: Getir vb.).
 */
export function resolveOrderLineLookupKeys(rawLine = {}) {
  const keys = [];
  const add = (value) => {
    const text = String(value || '').trim();
    if (text && !keys.includes(text)) keys.push(text);
  };

  add(rawLine.barcode);
  add(rawLine.channelBarcode);
  add(rawLine.stockCode);
  add(rawLine.channelProductId);
  add(rawLine.channel_product_id);

  const orderLineName = String(
    rawLine.productName || rawLine.name || rawLine.title || ''
  ).trim();
  if (orderLineName) add(slugChannelProductId(orderLineName));

  return keys;
}

function resolveChannelLineForSaleOneKey(db, channelId, lineKey) {
  const key = String(lineKey || '').trim();
  if (!key) return null;

  const channelProduct = findChannelProduct(db, channelId, key);
  const mappingRecord = findMappingForChannelLine(db, channelId, key);
  const channelCode = normalizeBarcode(key) || key;

  if (reviewBlocksSale(channelProduct, mappingRecord)) {
    return saleBlocked({
      channelBarcode: channelCode,
      channelProduct,
      mapping: mappingRecord,
      mappingStatus: mappingRecord?.status || channelProduct?.mappingStatus || 'unmapped',
      blockReason: 'inceleme_engeli',
      warning: reviewWarning(channelProduct) || 'Ürün inceleme nedeniyle satışa kapalı'
    });
  }

  const mapped = resolveMappingForChannelLine(db, channelId, key);
  const mappingStatus = mapped?.mapping?.status || mappingRecord?.status || 'unmapped';

  if (!mapped || !SALE_ALLOWED_STATUSES.has(mapped.mapping.status)) {
    const status = SALE_BLOCKED_STATUSES.has(mappingStatus)
      ? mappingStatus
      : (mappingRecord ? mappingRecord.status : 'unmapped');

    return saleBlocked({
      channelBarcode: channelCode,
      channelProduct,
      mapping: mappingRecord || mapped?.mapping || null,
      master: mapped?.master || null,
      mappingStatus: status,
      blockReason: status === 'unmapped' ? 'eslestirme_yok' : status,
      warning: STATUS_WARNINGS[status] || STATUS_WARNINGS.unmapped
    });
  }

  const master = mapped.master;
  const masterBarcode = normalizeBarcode(master.benimposBarcode);
  const warnings = [];

  const reviewNote = reviewWarning(channelProduct);
  if (reviewNote && channelProduct?.reviewClassification === CHANNEL_PRODUCT_REVIEW.SUSPICIOUS) {
    warnings.push(reviewNote);
  }

  const stock = Number(master.stock);
  if (!Number.isFinite(stock) || stock <= 0) {
    warnings.push('BenimPOS stok sıfır veya eksik');
  }

  const buyingPrice = Number(master.buyingPrice);
  if (!Number.isFinite(buyingPrice) || buyingPrice <= 0) {
    warnings.push('Alış maliyeti tanımlı değil');
  }

  return {
    saleAllowed: true,
    includeInSale: true,
    source: 'mapping',
    channelBarcode: channelCode,
    saleBarcode: masterBarcode || channelCode,
    master,
    mapping: mapped.mapping,
    mappingStatus: mapped.mapping.status,
    channelProduct,
    warnings,
    blockReason: null,
    warning: null,
    lineLookupKey: key
  };
}

/**
 * BenimPOS satışı için katı çözümleme — legacy barkod fallback YOK.
 * Yalnızca manual_confirmed veya güvenli auto_matched satırlar gönderilebilir.
 */
export function resolveChannelLineForSale(db, { channelId, channelBarcode, rawLine = null, lineKeys = null } = {}) {
  const keys = lineKeys?.length
    ? lineKeys
    : rawLine
      ? resolveOrderLineLookupKeys(rawLine)
      : [String(channelBarcode || '').trim()].filter(Boolean);

  if (!keys.length) {
    return saleBlocked({
      channelBarcode: '',
      mappingStatus: 'missing_channel',
      blockReason: 'barkod_yok',
      warning: 'Kanal ürün kodu veya barkod yok'
    });
  }

  let lastBlocked = null;
  for (const key of keys) {
    const result = resolveChannelLineForSaleOneKey(db, channelId, key);
    if (!result) continue;
    if (result.saleAllowed) return result;
    if (!lastBlocked || result.mapping) lastBlocked = result;
  }

  return lastBlocked || saleBlocked({
    channelBarcode: normalizeBarcode(keys[0]) || keys[0],
    mappingStatus: 'unmapped',
    blockReason: 'eslestirme_yok',
    warning: STATUS_WARNINGS.unmapped
  });
}

function saleBlocked(details) {
  return {
    saleAllowed: false,
    includeInSale: false,
    source: 'blocked',
    channelBarcode: details.channelBarcode,
    saleBarcode: '',
    master: details.master || null,
    mapping: details.mapping || null,
    mappingStatus: details.mappingStatus || 'unmapped',
    channelProduct: details.channelProduct || null,
    warnings: details.warning ? [details.warning] : [],
    blockReason: details.blockReason || 'engelli',
    warning: details.warning || STATUS_WARNINGS.unmapped
  };
}

export function slugChannelProductId(text) {
  const slug = String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9ğüşıöç]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56);
  return slug ? `order-name-${slug}` : '';
}

export function resolveOrderLineChannelProductId(rawLine, resolved = {}) {
  const fromLine = String(
    rawLine.channelProductId ||
    rawLine.stockCode ||
    rawLine.channel_product_id ||
    ''
  ).trim();
  if (fromLine) return fromLine;

  return String(
    resolved.channelProduct?.channelProductId ||
    resolved.channelBarcode ||
    ''
  ).trim();
}

function resolveBarcodeMatchSuggestion(db, channelId, rawLine, resolved, orderLineName) {
  const channelProductId = resolveOrderLineChannelProductId(rawLine, resolved)
    || slugChannelProductId(orderLineName);
  const channelBarcode = String(
    rawLine.barcode || resolved.channelBarcode || ''
  ).trim();
  if (!channelProductId && !channelBarcode) return null;

  const pm = getProductMatching(db);
  const proposal = proposeMatchForChannelProduct({
    channelId,
    channelProductId,
    channelBarcode,
    channelName: orderLineName || channelProductId
  }, pm.masterProducts);

  if (!proposal?.masterProductId) return null;

  const master = pm.masterProducts.find((row) => row.id === proposal.masterProductId);
  if (!master) return null;

  return {
    masterProductId: master.id,
    masterName: master.name,
    masterBarcode: master.benimposBarcode,
    channelProductId,
    channelBarcode,
    reason: proposal.reasons?.[0] || 'Barkod eşleşmesi'
  };
}

export function buildSalePreviewLine(orderPackage, rawLine, db, channelId) {
  const resolved = resolveChannelLineForSale(db, {
    channelId,
    rawLine
  });

  const quantity = Number(rawLine.quantity) || 1;
  const unitPrice = Number(
    rawLine.lineUnitPrice ?? rawLine.unitSalesPrice ?? rawLine.price
  ) || 0;
  const channelProductName = resolveChannelDisplayName(
    resolved.channelProduct,
    resolved.master
  );
  const orderLineName = String(rawLine.productName || rawLine.name || rawLine.title || '').trim()
    || (channelProductName !== '—' ? channelProductName : '');
  const channelProductId = resolveOrderLineChannelProductId(rawLine, resolved)
    || slugChannelProductId(orderLineName);
  const barcodeMatch = !resolved.saleAllowed
    ? resolveBarcodeMatchSuggestion(db, channelId, rawLine, resolved, orderLineName)
    : null;
  const suggestedMasterProductId =
    resolved.master?.id
    || resolved.channelProduct?.suggestedMasterProductId
    || barcodeMatch?.masterProductId
    || null;
  const baseBarcode = resolved.master?.benimposBarcode || resolved.saleBarcode || '';
  const orderGrams = rawLine.orderGrams ?? rawLine.totalWeightGrams ?? rawLine.teraziOrderGrams ?? null;
  const terazi = resolved.saleAllowed && resolved.master
    ? resolveTeraziSaleBarcode({ baseBarcode, master: resolved.master, orderLineName, orderGrams })
    : {
      saleBarcode: baseBarcode,
      teraziApplied: false,
      orderGrams: null,
      unitGrams: null,
      costRatio: 1
    };
  const teraziWarnings = [];
  if (terazi.teraziApplied) {
    const saleQty = resolveTeraziSaleQuantity(terazi, quantity);
    teraziWarnings.push(
      `Terazi: ${terazi.saleBarcode} × ${saleQty} adet (${terazi.orderGrams} g / ${terazi.unitGrams} g birim)`
    );
  } else if (terazi.orderGrams && terazi.unitGrams && terazi.orderGrams === terazi.unitGrams) {
    teraziWarnings.push('Gramaj master birimi ile aynı — ana barkod');
  }

  return {
    channelBarcode: resolved.channelBarcode || String(rawLine.barcode || '').trim(),
    channelProductId,
    channelProductName: channelProductName !== '—'
      ? channelProductName
      : orderLineName,
    quantity,
    unitPrice,
    lineSalesAmount: unitPrice * quantity,
    masterProductId: resolved.master?.id || suggestedMasterProductId,
    suggestedMasterProductId,
    masterName: resolved.master?.name
      || resolved.channelProduct?.suggestedMasterName
      || barcodeMatch?.masterName
      || null,
    masterBarcode: resolved.master?.benimposBarcode
      || barcodeMatch?.masterBarcode
      || baseBarcode,
    saleBarcode: terazi.saleBarcode,
    teraziApplied: terazi.teraziApplied,
    teraziOrderGrams: terazi.orderGrams,
    teraziUnitGrams: terazi.unitGrams,
    teraziCostRatio: terazi.costRatio,
    teraziSaleQuantity: resolveTeraziSaleQuantity(terazi, quantity),
    teraziSaleUnitPrice: resolveTeraziSaleUnitPrice(unitPrice, terazi),
    barcodeMasterProductId: barcodeMatch?.masterProductId || null,
    barcodeMasterName: barcodeMatch?.masterName || null,
    barcodeMasterBarcode: barcodeMatch?.masterBarcode || null,
    barcodeMatchReason: barcodeMatch?.reason || null,
    stock: resolved.master?.stock ?? null,
    buyingPrice: resolved.master?.buyingPrice ?? null,
    mappingStatus: resolved.mappingStatus,
    mappingSource: resolved.source,
    saleAllowed: resolved.saleAllowed,
    blockReason: resolved.blockReason,
    warnings: [...(resolved.warnings || []), ...teraziWarnings],
    warning: resolved.warning,
    reviewClassification: resolved.channelProduct?.reviewClassification || CHANNEL_PRODUCT_REVIEW.UNREVIEWED,
    reviewNote: resolved.channelProduct?.reviewNote || '',
    poolMatchUrl: productPoolUrlForMappingStatus(channelId, resolved.channelBarcode, resolved.mappingStatus),
    needsInlineMatch: !resolved.saleAllowed
      && resolved.mappingStatus !== MAPPING_STATUS.AUTO_MATCHED
  };
}

export function buildChannelSalePreview(orderPackage, db, { channelId = 'uber-eats' } = {}) {
  const lines = (orderPackage.lines || []).map((rawLine) =>
    buildSalePreviewLine(orderPackage, rawLine, db, channelId)
  );

  const sendableLines = lines.filter((line) => line.saleAllowed);
  const blockedLines = lines.filter((line) => !line.saleAllowed);
  const blockReasons = [...new Set(blockedLines.map((line) => line.warning || line.blockReason).filter(Boolean))];

  return {
    orderNumber: orderPackage.orderNumber || '',
    channelId,
    totalLines: lines.length,
    sendableLines: sendableLines.length,
    blockedLines: blockedLines.length,
    canSend: lines.length > 0 && blockedLines.length === 0,
    blockReasons,
    lines,
    policy: 'sale-strict-no-legacy-fallback'
  };
}
