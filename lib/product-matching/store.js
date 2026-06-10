import { ensureProductMatching } from './schema.js';
import { normalizeBarcode, findMasterByBarcodeKeys } from './normalize.js';

export function getProductMatching(db) {
  return ensureProductMatching(db);
}

/** Kalıcı audit tablosuna geçiş için standart alanlar (product_mapping_events). */
export const MAPPING_AUDIT_EVENT_FIELDS = [
  'action',
  'actor',
  'before',
  'after',
  'channelId',
  'channelProductId',
  'masterProductId',
  'requestId'
];

export function normalizeMappingAuditEvent(entry = {}) {
  const normalized = {
    action: entry.action ?? entry.type ?? 'unknown',
    actor: entry.actor ?? entry.user ?? 'system',
    before: entry.before ?? entry.previous ?? null,
    after: entry.after ?? entry.next ?? null,
    channelId: entry.channelId ?? null,
    channelProductId: entry.channelProductId ?? null,
    masterProductId: entry.masterProductId ?? null,
    requestId: entry.requestId ?? null
  };
  return { ...entry, ...normalized };
}

export function appendMappingLog(db, entry) {
  const pm = getProductMatching(db);
  pm.mappingLogs.unshift({
    id: `ml-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    ...normalizeMappingAuditEvent(entry)
  });
  if (pm.mappingLogs.length > 500) {
    pm.mappingLogs.length = 500;
  }
}

export function appendOrderMappingLog(db, entry) {
  const pm = getProductMatching(db);
  pm.orderMappingLogs.unshift({
    id: `oml-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    ...entry
  });
  if (pm.orderMappingLogs.length > 500) {
    pm.orderMappingLogs.length = 500;
  }
}

export function findMasterByBarcode(db, barcode) {
  const pm = getProductMatching(db);
  const result = findMasterByBarcodeKeys(pm.masterProducts, barcode);
  if (!result || result.conflict) return null;
  return result.master;
}

export function mappingIndexByChannelProduct(db) {
  const pm = getProductMatching(db);
  const map = new Map();
  for (const row of pm.mappings) {
    if (!row.channelId || !row.channelProductId) continue;
    map.set(`${row.channelId}|${row.channelProductId}`, row);
  }
  return map;
}

export function countMappingsByChannel(db, channelId) {
  const pm = getProductMatching(db);
  const rows = pm.mappings.filter((m) => m.channelId === channelId);
  const byStatus = {};
  for (const row of rows) {
    byStatus[row.status] = (byStatus[row.status] || 0) + 1;
  }
  return { total: rows.length, byStatus };
}
