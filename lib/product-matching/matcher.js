import {
  MAPPING_STATUS,
  MATCH_METHOD
} from './mapping-types.js';
import { ensureProductMatching } from './schema.js';
import {
  detectVariantKey,
  looksLikeMultipack,
  nameSimilarityScore,
  barcodeLookupKeys,
  dedupeBarcodes,
  parseWeightGrams
} from './normalize.js';
export { resolveMappingForChannelLine } from './lookup.js';

const NAME_REVIEW_THRESHOLD = 35;
const NAME_AUTO_THRESHOLD = 55;

export function mastersByBarcode(masterProducts = []) {
  const map = new Map();
  for (const master of masterProducts) {
    for (const code of barcodeLookupKeys(master.benimposBarcode)) {
      if (!code) continue;
      if (!map.has(code)) map.set(code, []);
      const bucket = map.get(code);
      if (!bucket.some((row) => row.id === master.id)) bucket.push(master);
    }
  }
  return map;
}

function lookupMastersByBarcode(index, barcode) {
  const seen = new Map();
  for (const code of barcodeLookupKeys(barcode)) {
    for (const master of index.get(code) || []) {
      seen.set(master.id, master);
    }
  }
  return [...seen.values()];
}

/** Kanal ürününün tüm barkodları (çoklu barkod desteği) — birincil dahil tekilleştirilir. */
export function channelProductBarcodes(channelProduct = {}) {
  const list = Array.isArray(channelProduct.channelBarcodes) ? channelProduct.channelBarcodes : [];
  return dedupeBarcodes([...list, channelProduct.channelBarcode]);
}

export function evaluateChannelToMasterMatch(channelProduct, masterProduct, context = {}) {
  const reasons = [];
  let confidence = 100;
  const trustExactBarcode = Boolean(context.trustExactBarcode);

  const channelName = String(channelProduct.channelName || '').trim();
  const masterName = String(masterProduct.name || '').trim();

  if (channelName && channelName !== 'Satış') {
    const nameScore = nameSimilarityScore(channelName, masterName);
    if (nameScore < NAME_REVIEW_THRESHOLD) {
      reasons.push('isim_uyusmazligi');
      if (!trustExactBarcode) confidence -= 40;
      else confidence -= 5;
    } else if (nameScore < NAME_AUTO_THRESHOLD) {
      reasons.push('isim_dusuk_benzerlik');
      if (!trustExactBarcode) confidence -= 15;
    }
  }

  const channelWeight = channelProduct.normalizedWeightG ?? parseWeightGrams(channelName);
  const masterWeight = masterProduct.normalizedWeightG ?? parseWeightGrams(masterName);

  if (channelWeight && masterWeight && channelWeight !== masterWeight) {
    reasons.push('gramaj_farkli');
    confidence -= 35;
  }

  const channelVariant = channelProduct.variantKey || detectVariantKey(channelName);
  const masterVariant = masterProduct.variantKey || detectVariantKey(masterName);

  if (channelVariant && masterVariant && channelVariant !== masterVariant) {
    reasons.push('varyant_farkli');
    confidence -= 30;
  }

  if (looksLikeMultipack(channelName) !== looksLikeMultipack(masterName)) {
    reasons.push('paket_tipi_farkli');
    confidence -= 20;
  }

  confidence = Math.max(0, Math.min(100, confidence));

  // Tek barkod eşleşmesi — isim/gramaj farkına rağmen otomatik eşleştir.
  if (trustExactBarcode) {
    return {
      status: MAPPING_STATUS.AUTO_MATCHED,
      confidenceScore: Math.max(confidence, 95),
      reasons
    };
  }

  let status = MAPPING_STATUS.AUTO_MATCHED;
  const hardReviewReasons = ['gramaj_farkli', 'varyant_farkli', 'paket_tipi_farkli'];
  if (reasons.some((r) => hardReviewReasons.includes(r))) {
    status = MAPPING_STATUS.REVIEW_REQUIRED;
  } else if (!trustExactBarcode && reasons.includes('isim_uyusmazligi')) {
    status = MAPPING_STATUS.REVIEW_REQUIRED;
  } else if (!trustExactBarcode && reasons.includes('isim_dusuk_benzerlik')) {
    status = MAPPING_STATUS.PENDING;
  }

  return { status, confidenceScore: confidence, reasons };
}

