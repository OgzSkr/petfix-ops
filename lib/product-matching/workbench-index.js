/** Önceden hesaplanmış Gelen Kutusu kuyruk indeksi (action queue). */

export const WORKBENCH_INDEX_VERSION = 1;
export const WORKBENCH_INDEX_META_KEY = 'workbenchIndexAction';

export function workbenchDataFingerprint(pm) {
  const meta = pm.meta || {};
  return [
    pm.channelProducts.length,
    pm.mappings.length,
    pm.masterProducts.length,
    meta.masterSyncedAt || ''
  ].join(':');
}

export function getStoredWorkbenchIndex(pm) {
  return pm.meta?.[WORKBENCH_INDEX_META_KEY] || null;
}

export function saveWorkbenchIndex(pm, index) {
  pm.meta = pm.meta || {};
  pm.meta[WORKBENCH_INDEX_META_KEY] = index;
}

export function clearWorkbenchIndex(pm) {
  if (!pm.meta) return;
  delete pm.meta[WORKBENCH_INDEX_META_KEY];
}

export function isWorkbenchIndexFresh(pm, index, { queue = 'action' } = {}) {
  if (!index || index.version !== WORKBENCH_INDEX_VERSION) return false;
  if (index.queue !== queue) return false;
  return index.fingerprint === workbenchDataFingerprint(pm);
}

export function buildIndexFromLiteResult(lite, fingerprint, queue = 'action') {
  return {
    version: WORKBENCH_INDEX_VERSION,
    queue,
    builtAt: new Date().toISOString(),
    fingerprint,
    entries: lite.candidates.map(({ cp }) => ({
      channelId: cp.channelId,
      channelProductId: cp.channelProductId,
      mappingStatus: cp.mappingStatus || 'unmapped',
      searchHay: [
        cp.channelName,
        cp.channelBarcode,
        cp.channelProductId,
        cp.masterProductName
      ].join(' ').toLowerCase()
    })),
    channelCounts: lite.channelCounts,
    safeConfirmable: lite.safeConfirmable,
    unmatchedChannelProducts: lite.unmatchedChannelProducts,
    multiCandidate: lite.multiCandidate,
    total: lite.candidates.length
  };
}

export function filterIndexEntries(index, { channelFilter = '', q = '', statusFilter = '' } = {}) {
  let entries = index.entries || [];
  if (channelFilter) {
    entries = entries.filter((entry) => entry.channelId === channelFilter);
  }
  if (statusFilter) {
    entries = entries.filter((entry) => entry.mappingStatus === statusFilter);
  }
  if (q) {
    const needle = q.toLowerCase();
    entries = entries.filter((entry) => entry.searchHay.includes(needle));
  }
  return entries;
}

export function summarizeFilteredEntries(entries) {
  const channelCounts = {};
  for (const entry of entries) {
    channelCounts[entry.channelId] = (channelCounts[entry.channelId] || 0) + 1;
  }
  return { channelCounts, total: entries.length };
}
