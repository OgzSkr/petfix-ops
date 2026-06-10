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

function reviewBlocksSale(channelProduct) {
  const cls = channelProduct?.reviewClassification;
  return cls && REVIEW_BLOCKS_SALE.has(cls);
}

function reviewWarning(channelProduct) {
  const cls = channelProduct?.reviewClassification;
  if (!cls || cls === CHANNEL_PRODUCT_REVIEW.UNREVIEWED) return null;
  return CHANNEL_PRODUCT_REVIEW_LABELS[cls] || cls;
}

/**
 * BenimPOS satışı için katı çözümleme — legacy barkod fallback YOK.
 * Yalnızca manual_confirmed veya güvenli auto_matched satırlar gönderilebilir.
 */
export function resolveChannelLineForSale(db, { channelId, channelBarcode }) {
  const channelCode = normalizeBarcode(channelBarcode);
  const channelProduct = findChannelProduct(db, channelId, channelCode);
  const mappingRecord = findMappingForChannelLine(db, channelId, channelCode);

  if (!channelCode) {
    return saleBlocked({
      channelBarcode: '',
      mappingStatus: 'missing_channel',
      blockReason: 'barkod_yok',
      warning: STATUS_WARNINGS.missing_channel
    });
  }

  if (reviewBlocksSale(channelProduct)) {
    return saleBlocked({
      channelBarcode: channelCode,
      channelProduct,
      mapping: mappingRecord,
      mappingStatus: mappingRecord?.status || channelProduct?.mappingStatus || 'unmapped',
      blockReason: 'inceleme_engeli',
      warning: reviewWarning(channelProduct) || 'Ürün inceleme nedeniyle satışa kapalı'
    });
  }

  const mapped = resolveMappingForChannelLine(db, channelId, channelCode);
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
    warning: null
  };
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

export function buildSalePreviewLine(orderPackage, rawLine, db, channelId) {
  const resolved = resolveChannelLineForSale(db, {
    channelId,
    channelBarcode: rawLine.barcode
  });

  const quantity = Number(rawLine.quantity) || 1;
  const unitPrice = Number(
    rawLine.lineUnitPrice ?? rawLine.unitSalesPrice ?? rawLine.price
  ) || 0;
  const channelProductName = resolveChannelDisplayName(
    resolved.channelProduct,
    resolved.master
  );
  const channelProductId = resolved.channelProduct?.channelProductId || resolved.channelBarcode;
  const suggestedMasterProductId =
    resolved.master?.id
    || resolved.channelProduct?.suggestedMasterProductId
    || null;

  return {
    channelBarcode: resolved.channelBarcode,
    channelProductId,
    channelProductName: channelProductName !== '—'
      ? channelProductName
      : String(rawLine.productName || '').trim(),
    quantity,
    unitPrice,
    lineSalesAmount: unitPrice * quantity,
    masterProductId: resolved.master?.id || suggestedMasterProductId,
    suggestedMasterProductId,
    masterName: resolved.master?.name || resolved.channelProduct?.suggestedMasterName || null,
    masterBarcode: resolved.master?.benimposBarcode || resolved.saleBarcode || '',
    stock: resolved.master?.stock ?? null,
    buyingPrice: resolved.master?.buyingPrice ?? null,
    mappingStatus: resolved.mappingStatus,
    mappingSource: resolved.source,
    saleAllowed: resolved.saleAllowed,
    blockReason: resolved.blockReason,
    warnings: resolved.warnings,
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