export function proposeMatchForChannelProduct(channelProduct, masterProducts = []) {
  const barcodes = channelProductBarcodes(channelProduct);
  if (!barcodes.length) {
    return {
      status: MAPPING_STATUS.MISSING_CHANNEL,
      masterProductId: null,
      confidenceScore: 0,
      reasons: ['barkod_yok'],
      candidates: []
    };
  }

  // Getir gibi kanallar ürüne birden fazla barkod tanımlayabilir; hepsiyle ana ürün ara.
  const index = mastersByBarcode(masterProducts);
  const seen = new Map();
  for (const barcode of barcodes) {
    for (const master of lookupMastersByBarcode(index, barcode)) {
      seen.set(master.id, master);
    }
  }
  const candidates = [...seen.values()];

  if (!candidates.length) {
    return {
      status: MAPPING_STATUS.MISSING_MASTER,
      masterProductId: null,
      confidenceScore: 0,
      reasons: ['benimpos_barkod_yok'],
      candidates: []
    };
  }

  if (candidates.length > 1) {
    return {
      status: MAPPING_STATUS.BARCODE_CONFLICT,
      masterProductId: null,
      confidenceScore: 0,
      reasons: ['aynı_barkod_birden_fazla_ana_urun'],
      candidates: candidates.map((c) => ({
        masterProductId: c.id,
        name: c.name,
        benimposBarcode: c.benimposBarcode
      }))
    };
  }

  const master = candidates[0];
  const evaluation = evaluateChannelToMasterMatch(channelProduct, master, {
    trustExactBarcode: true
  });

  return {
    status: evaluation.status,
    masterProductId: master.id,
    masterProductName: master.name,
    confidenceScore: evaluation.confidenceScore,
    reasons: evaluation.reasons,
    candidates: [{
      masterProductId: master.id,
      name: master.name,
      benimposBarcode: master.benimposBarcode
    }]
  };
}

/**
 * Barkod eşleşmesi yokken isim benzerliği ile aday öner — yalnızca PENDING, otomatik onay yok.
 */
export function proposeFuzzyMatchForChannelProduct(channelProduct, masterProducts = []) {
  const channelName = String(channelProduct.channelName || '').trim();
  if (!channelName || channelName === 'Satış') return null;

  let best = null;
  for (const master of masterProducts) {
    const score = nameSimilarityScore(channelName, master.name);
    if (!best || score > best.score) {
      best = { master, score };
    }
  }

  if (!best || best.score < NAME_REVIEW_THRESHOLD) return null;

  const evaluation = evaluateChannelToMasterMatch(channelProduct, best.master, {
    trustExactBarcode: false
  });

  return {
    status: MAPPING_STATUS.PENDING,
    masterProductId: best.master.id,
    masterProductName: best.master.name,
    confidenceScore: Math.min(evaluation.confidenceScore, best.score),
    reasons: ['isim_benzerligi', `skor_${best.score}`, ...evaluation.reasons],
    matchMethod: MATCH_METHOD.AUTO_FUZZY,
    candidates: [{
      masterProductId: best.master.id,
      name: best.master.name,
      benimposBarcode: best.master.benimposBarcode,
      nameScore: best.score
    }]
  };
}

