import { appendMappingLog } from './store.js';
import { buildCleanupSuggestions } from './cleanup-suggestions.js';

/**
 * BenimPOS'tan düşmüş ve eşleştirmesi kalmamış master ürünleri kaldırır.
 */
export function pruneAbsentMasterProducts(pm) {
  const removedIds = [];

  for (let i = pm.masterProducts.length - 1; i >= 0; i -= 1) {
    const master = pm.masterProducts[i];
    if (!master?.absentFromBenimposSince) continue;

    const hasMapping = pm.mappings.some((m) => m.masterProductId === master.id);
    if (hasMapping) continue;

    removedIds.push(master.id);
    pm.masterProducts.splice(i, 1);
  }

  return {
    removedProducts: removedIds.length,
    productIds: removedIds
  };
}

/**
 * Kaynaktan düşen ürünler için bekleyen eşleştirme temizlik önerilerini otomatik uygular.
 */
export function autoApplyAllCleanupSuggestions(db, pm, options = {}) {
  const channelFilter = String(options.channelId || '').trim();
  const report = buildCleanupSuggestions(db, {
    limit: Math.min(Math.max(Number(options.limit) || 500, 1), 500),
    channelId: channelFilter
  });

  let removed = 0;

  for (const item of report.items) {
    const idx = pm.mappings.findIndex(
      (mapping) => mapping.channelId === item.channelId
        && mapping.channelProductId === item.channelProductId
    );
    if (idx === -1) continue;

    const removedMapping = pm.mappings.splice(idx, 1)[0];
    appendMappingLog(db, {
      action: 'remove_mapping',
      channelId: item.channelId,
      channelProductId: item.channelProductId,
      masterProductId: removedMapping.masterProductId,
      source: 'auto_cleanup'
    });
    removed += 1;
  }

  const masterPruned = pruneAbsentMasterProducts(pm);

  return {
    removedMappings: removed,
    prunedMasters: masterPruned.removedProducts,
    remainingSuggestions: Math.max(0, report.total - removed)
  };
}
