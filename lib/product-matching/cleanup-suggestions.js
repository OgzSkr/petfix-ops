import { getChannel } from '../channels/registry.js';
import { ensureProductMatching } from './schema.js';

const CHANNEL_LABELS = {
  getir: 'Getir',
  'uber-eats': 'Uber Eats',
  yemeksepeti: 'Yemeksepeti'
};

export function cleanupSuggestionId(channelId, channelProductId) {
  return `${String(channelId || '').trim()}::${String(channelProductId || '').trim()}`;
}

function channelLabel(channelId) {
  return CHANNEL_LABELS[channelId]
    || getChannel(channelId)?.label
    || channelId
    || 'Kanal';
}

function buildMessage({ masterName, channelName, channelId, reasons }) {
  const label = channelLabel(channelId);
  const name = masterName || channelName || 'Ürün';
  const hasMaster = reasons.includes('master_absent');
  const hasChannel = reasons.includes('channel_absent');

  if (hasMaster && hasChannel) {
    return `${name} — BenimPOS ve ${label} kataloğunda artık yok. Eşleştirmeyi kaldırın.`;
  }
  if (hasMaster) {
    return `${name} — BenimPOS'ta artık yok; ${label} eşleştirmesi duruyor. Kaldırın.`;
  }
  if (hasChannel) {
    return `${name} — ${label} kataloğunda artık yok; eşleştirme duruyor. Kaldırın.`;
  }
  return `${name} — geçersiz eşleştirme. Kaldırın.`;
}

/**
 * Silinen / kaynaktan düşen ürünler için eşleştirme temizlik önerileri.
 */
export function buildCleanupSuggestions(db, options = {}) {
  const pm = ensureProductMatching(db);
  const channelFilter = String(options.channelId || '').trim();
  const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 200);
  const dismissed = new Set(
    Array.isArray(pm.meta.dismissedCleanupSuggestions)
      ? pm.meta.dismissedCleanupSuggestions.map(String)
      : []
  );

  const mastersById = new Map(pm.masterProducts.map((row) => [row.id, row]));
  const channelProductsByKey = new Map(
    pm.channelProducts.map((row) => [`${row.channelId}::${row.channelProductId}`, row])
  );

  const items = [];

  for (const mapping of pm.mappings) {
    if (channelFilter && mapping.channelId !== channelFilter) continue;

    const master = mastersById.get(mapping.masterProductId);
    const cp = channelProductsByKey.get(`${mapping.channelId}::${mapping.channelProductId}`);
    const reasons = [];

    if (master?.absentFromBenimposSince) reasons.push('master_absent');
    if (cp?.absentFromCatalogSince) reasons.push('channel_absent');
    if (!reasons.length) continue;

    const id = cleanupSuggestionId(mapping.channelId, mapping.channelProductId);
    if (dismissed.has(id)) continue;

    items.push({
      id,
      channelId: mapping.channelId,
      channelLabel: channelLabel(mapping.channelId),
      channelProductId: mapping.channelProductId,
      masterProductId: mapping.masterProductId || null,
      benimposBarcode: master?.benimposBarcode || mapping.channelBarcode || cp?.channelBarcode || null,
      masterName: master?.name || null,
      channelName: cp?.channelName || null,
      mappingStatus: mapping.status || null,
      reasons,
      masterAbsentSince: master?.absentFromBenimposSince || null,
      channelAbsentSince: cp?.absentFromCatalogSince || null,
      message: buildMessage({
        masterName: master?.name,
        channelName: cp?.channelName,
        channelId: mapping.channelId,
        reasons
      })
    });
  }

  items.sort((a, b) => {
    const score = (row) => (row.reasons.includes('master_absent') ? 2 : 0)
      + (row.reasons.includes('channel_absent') ? 1 : 0);
    return score(b) - score(a);
  });

  const sliced = items.slice(0, limit);

  return {
    ok: true,
    updatedAt: new Date().toISOString(),
    total: items.length,
    items: sliced,
    hasMore: items.length > sliced.length,
    meta: {
      masterPresenceSyncAt: pm.meta.masterPresenceSyncAt || null,
      dismissedCount: dismissed.size
    }
  };
}

export function dismissCleanupSuggestions(pm, suggestionIds = []) {
  const ids = [...new Set(suggestionIds.map((value) => String(value || '').trim()).filter(Boolean))];
  if (!ids.length) return { dismissed: 0 };

  pm.meta.dismissedCleanupSuggestions = pm.meta.dismissedCleanupSuggestions || [];
  const existing = new Set(pm.meta.dismissedCleanupSuggestions.map(String));
  let added = 0;

  for (const id of ids) {
    if (existing.has(id)) continue;
    existing.add(id);
    added += 1;
  }

  pm.meta.dismissedCleanupSuggestions = [...existing].slice(-500);
  return { dismissed: added };
}
