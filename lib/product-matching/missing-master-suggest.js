import {
  CHANNEL_PRODUCT_REVIEW,
  MAPPING_STATUS
} from './constants.js';
import {
  nameSimilarityScore,
  normalizeBarcode,
  barcodeLookupKeys,
  barcodesEquivalent,
  parseWeightGrams
} from './normalize.js';
import { resolveChannelDisplayName } from './channel-ingest/uber-eats.js';
import { mastersByBarcode } from './matcher.js';
import { ensureProductMatching } from './schema.js';

const INTERNAL_CODE_HINTS = [
  'mito', 'titan', 'adult', 'test', 'ndk', 'sample', 'demo'
];

function looksLikeInternalSku(barcode) {
  const code = String(barcode || '').trim();
  if (!code) return true;
  if (/^[a-zA-ZğüşıöçİĞÜŞÖÇ]+$/.test(code)) return true;
  if (code.length <= 6 && !/^\d{8,}$/.test(code)) return true;
  const lower = code.toLowerCase();
  return INTERNAL_CODE_HINTS.some((hint) => lower.includes(hint));
}

function looksLikeValidEan(barcode) {
  const code = normalizeBarcode(barcode);
  return /^\d{8,14}$/.test(code);
}

function findMasterByBarcodeVariants(index, barcode) {
  for (const variant of barcodeLookupKeys(barcode)) {
    const hits = index.get(variant) || [];
    if (hits.length === 1) {
      return { master: hits[0], matchedBarcode: variant };
    }
    if (hits.length > 1) {
      return { master: null, conflict: hits, matchedBarcode: variant };
    }
  }
  return null;
}

function findBestNameMatch(channelProduct, masterProducts) {
  const channelName = String(channelProduct.channelName || '').trim();
  if (!channelName || channelName === 'Satış') return null;

  let best = null;
  for (const master of masterProducts) {
    const score = nameSimilarityScore(channelName, master.name);
    if (!best || score > best.score) {
      best = { master, score };
    }
  }

  if (best && best.score >= 45) {
    return best;
  }
  return null;
}

/**
 * Tek missing_master kanal ürünü için inceleme önerisi.
 */
export function suggestMissingMasterReview(channelProduct, masterProducts = []) {
  const barcode = channelProduct.channelBarcode;
  const index = mastersByBarcode(masterProducts);

  if (looksLikeInternalSku(barcode)) {
    return {
      suggestedClassification: CHANNEL_PRODUCT_REVIEW.OUT_OF_SCOPE,
      suggestedNote: 'Uber dahili / test SKU kodu — standart EAN değil',
      confidence: 88,
      reason: 'internal_sku'
    };
  }

  const barcodeHit = findMasterByBarcodeVariants(index, barcode);
  if (barcodeHit?.conflict?.length) {
    return {
      suggestedClassification: CHANNEL_PRODUCT_REVIEW.SALES_BLOCKED,
      suggestedNote: `Aynı barkod varyantında ${barcodeHit.conflict.length} BenimPOS ürünü`,
      confidence: 92,
      reason: 'barcode_variant_conflict',
      candidates: barcodeHit.conflict.map((m) => ({
        masterProductId: m.id,
        name: m.name,
        benimposBarcode: m.benimposBarcode
      }))
    };
  }

  if (barcodeHit?.master) {
    const master = barcodeHit.master;
    const sameCode = barcodesEquivalent(master.benimposBarcode, barcode);
    return {
      suggestedClassification: CHANNEL_PRODUCT_REVIEW.MANUAL_MATCH_NEEDED,
      suggestedNote: sameCode
        ? 'Barkod eşleşmesi var — manuel onay gerekli'
        : `BenimPOS barkodu: ${master.benimposBarcode} (Uber: ${barcode})`,
      confidence: 90,
      reason: 'barcode_variant_match',
      candidateMaster: {
        masterProductId: master.id,
        name: master.name,
        benimposBarcode: master.benimposBarcode,
        stock: master.stock,
        buyingPrice: master.buyingPrice
      }
    };
  }

  const nameHit = findBestNameMatch(channelProduct, masterProducts);
  if (nameHit) {
    return {
      suggestedClassification: CHANNEL_PRODUCT_REVIEW.MANUAL_MATCH_NEEDED,
      suggestedNote: `İsim benzerliği %${nameHit.score} — ${nameHit.master.name}`,
      confidence: Math.min(85, 50 + Math.round(nameHit.score / 2)),
      reason: 'name_similarity',
      candidateMaster: {
        masterProductId: nameHit.master.id,
        name: nameHit.master.name,
        benimposBarcode: nameHit.master.benimposBarcode,
        stock: nameHit.master.stock,
        buyingPrice: nameHit.master.buyingPrice
      }
    };
  }

  const weight = channelProduct.normalizedWeightG ?? parseWeightGrams(channelProduct.channelName);
  if (looksLikeValidEan(barcode) && weight) {
    return {
      suggestedClassification: CHANNEL_PRODUCT_REVIEW.NEEDS_PRODUCT_CARD,
      suggestedNote: 'Geçerli EAN barkod — BenimPOS\'ta ürün kartı açılmalı',
      confidence: 78,
      reason: 'valid_ean_no_master'
    };
  }

  if (looksLikeValidEan(barcode)) {
    return {
      suggestedClassification: CHANNEL_PRODUCT_REVIEW.NEEDS_PRODUCT_CARD,
      suggestedNote: 'BenimPOS ana havuzda barkod bulunamadı',
      confidence: 72,
      reason: 'valid_ean_no_master'
    };
  }

  return {
    suggestedClassification: CHANNEL_PRODUCT_REVIEW.SUSPICIOUS,
    suggestedNote: 'Barkod formatı şüpheli — manuel kontrol',
    confidence: 65,
    reason: 'suspicious_barcode'
  };
}

