import { MAPPING_STATUS } from './mapping-types.js';
import { normalizeBarcode } from './normalize.js';
import { ensureProductMatching } from './schema.js';

const CONFIRMED_STATUSES = new Set([
  MAPPING_STATUS.AUTO_MATCHED,
  MAPPING_STATUS.MANUAL_CONFIRMED
]);

function indexKey(channelId, lineKey) {
  return `${channelId}|${String(lineKey || '').trim()}`;
}

/**
 * Sipariş analizi gibi yoğun lookup senaryoları için kanal indeksleri.
 */
export function buildChannelLookupIndexes(db, channelId) {
  const pm = ensureProductMatching(db);
  const mappingsByLineKey = new Map();
  const channelProductsByLineKey = new Map();

  for (const cp of pm.channelProducts) {
    if (cp.channelId !== channelId) continue;
    const extraCodes = Array.isArray(cp.channelBarcodes) ? cp.channelBarcodes : [];
    const keys = new Set([
      cp.channelProductId,
      cp.channelBarcode,
      normalizeBarcode(cp.channelBarcode),
      normalizeBarcode(cp.channelProductId),
      ...extraCodes,
      ...extraCodes.map(normalizeBarcode)
    ].filter(Boolean));

    for (const key of keys) {
      channelProductsByLineKey.set(indexKey(channelId, key), cp);
    }
  }

  for (const mapping of pm.mappings) {
    if (mapping.channelId !== channelId) continue;
    const keys = new Set([
      mapping.channelProductId,
      mapping.channelBarcode,
      normalizeBarcode(mapping.channelBarcode),
      normalizeBarcode(mapping.channelProductId)
    ].filter(Boolean));

    for (const key of keys) {
      mappingsByLineKey.set(indexKey(channelId, key), mapping);
    }
  }

  return { mappingsByLineKey, channelProductsByLineKey };
}

function lineKeysMatch(left, right) {
  const a = String(left || '').trim();
  const b = String(right || '').trim();
  if (!a || !b) return false;
  if (a === b) return true;
  const na = normalizeBarcode(a);
  const nb = normalizeBarcode(b);
  return Boolean(na && nb && na === nb);
}

/**
 * Sipariş satırı anahtarı (barkod veya kanal SKU) → kanal ürünü kaydı.
 */
export function findChannelProductForLine(db, channelId, lineKey, indexes = null) {
  const key = String(lineKey || '').trim();
  if (!key || !channelId) return null;

  if (indexes?.channelProductsByLineKey) {
    const hit = indexes.channelProductsByLineKey.get(indexKey(channelId, key))
      || indexes.channelProductsByLineKey.get(indexKey(channelId, normalizeBarcode(key)));
    if (hit) return hit;
  }

  const pm = ensureProductMatching(db);

  for (const cp of pm.channelProducts) {
    if (cp.channelId !== channelId) continue;
    if (cp.channelProductId === key) return cp;
    if (lineKeysMatch(cp.channelBarcode, key)) return cp;
    if (lineKeysMatch(cp.channelProductId, key)) return cp;
    if (Array.isArray(cp.channelBarcodes)
      && cp.channelBarcodes.some((code) => lineKeysMatch(code, key))) {
      return cp;
    }
  }

  return null;
}

/**
 * Sipariş satırı anahtarı → eşleştirme kaydı (durum fark etmez).
 * channelProductId ≠ barkod senaryolarını destekler (ör. kanal SKU'su).
 */
export function findMappingForChannelLine(db, channelId, lineKey, indexes = null) {
  const key = String(lineKey || '').trim();
  if (!key || !channelId) return null;

  if (indexes?.mappingsByLineKey) {
    const hit = indexes.mappingsByLineKey.get(indexKey(channelId, key))
      || indexes.mappingsByLineKey.get(indexKey(channelId, normalizeBarcode(key)));
    if (hit) return hit;
  }

  const channelProduct = findChannelProductForLine(db, channelId, key, indexes);
  const productId = channelProduct?.channelProductId || null;

  const pm = ensureProductMatching(db);
  for (const mapping of pm.mappings) {
    if (mapping.channelId !== channelId) continue;
    if (mapping.channelProductId === key) return mapping;
    if (productId && mapping.channelProductId === productId) return mapping;
    if (lineKeysMatch(mapping.channelBarcode, key)) return mapping;
    if (lineKeysMatch(mapping.channelProductId, key)) return mapping;
  }

  return null;
}

/**
 * Onaylı eşleştirme + ana ürün. confirmedOnly=false iken bekleyen eşleştirmeler de döner.
 */
export function resolveMappingForChannelLine(db, channelId, lineKey, options = {}) {
  const { confirmedOnly = true, indexes = null } = options;
  const mapping = findMappingForChannelLine(db, channelId, lineKey, indexes);
  if (!mapping?.masterProductId) return null;

  if (confirmedOnly && !CONFIRMED_STATUSES.has(mapping.status)) {
    return null;
  }

  const pm = ensureProductMatching(db);
  const master = pm.masterProducts.find((m) => m.id === mapping.masterProductId) || null;
  if (confirmedOnly && !master) return null;

  return { mapping, master };
}
