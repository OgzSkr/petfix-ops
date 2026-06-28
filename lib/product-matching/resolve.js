import { MAPPING_STATUS, PRODUCT_MATCHING_MODES } from './mapping-types.js';
import { normalizeBarcode, nameSimilarityScore } from './normalize.js';
import {
  findChannelProductForLine,
  findMappingForChannelLine,
  resolveMappingForChannelLine,
  buildChannelLookupIndexes
} from './lookup.js';
import { resolveOrderLineLookupKeys } from './sale-preview.js';

const CONFIRMED_STATUSES = new Set([
  MAPPING_STATUS.AUTO_MATCHED,
  MAPPING_STATUS.MANUAL_CONFIRMED
]);

const MAPPING_NAME_MATCH_THRESHOLD = 35;

function channelMasterNameCompatible(channelProduct, master) {
  const channelName = String(channelProduct?.channelName || '').trim();
  const masterName = String(master?.name || '').trim();
  if (!channelName || !masterName) return true;
  return nameSimilarityScore(channelName, masterName) >= MAPPING_NAME_MATCH_THRESHOLD;
}

export function normalizeMatchingMode(mode) {
  const value = String(mode || 'legacy').toLowerCase();
  return PRODUCT_MATCHING_MODES.includes(value) ? value : 'legacy';
}

/** Kanal bazlı override: PRODUCT_MATCHING_MODE_UBER_EATS vb. */
export function resolveMatchingModeForChannel(globalMode, channelId, modeByChannel = {}) {
  const channelMode = channelId ? modeByChannel[channelId] : '';
  if (channelMode) return normalizeMatchingMode(channelMode);
  return normalizeMatchingMode(globalMode);
}

/**
 * Kanal sipariş satırı → maliyet/satış barkodu + ana ürün.
 * legacy: kanal barkodu | hybrid: eşleşme varsa ana ürün, yoksa barkod | strict: yalnızca onaylı eşleşme
 */
export function resolveChannelLine(db, { channelId, channelBarcode, mode = 'legacy', indexes = null }) {
  const normalizedMode = normalizeMatchingMode(mode);
  const channelCode = normalizeBarcode(channelBarcode);

  if (!channelCode || normalizedMode === 'legacy') {
    return {
      mode: normalizedMode,
      source: 'legacy',
      channelBarcode: channelCode,
      costBarcode: channelCode,
      saleBarcode: channelCode,
      master: null,
      mapping: null,
      mappingStatus: 'legacy',
      includeInSale: Boolean(channelCode)
    };
  }

  const mapped = resolveMappingForChannelLine(db, channelId, channelCode, { indexes });
  const mappingRecord = findMappingForChannelLine(db, channelId, channelCode, indexes);
  const channelProduct = findChannelProductForLine(db, channelId, channelCode, indexes);
  const channelProductName = String(channelProduct?.channelName || '').trim();
  const hasConfirmed = mapped && CONFIRMED_STATUSES.has(mapped.mapping.status);
  const namesCompatible = hasConfirmed
    ? channelMasterNameCompatible(channelProduct, mapped.master)
    : true;

  if (hasConfirmed && namesCompatible) {
    const masterBarcode = normalizeBarcode(mapped.master.benimposBarcode);
    return {
      mode: normalizedMode,
      source: 'mapping',
      channelBarcode: channelCode,
      costBarcode: masterBarcode || channelCode,
      saleBarcode: masterBarcode || channelCode,
      master: mapped.master,
      mapping: mapped.mapping,
      mappingStatus: mapped.mapping.status,
      channelProductName,
      includeInSale: Boolean(masterBarcode || channelCode)
    };
  }

  if (hasConfirmed && !namesCompatible) {
    return {
      mode: normalizedMode,
      source: 'legacy_fallback',
      channelBarcode: channelCode,
      costBarcode: channelCode,
      saleBarcode: channelCode,
      master: mapped.master,
      mapping: mapped.mapping,
      mappingStatus: 'review_required',
      channelProductName,
      includeInSale: Boolean(channelCode),
      skipReason: 'eslestirme_isim_uyusmazligi'
    };
  }

  if (normalizedMode === 'strict') {
    return {
      mode: normalizedMode,
      source: 'unmapped',
      channelBarcode: channelCode,
      costBarcode: channelCode,
      saleBarcode: channelCode,
      master: null,
      mapping: mappingRecord || null,
      mappingStatus: mappingRecord?.status || 'unmapped',
      includeInSale: false,
      skipReason: 'onayli_eslestirme_yok'
    };
  }

  return {
    mode: normalizedMode,
    source: 'legacy_fallback',
    channelBarcode: channelCode,
    costBarcode: channelCode,
    saleBarcode: channelCode,
    master: null,
    mapping: mappingRecord || null,
    mappingStatus: mappingRecord?.status || 'unmapped',
    includeInSale: Boolean(channelCode)
  };
}

export function createChannelLineResolver(db, channelId, mode) {
  const indexes = buildChannelLookupIndexes(db, channelId);
  return (channelBarcode) => resolveChannelLine(db, { channelId, channelBarcode, mode, indexes });
}

const ORDER_RESOLUTION_SCORE = {
  mapping: 100,
  manual_confirmed: 95,
  auto_matched: 90,
  review_required: 55,
  pending: 50,
  barcode_conflict: 45,
  missing_master: 40,
  legacy_fallback: 25,
  unmapped: 15,
  legacy: 0
};