function filterRowsByOnSale(rows, onSaleFilter) {
  const filter = String(onSaleFilter || '').trim();
  if (filter === 'on') return rows.filter((row) => row.uberOnSale === true);
  if (filter === 'off') return rows.filter((row) => row.uberOnSale === false);
  if (filter === 'unknown') return rows.filter((row) => row.uberOnSale == null);
  return rows;
}

export function buildMissingMasterReviewRows(db, channelId = 'uber-eats', filters = {}) {
  const pm = ensureProductMatching(db);
  const mappingByCp = new Map(
    pm.mappings
      .filter((m) => m.channelId === channelId)
      .map((m) => [m.channelProductId, m])
  );

  const rows = pm.channelProducts
    .filter((cp) => cp.channelId === channelId)
    .map((cp) => {
      const mapping = mappingByCp.get(cp.channelProductId);
      const mappingStatus = mapping?.status || 'unmapped';
      if (mappingStatus !== MAPPING_STATUS.MISSING_MASTER) return null;

      const suggestion = suggestMissingMasterReview(cp, pm.masterProducts);
      return {
        channelProductId: cp.channelProductId,
        channelBarcode: cp.channelBarcode,
        channelName: cp.channelName,
        channelDisplayName: resolveChannelDisplayName(cp),
        uberOnSale: cp.catalogOnSale ?? null,
        catalogSyncedAt: cp.catalogSyncedAt || null,
        mappingStatus,
        reviewClassification: cp.reviewClassification || CHANNEL_PRODUCT_REVIEW.UNREVIEWED,
        reviewNote: cp.reviewNote || '',
        reviewUpdatedAt: cp.reviewUpdatedAt || null,
        suggestion
      };
    })
    .filter(Boolean);

  return filterRowsByOnSale(rows, filters.onSale)
    .sort((a, b) => String(a.channelName || '').localeCompare(String(b.channelName || ''), 'tr-TR'));
}

export function summarizeReviewRows(rows = []) {
  const byClassification = {};
  const bySuggestion = {};
  const byOnSale = { on: 0, off: 0, unknown: 0 };

  for (const row of rows) {
    const cls = row.reviewClassification || CHANNEL_PRODUCT_REVIEW.UNREVIEWED;
    byClassification[cls] = (byClassification[cls] || 0) + 1;

    const sug = row.suggestion?.suggestedClassification;
    if (sug) {
      bySuggestion[sug] = (bySuggestion[sug] || 0) + 1;
    }

    if (row.uberOnSale === true) byOnSale.on += 1;
    else if (row.uberOnSale === false) byOnSale.off += 1;
    else byOnSale.unknown += 1;
  }

  return { byClassification, bySuggestion, byOnSale };
}