export function runAutoMatchForChannel(db, channelId = 'uber-eats', options = {}) {
  const allowFuzzy = options.allowFuzzy === true;
  const pm = ensureProductMatching(db);
  const channelProducts = pm.channelProducts.filter((cp) => cp.channelId === channelId);
  const masterProducts = pm.masterProducts || [];

  const protectedStatuses = new Set([
    MAPPING_STATUS.MANUAL_CONFIRMED,
    MAPPING_STATUS.AUTO_MATCHED
  ]);

  const existingByChannelProduct = new Map(
    pm.mappings
      .filter((m) => m.channelId === channelId)
      .map((m) => [m.channelProductId, m])
  );

  const summary = {
    channelId,
    scanned: channelProducts.length,
    autoMatched: 0,
    pending: 0,
    reviewRequired: 0,
    missingMaster: 0,
    barcodeConflict: 0,
    fuzzyProposed: 0,
    fuzzyCleared: 0,
    skippedProtected: 0,
    conflictsAdded: 0
  };

  pm.conflicts = (pm.conflicts || []).filter((c) => c.channelId !== channelId);

  for (const channelProduct of channelProducts) {
    const existing = existingByChannelProduct.get(channelProduct.channelProductId);
    if (existing && protectedStatuses.has(existing.status) && existing.matchMethod === MATCH_METHOD.MANUAL) {
      summary.skippedProtected += 1;
      continue;
    }
    if (existing?.status === MAPPING_STATUS.MANUAL_CONFIRMED) {
      summary.skippedProtected += 1;
      continue;
    }

    const proposal = proposeMatchForChannelProduct(channelProduct, masterProducts);
    let matchMethod = MATCH_METHOD.AUTO_BARCODE;
    let finalProposal = proposal;

    if (proposal.status === MAPPING_STATUS.MISSING_MASTER) {
      if (allowFuzzy) {
        const fuzzy = proposeFuzzyMatchForChannelProduct(channelProduct, masterProducts);
        if (fuzzy) {
          finalProposal = fuzzy;
          matchMethod = MATCH_METHOD.AUTO_FUZZY;
        }
      } else if (
        existing?.status === MAPPING_STATUS.PENDING
        && existing?.matchMethod === MATCH_METHOD.AUTO_FUZZY
      ) {
        finalProposal = proposal;
        matchMethod = MATCH_METHOD.AUTO_BARCODE;
        summary.fuzzyCleared += 1;
      }
    }

    const mappingId = `map-${channelId}-${channelProduct.channelProductId}`;
    const now = new Date().toISOString();

    const mapping = {
      id: existing?.id || mappingId,
      channelId,
      channelProductId: channelProduct.channelProductId,
      channelBarcode: channelProduct.channelBarcode,
      masterProductId: finalProposal.masterProductId,
      status: finalProposal.status,
      matchMethod,
      confidenceScore: finalProposal.confidenceScore,
      reasons: finalProposal.reasons,
      updatedAt: now,
      confirmedAt: finalProposal.status === MAPPING_STATUS.AUTO_MATCHED ? now : null,
      confirmedBy: finalProposal.status === MAPPING_STATUS.AUTO_MATCHED ? 'system' : null
    };

    if (existing) {
      Object.assign(existing, mapping);
    } else {
      pm.mappings.push(mapping);
      existingByChannelProduct.set(channelProduct.channelProductId, mapping);
    }

    if (finalProposal.status === MAPPING_STATUS.AUTO_MATCHED) summary.autoMatched += 1;
    else if (finalProposal.status === MAPPING_STATUS.PENDING) {
      summary.pending += 1;
      if (matchMethod === MATCH_METHOD.AUTO_FUZZY) summary.fuzzyProposed += 1;
    }
    else if (finalProposal.status === MAPPING_STATUS.REVIEW_REQUIRED) summary.reviewRequired += 1;
    else if (finalProposal.status === MAPPING_STATUS.MISSING_MASTER) summary.missingMaster += 1;
    else if (finalProposal.status === MAPPING_STATUS.BARCODE_CONFLICT) {
      summary.barcodeConflict += 1;
      pm.conflicts.push({
        id: `conf-${channelId}-${channelProduct.channelProductId}`,
        channelId,
        channelProductId: channelProduct.channelProductId,
        channelBarcode: channelProduct.channelBarcode,
        reason: finalProposal.reasons.join(', '),
        candidates: finalProposal.candidates,
        detectedAt: now
      });
      summary.conflictsAdded += 1;
    }
  }

  return summary;
}

/** Sessiz barkod eşleştirme — yalnızca tek barkod eşleşmesi; fuzzy/pending/review oluşturmaz. */
export function runBarcodeOnlyAutoMatchForChannel(db, channelId = 'uber-eats') {
  const pm = ensureProductMatching(db);
  const channelProducts = pm.channelProducts.filter((cp) => cp.channelId === channelId);
  const masterProducts = pm.masterProducts || [];

  const existingByChannelProduct = new Map(
    pm.mappings
      .filter((m) => m.channelId === channelId)
      .map((m) => [m.channelProductId, m])
  );

  const summary = {
    channelId,
    scanned: channelProducts.length,
    linked: 0,
    skippedManual: 0,
    noExactBarcode: 0
  };

  const now = new Date().toISOString();

  for (const channelProduct of channelProducts) {
    const existing = existingByChannelProduct.get(channelProduct.channelProductId);
    if (existing?.status === MAPPING_STATUS.MANUAL_CONFIRMED) {
      summary.skippedManual += 1;
      continue;
    }

    const proposal = proposeMatchForChannelProduct(channelProduct, masterProducts);
    if (proposal.status !== MAPPING_STATUS.AUTO_MATCHED || !proposal.masterProductId) {
      summary.noExactBarcode += 1;
      continue;
    }

    const mappingId = `map-${channelId}-${channelProduct.channelProductId}`;
    const mapping = {
      id: existing?.id || mappingId,
      channelId,
      channelProductId: channelProduct.channelProductId,
      channelBarcode: channelProduct.channelBarcode,
      masterProductId: proposal.masterProductId,
      status: MAPPING_STATUS.AUTO_MATCHED,
      matchMethod: MATCH_METHOD.AUTO_BARCODE,
      confidenceScore: proposal.confidenceScore,
      reasons: proposal.reasons,
      updatedAt: now,
      confirmedAt: now,
      confirmedBy: 'barcode_link'
    };

    if (existing) {
      Object.assign(existing, mapping);
    } else {
      pm.mappings.push(mapping);
      existingByChannelProduct.set(channelProduct.channelProductId, mapping);
    }
    summary.linked += 1;
  }

  return summary;
}
