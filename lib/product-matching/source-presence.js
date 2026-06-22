import { normalizeBarcode } from './normalize.js';
import { MAPPING_STATUS } from './constants.js';

export function isCatalogIngestSource(ingestSource) {
  const source = String(ingestSource || '').toLowerCase();
  return source.includes('catalog');
}

/** Katalogdan düşen kanal ürünü eşleştirme kuyruğunda gösterilmez. */
export function shouldHideAbsentCatalogChannelProduct(channelProduct) {
  if (!channelProduct?.absentFromCatalogSince) return false;
  return isCatalogIngestSource(channelProduct.ingestSource);
}

/**
 * Katalog sync sonrası Getir/TGO vb. artık olmayan kanal ürünlerini havuzdan temizler.
 * Manuel onaylı eşleştirmeler korunur (geçmiş sipariş / fiyat referansı).
 */
export function pruneAbsentCatalogChannelProducts(pm, channelId, options = {}) {
  const id = String(channelId || '').trim();
  if (!id) return { removedProducts: 0, removedMappings: 0, productIds: [] };

  const keepManualConfirmed = options.keepManualConfirmed !== false;
  const confirmedIds = new Set(
    pm.mappings
      .filter((m) => m.channelId === id && m.status === MAPPING_STATUS.MANUAL_CONFIRMED)
      .map((m) => m.channelProductId)
  );

  const removedProductIds = [];

  for (let i = pm.channelProducts.length - 1; i >= 0; i -= 1) {
    const cp = pm.channelProducts[i];
    if (cp.channelId !== id) continue;
    if (!cp.absentFromCatalogSince) continue;
    if (!isCatalogIngestSource(cp.ingestSource)) continue;
    if (keepManualConfirmed && confirmedIds.has(cp.channelProductId)) continue;
    removedProductIds.push(cp.channelProductId);
    pm.channelProducts.splice(i, 1);
  }

  let removedMappings = 0;
  if (removedProductIds.length) {
    const removeSet = new Set(removedProductIds);
    const before = pm.mappings.length;
    pm.mappings = pm.mappings.filter(
      (m) => !(m.channelId === id && removeSet.has(m.channelProductId))
    );
    removedMappings = before - pm.mappings.length;
    if (Array.isArray(pm.conflicts)) {
      pm.conflicts = pm.conflicts.filter(
        (c) => !(c.channelId === id && removeSet.has(c.channelProductId))
      );
    }
  }

  return {
    removedProducts: removedProductIds.length,
    removedMappings,
    productIds: removedProductIds
  };
}

/** Sync sonrası BenimPOS / kanal katalog varlığını işaretler (kayıt silmez). */
export function markMasterPresenceAfterSync(pm, incomingMasters = [], syncedAt) {
  const now = syncedAt || new Date().toISOString();
  const seenBarcodes = new Set(
    incomingMasters
      .map((row) => normalizeBarcode(row.benimposBarcode))
      .filter(Boolean)
  );
  const seenIds = new Set(incomingMasters.map((row) => String(row.id || '').trim()).filter(Boolean));

  for (const master of pm.masterProducts) {
    const barcode = normalizeBarcode(master.benimposBarcode);
    const present = (barcode && seenBarcodes.has(barcode)) || seenIds.has(master.id);
    if (present) {
      delete master.absentFromBenimposSince;
      master.lastSeenInBenimposAt = now;
      continue;
    }
    if (master.lastSeenInBenimposAt || master.syncedAt) {
      master.absentFromBenimposSince = master.absentFromBenimposSince || now;
    }
  }

  pm.meta.masterPresenceSyncAt = now;
  pm.meta.masterSeenCount = seenBarcodes.size;
}

export function markChannelCatalogPresence(pm, channelId, seenProductIds = [], syncedAt, options = {}) {
  const id = String(channelId || '').trim();
  if (!id) return;

  const markAbsent = options.markAbsent !== false;
  const now = syncedAt || new Date().toISOString();
  const seen = new Set(seenProductIds.map((value) => String(value || '').trim()).filter(Boolean));

  for (const cp of pm.channelProducts) {
    if (cp.channelId !== id) continue;
    const productId = String(cp.channelProductId || '').trim();
    if (seen.has(productId)) {
      delete cp.absentFromCatalogSince;
      cp.lastSeenInCatalogAt = now;
      continue;
    }
    if (markAbsent && isCatalogIngestSource(cp.ingestSource) && (cp.lastSeenInCatalogAt || cp.ingestedAt)) {
      cp.absentFromCatalogSince = cp.absentFromCatalogSince || now;
    }
  }

  pm.meta.channelIngest = pm.meta.channelIngest || {};
  const metaKey = channelCatalogMetaKey(id);
  pm.meta.channelIngest[metaKey] = {
    ...(pm.meta.channelIngest[metaKey] || {}),
    lastPresenceSyncAt: now,
    seenCount: seen.size
  };
}

export function channelCatalogMetaKey(channelId) {
  if (channelId === 'uber-eats') return 'uber-eats-catalog';
  if (channelId === 'yemeksepeti') return 'yemeksepeti';
  if (channelId === 'getir') return 'getir-catalog';
  return String(channelId || '');
}