function scoreOrderLineResolution(resolved) {
  if (!resolved) return -1;
  if (resolved.source === 'mapping') return ORDER_RESOLUTION_SCORE.mapping;
  const status = String(resolved.mappingStatus || 'legacy');
  if (resolved.source === 'unmapped') {
    return ORDER_RESOLUTION_SCORE.unmapped;
  }
  return ORDER_RESOLUTION_SCORE[status] ?? 10;
}

/**
 * Sipariş satırı — barkod, stok kodu ve kanal SKU ile eşleştirme arar.
 * Yalnızca barkod kullanımı onaylı eşleşmeleri kaçırır (TGO seller SKU vb.).
 */
export function resolveChannelLineForOrder(db, { channelId, mode = 'hybrid', rawLine = {}, indexes = null } = {}) {
  const keys = resolveOrderLineLookupKeys(rawLine);
  if (!keys.length) {
    return resolveChannelLine(db, { channelId, channelBarcode: '', mode, indexes });
  }

  let best = null;
  let bestScore = -1;
  for (const key of keys) {
    const resolved = resolveChannelLine(db, { channelId, channelBarcode: key, mode, indexes });
    const score = scoreOrderLineResolution(resolved);
    if (score > bestScore) {
      best = resolved;
      bestScore = score;
    }
    if (resolved.source === 'mapping') break;
  }

  return best;
}

export function createOrderLineResolver(db, channelId, mode) {
  const indexes = buildChannelLookupIndexes(db, channelId);
  return (rawLine) => resolveChannelLineForOrder(db, { channelId, mode, rawLine, indexes });
}

export function masterCostOverlay(master) {
  if (!master) return null;
  const buyingPrice = Number(master.buyingPrice);
  if (!Number.isFinite(buyingPrice) || buyingPrice <= 0) return null;
  return {
    unitCost: buyingPrice,
    desi: 0,
    extraCost: 0,
    packagingCost: 0,
    commissionRate: 0,
    costVatRate: 20
  };
}

export function resolveLineCostDetails(costByBarcode, resolved, { strictZeroCost = false } = {}) {
  const costBarcode = resolved?.costBarcode || resolved?.channelBarcode || '';

  if (strictZeroCost && resolved?.source === 'unmapped') {
    return {
      cost: {
        unitCost: 0,
        desi: 0,
        extraCost: 0,
        packagingCost: 0,
        commissionRate: 0,
        costVatRate: 20
      },
      costSource: 'unmapped',
      costBarcode,
      usedMasterOverlay: false
    };
  }

  let cost = costByBarcode[costBarcode] || {};
  let costSource = 'legacy_scope';
  let usedMasterOverlay = false;
  const mappingSource = resolved?.source || 'legacy';

  const channelProductName = String(resolved?.channelProductName || '').trim();
  const masterName = String(resolved?.master?.name || '').trim();
  const mappingNameMismatch = mappingSource === 'mapping'
    && channelProductName
    && masterName
    && nameSimilarityScore(channelProductName, masterName) < MAPPING_NAME_MATCH_THRESHOLD;

  if (mappingSource === 'mapping') {
    if (mappingNameMismatch) {
      cost = {
        unitCost: 0,
        desi: 0,
        extraCost: 0,
        packagingCost: 0,
        commissionRate: 0,
        costVatRate: 20
      };
      costSource = 'mapping_name_mismatch';
    } else if (resolved?.master) {
      const overlay = masterCostOverlay(resolved.master);
      if (overlay) {
        cost = { ...(costByBarcode[costBarcode] || {}), ...overlay };
        costSource = 'master_buying_price';
        usedMasterOverlay = true;
      } else if (cost.unitCost) {
        costSource = 'mapping_scope';
      } else {
        costSource = 'mapping_no_cost';
      }
    } else if (cost.unitCost) {
      costSource = 'mapping_scope';
    } else {
      costSource = 'mapping_no_cost';
    }
  } else if (mappingSource === 'legacy_fallback') {
    costSource = 'legacy_fallback';
  } else if (mappingSource === 'unmapped') {
    costSource = 'unmapped';
  } else if (!cost.unitCost && resolved?.master) {
    const overlay = masterCostOverlay(resolved.master);
    if (overlay) {
      cost = { ...cost, ...overlay };
      costSource = 'legacy_master';
      usedMasterOverlay = true;
    }
  }

  return { cost, costSource, costBarcode, usedMasterOverlay };
}

export function resolveLineCost(costByBarcode, resolved, options = {}) {
  return resolveLineCostDetails(costByBarcode, resolved, options).cost;
}

export function summarizeOrderLineMatching(rows = []) {
  const summary = {
    mappedLines: 0,
    unmappedLines: 0,
    fallbackLines: 0,
    legacyLines: 0,
    totalLines: 0
  };

  for (const row of rows) {
    for (const line of row.lines || []) {
      summary.totalLines += 1;
      const source = line.mappingSource || 'legacy';
      if (source === 'mapping') summary.mappedLines += 1;
      else if (source === 'unmapped') summary.unmappedLines += 1;
      else if (source === 'legacy_fallback') summary.fallbackLines += 1;
      else summary.legacyLines += 1;
    }
  }

  return summary;
}
