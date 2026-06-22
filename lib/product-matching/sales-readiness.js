import {
  MAPPING_STATUS,
  CHANNEL_PRODUCT_REVIEW,
  CHANNEL_PRODUCT_REVIEW_LABELS
} from './constants.js';
import { ensureProductMatching } from './schema.js';
import { normalizeMatchingMode } from './resolve.js';
import { HZLMRKTOPS_PRODUCTS } from '../hzlmrktops/constants.js';

/** Gerçek BenimPOS satışı için minimum eşleştirme seviyesi */
export const BENIMPOS_SALE_CONFIRM_LEVELS = {
  MANUAL_ONLY: 'manual_only',
  AUTO_OR_MANUAL: 'auto_or_manual'
};

export function resolveBenimposSaleConfirmLevel(mode, envLevel) {
  const level = String(envLevel || '').trim().toLowerCase();
  if (Object.values(BENIMPOS_SALE_CONFIRM_LEVELS).includes(level)) {
    return level;
  }
  // Hybrid/strict: gerçek satış yalnızca manuel onaylı eşleştirme ile
  return normalizeMatchingMode(mode) === 'legacy'
    ? BENIMPOS_SALE_CONFIRM_LEVELS.AUTO_OR_MANUAL
    : BENIMPOS_SALE_CONFIRM_LEVELS.MANUAL_ONLY;
}

const REVIEW_BLOCKS_REAL_SALE = new Set([
  CHANNEL_PRODUCT_REVIEW.SALES_BLOCKED,
  CHANNEL_PRODUCT_REVIEW.OUT_OF_SCOPE,
  CHANNEL_PRODUCT_REVIEW.NEEDS_PRODUCT_CARD,
  CHANNEL_PRODUCT_REVIEW.SUSPICIOUS,
  CHANNEL_PRODUCT_REVIEW.UNREVIEWED
]);

export function mappingMeetsSaleConfirmLevel(mappingStatus, confirmLevel) {
  if (confirmLevel === BENIMPOS_SALE_CONFIRM_LEVELS.AUTO_OR_MANUAL) {
    return mappingStatus === MAPPING_STATUS.MANUAL_CONFIRMED
      || mappingStatus === MAPPING_STATUS.AUTO_MATCHED;
  }
  return mappingStatus === MAPPING_STATUS.MANUAL_CONFIRMED;
}

export function reviewBlocksRealSale(channelProduct) {
  const cls = channelProduct?.reviewClassification;
  if (!cls) return false;
  return REVIEW_BLOCKS_REAL_SALE.has(cls);
}

/**
 * Kanal geneli satış hazırlığı — eksik eşleştirme / inceleme özeti.
 */
