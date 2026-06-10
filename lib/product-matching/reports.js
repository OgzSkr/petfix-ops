import { MAPPING_STATUS } from './constants.js';
import { normalizeBarcode, barcodesEquivalent } from './normalize.js';

const CONFIRMED = new Set([
  MAPPING_STATUS.AUTO_MATCHED,
  MAPPING_STATUS.MANUAL_CONFIRMED
]);

export function buildMatchingReports(db, channelId = 'uber-eats') {
  const pm = db.productMatching;
  const channelProducts = pm.channelProducts.filter((cp) => cp.channelId === channelId);
  const mappings = pm.mappings.filter((m) => m.channelId === channelId);

  const mappingByChannelProduct = new Map(
    mappings.map((m) => [m.channelProductId, m])
  );

  const mappedMasterIds = new Set(
    mappings.filter((m) => CONFIRMED.has(m.status) && m.masterProductId).map((m) => m.masterProductId)
  );

  let notInCatalog = 0;
  let inCatalogUnmapped = 0;

  const missingOnChannel = pm.masterProducts
    .filter((m) => Number(m.stock) > 0 && !mappedMasterIds.has(m.id))
    .map((m) => {
      const channelHit = channelProducts.find((cp) =>
        barcodesEquivalent(cp.channelBarcode, m.benimposBarcode)
      );
      const catalogState = channelHit ? 'in_catalog' : 'not_in_catalog';
      if (catalogState === 'not_in_catalog') notInCatalog += 1;
      else inCatalogUnmapped += 1;

      return {
        masterProductId: m.id,
        benimposBarcode: m.benimposBarcode,
        name: m.name,
        stock: m.stock,
        buyingPrice: m.buyingPrice,
        salePrice1: m.salePrice1,
        catalogState,
        channelProductId: channelHit?.channelProductId || null,
        channelName: channelHit?.channelName || null,
        channelPrice: channelHit ? (Number(channelHit.lastUnitPrice) || Number(channelHit.channelPrice) || null) : null
      };
    })
    .sort((a, b) => Number(b.stock) - Number(a.stock));

  const extraOnChannel = channelProducts
    .filter((cp) => {
      const mapping = mappingByChannelProduct.get(cp.channelProductId);
      return !mapping
        || mapping.status === MAPPING_STATUS.MISSING_MASTER
        || !CONFIRMED.has(mapping.status);
    })
    .map((cp) => {
      const mapping = mappingByChannelProduct.get(cp.channelProductId);
      return {
        ...cp,
        mappingStatus: mapping?.status || 'unmapped',
        suggestedMasterProductId: cp.suggestedMasterProductId || mapping?.masterProductId || null
      };
    })
    .sort((a, b) => String(a.channelName || '').localeCompare(String(b.channelName || ''), 'tr-TR'));

  const barcodeGroups = new Map();
  for (const cp of channelProducts) {
    const code = normalizeBarcode(cp.channelBarcode);
    if (!code) continue;
    if (!barcodeGroups.has(code)) barcodeGroups.set(code, []);
    barcodeGroups.get(code).push(cp);
  }

  const barcodeDuplicates = [...barcodeGroups.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([barcode, items]) => ({ barcode, count: items.length, items }));

  const masterBarcodeDupes = new Map();
  for (const m of pm.masterProducts) {
    const code = normalizeBarcode(m.benimposBarcode);
    if (!code) continue;
    if (!masterBarcodeDupes.has(code)) masterBarcodeDupes.set(code, []);
    masterBarcodeDupes.get(code).push(m);
  }

  const masterBarcodeConflicts = [...masterBarcodeDupes.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([barcode, items]) => ({ barcode, count: items.length, items: items.map((i) => ({ id: i.id, name: i.name })) }));

  return {
    channelId,
    missingOnChannel: {
      total: missingOnChannel.length,
      breakdown: { notInCatalog, inCatalogUnmapped },
      rows: missingOnChannel.slice(0, 500)
    },
    extraOnChannel: {
      total: extraOnChannel.length,
      rows: extraOnChannel.slice(0, 500)
    },
    conflicts: {
      total: (pm.conflicts || []).filter((c) => c.channelId === channelId).length,
      rows: (pm.conflicts || []).filter((c) => c.channelId === channelId).slice(0, 200),
      masterBarcodeConflicts,
      channelBarcodeDuplicates: barcodeDuplicates
    }
  };
}