export function buildChannelSalesReadiness(db, channelId = 'uber-eats', confirmLevel = BENIMPOS_SALE_CONFIRM_LEVELS.MANUAL_ONLY) {
  const pm = ensureProductMatching(db);
  const channelProducts = pm.channelProducts.filter((cp) => cp.channelId === channelId);
  const mappings = pm.mappings.filter((m) => m.channelId === channelId);

  const byStatus = {};
  for (const m of mappings) {
    byStatus[m.status] = (byStatus[m.status] || 0) + 1;
  }

  const missingMaster = byStatus[MAPPING_STATUS.MISSING_MASTER] || 0;
  const autoMatched = byStatus[MAPPING_STATUS.AUTO_MATCHED] || 0;
  const manualConfirmed = byStatus[MAPPING_STATUS.MANUAL_CONFIRMED] || 0;
  const reviewRequired = byStatus[MAPPING_STATUS.REVIEW_REQUIRED] || 0;
  const pending = byStatus[MAPPING_STATUS.PENDING] || 0;
  const conflicts = byStatus[MAPPING_STATUS.BARCODE_CONFLICT] || 0;

  const reviewByClass = {};
  let blockingReview = 0;
  for (const cp of channelProducts) {
    const cls = cp.reviewClassification || CHANNEL_PRODUCT_REVIEW.UNREVIEWED;
    reviewByClass[cls] = (reviewByClass[cls] || 0) + 1;
    const mapping = mappings.find((m) => m.channelProductId === cp.channelProductId);
    if (mapping?.status === MAPPING_STATUS.MISSING_MASTER && REVIEW_BLOCKS_REAL_SALE.has(cls)) {
      blockingReview += 1;
    }
  }

  const blockers = [];
  if (missingMaster > 0) {
    blockers.push(`${missingMaster} kanal ürününde BenimPOS eşleşmesi yok`);
  }
  if (autoMatched > 0 && confirmLevel === BENIMPOS_SALE_CONFIRM_LEVELS.MANUAL_ONLY) {
    blockers.push(`${autoMatched} otomatik eşleşme manuel onay bekliyor`);
  }
  if (reviewRequired + pending + conflicts > 0) {
    blockers.push(`${reviewRequired + pending + conflicts} eşleştirme kontrol/çakışma durumunda`);
  }
  if (blockingReview > 0) {
    blockers.push(`${blockingReview} ürün inceleme sınıfı nedeniyle satışa kapalı`);
  }

  const readyForSales = blockers.length === 0 && manualConfirmed > 0;

  const nextSteps = [];
  const inboxBase = HZLMRKTOPS_PRODUCTS;
  if (missingMaster > 0) {
    nextSteps.push({
      action: 'review_missing_master',
      label: 'BenimPOS\'ta yok ürünleri incele',
      href: inboxBase
    });
  }
  if (autoMatched > 0 && confirmLevel === BENIMPOS_SALE_CONFIRM_LEVELS.MANUAL_ONLY) {
    nextSteps.push({
      action: 'confirm_auto_matched',
      label: 'Otomatik eşleşmeleri onayla',
      href: inboxBase
    });
  }
  if (reviewRequired + pending + conflicts > 0) {
    nextSteps.push({
      action: 'resolve_conflicts',
      label: 'Manuel kontrol listesini temizle',
      href: inboxBase
    });
  }

  return {
    channelId,
    readyForSales,
    policy: 'matching-before-sale',
    saleConfirmLevel: confirmLevel,
    stats: {
      channelProducts: channelProducts.length,
      mappings: mappings.length,
      manualConfirmed,
      autoMatched,
      missingMaster,
      reviewRequired,
      pending,
      barcodeConflict: conflicts,
      blockingReview,
      reviewByClass
    },
    blockers,
    nextSteps,
    reviewLabels: CHANNEL_PRODUCT_REVIEW_LABELS
  };
}

export function enrichPreviewWithSaleGate(preview, confirmLevel) {
  const lines = (preview.lines || []).map((line) => {
    const meetsConfirm = mappingMeetsSaleConfirmLevel(line.mappingStatus, confirmLevel);
    const needsManualConfirm = line.mappingStatus === MAPPING_STATUS.AUTO_MATCHED
      && confirmLevel === BENIMPOS_SALE_CONFIRM_LEVELS.MANUAL_ONLY;

    let realSaleAllowed = line.saleAllowed && meetsConfirm;
    let realSaleBlockReason = line.blockReason;
    let realSaleWarning = line.warning;

    if (line.saleAllowed && needsManualConfirm) {
      realSaleAllowed = false;
      realSaleBlockReason = 'manuel_onay_gerekli';
      realSaleWarning = 'Otomatik eşleşti — satış öncesi manuel onay gerekli';
    }

    if (line.reviewClassification && REVIEW_BLOCKS_REAL_SALE.has(line.reviewClassification)
      && line.mappingStatus === MAPPING_STATUS.MISSING_MASTER) {
      realSaleAllowed = false;
      realSaleBlockReason = 'inceleme_engeli';
      realSaleWarning = CHANNEL_PRODUCT_REVIEW_LABELS[line.reviewClassification] || line.reviewClassification;
    }

    return {
      ...line,
      realSaleAllowed,
      realSaleBlockReason,
      realSaleWarning,
      needsManualConfirm,
      confirmLevel
    };
  });

  const realBlocked = lines.filter((l) => !l.realSaleAllowed);
  const realBlockReasons = [...new Set(
    realBlocked.map((l) => l.realSaleWarning || l.realSaleBlockReason).filter(Boolean)
  )];

  return {
    ...preview,
    lines,
    canSend: lines.length > 0 && realBlocked.length === 0,
    canSendRealSale: lines.length > 0 && realBlocked.length === 0,
    canSendDryRun: lines.some((l) => l.saleAllowed || l.needsManualConfirm),
    blockedLines: realBlocked.length,
    sendableLines: lines.length - realBlocked.length,
    blockReasons: realBlockReasons,
    saleConfirmLevel: confirmLevel,
    matchingRequired: true
  };
}
