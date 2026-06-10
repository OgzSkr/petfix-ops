import { MAPPING_STATUS } from './mapping-types.js';

function masterHasNameIssue(row) {
  const name = String(row.name || '').trim();
  return !name || name === '.' || name.length <= 1;
}

function masterQualityFlags(row) {
  return {
    missingName: masterHasNameIssue(row),
    negativeStock: Number(row.stock) < 0,
    missingCost: Number(row.buyingPrice) <= 0,
    missingMeta: !row.normalizedWeightG || !row.variantKey
  };
}

function masterDataQualityIssueCodes(flags) {
  const issues = [];
  if (flags.missingName) issues.push('missing_name');
  if (flags.negativeStock) issues.push('negative_stock');
  if (flags.missingCost) issues.push('missing_cost');
  if (flags.missingMeta) issues.push('missing_meta');
  return issues;
}

export { masterQualityFlags, masterDataQualityIssueCodes };

export const MASTER_POOL_TABS = [
  'all',
  'matched',
  'pending',
  'missing_master',
  'data_issues',
  'passive'
];

export function mappingStatusesForMaster(db, masterProductId) {
  const pm = db.productMatching;
  if (!pm) return {};
  const result = {};
  for (const mapping of pm.mappings.filter((m) => m.masterProductId === masterProductId)) {
    result[mapping.channelId] = mapping.status;
  }
  return result;
}

export function masterNeedsAction(db, masterProductId) {
  const statuses = Object.values(mappingStatusesForMaster(db, masterProductId));
  return statuses.some((status) =>
    ['unmapped', 'pending', 'review_required', 'missing_master', 'barcode_conflict', 'auto_matched'].includes(status)
  );
}

export function masterIsFullyMatched(db, masterProductId) {
  const statuses = Object.values(mappingStatusesForMaster(db, masterProductId));
  return statuses.length > 0 && statuses.every((status) => status === 'manual_confirmed');
}

export function masterHasMissingMaster(db, masterProductId) {
  return Object.values(mappingStatusesForMaster(db, masterProductId)).includes('missing_master');
}

export function masterIsPassive(row) {
  return row.isOnline === false || Number(row.stock) <= 0;
}

export function computeMasterPoolTabCounts(db, products = []) {
  const counts = {
    all: products.length,
    matched: 0,
    pending: 0,
    missing_master: 0,
    data_issues: 0,
    passive: 0
  };

  for (const row of products) {
    if (masterIsFullyMatched(db, row.id)) counts.matched += 1;
    if (masterNeedsAction(db, row.id)) counts.pending += 1;
    if (masterHasMissingMaster(db, row.id)) counts.missing_master += 1;
    if (masterDataQualityIssueCodes(masterQualityFlags(row)).length > 0) counts.data_issues += 1;
    if (masterIsPassive(row)) counts.passive += 1;
  }

  return counts;
}

export function applyMasterPoolTab(list, tab, db) {
  const value = String(tab || 'all').trim();
  if (!value || value === 'all') return list;

  if (value === 'matched') {
    return list.filter((row) => masterIsFullyMatched(db, row.id));
  }
  if (value === 'pending') {
    return list.filter((row) => masterNeedsAction(db, row.id));
  }
  if (value === 'missing_master') {
    return list.filter((row) => masterHasMissingMaster(db, row.id));
  }
  if (value === 'data_issues') {
    return list.filter((row) => masterDataQualityIssueCodes(masterQualityFlags(row)).length > 0);
  }
  if (value === 'passive') {
    return list.filter((row) => masterIsPassive(row));
  }
  return list;
}

export function masterChannelCodeHaystack(db, masterProductId) {
  const pm = db.productMatching;
  if (!pm) return '';
  return pm.mappings
    .filter((m) => m.masterProductId === masterProductId)
    .map((m) => {
      const cp = pm.channelProducts.find(
        (row) => row.channelId === m.channelId && row.channelProductId === m.channelProductId
      );
      return [
        m.channelProductId,
        m.channelBarcode,
        cp?.channelBarcode,
        cp?.channelName,
        cp?.stockCode
      ].filter(Boolean).join(' ');
    })
    .join(' ')
    .toLowerCase();
}

export function applyMasterExtendedFilters(list, filters = {}, db) {
  let result = [...list];
  const category = String(filters.category || '').trim().toLowerCase();
  if (category) {
    result = result.filter((row) => String(row.categoryName || '').toLowerCase().includes(category));
  }

  const stockCode = String(filters.stockCode || '').trim().toLowerCase();
  if (stockCode) {
    result = result.filter((row) => String(row.stockCode || '').toLowerCase().includes(stockCode));
  }

  const channelCode = String(filters.channelCode || '').trim().toLowerCase();
  if (channelCode) {
    result = result.filter((row) => masterChannelCodeHaystack(db, row.id).includes(channelCode));
  }

  const dataQuality = String(filters.dataQuality || '').trim();
  if (dataQuality === 'clean') {
    result = result.filter((row) => masterDataQualityIssueCodes(masterQualityFlags(row)).length === 0);
  } else if (dataQuality === 'issues') {
    result = result.filter((row) => masterDataQualityIssueCodes(masterQualityFlags(row)).length > 0);
  }

  if (filters.negativeStock === '1') {
    result = result.filter((row) => Number(row.stock) < 0);
  }

  const variant = String(filters.variant || '').trim().toLowerCase();
  if (variant) {
    result = result.filter((row) => String(row.variantKey || '').toLowerCase().includes(variant));
  }

  const weightMin = Number(filters.weightMin);
  if (Number.isFinite(weightMin) && weightMin > 0) {
    result = result.filter((row) => Number(row.normalizedWeightG) >= weightMin);
  }

  const weightMax = Number(filters.weightMax);
  if (Number.isFinite(weightMax) && weightMax > 0) {
    result = result.filter((row) => Number(row.normalizedWeightG) <= weightMax);
  }

  const updatedSince = String(filters.updatedSince || '').trim();
  if (updatedSince) {
    result = result.filter((row) => String(row.syncedAt || '') >= updatedSince);
  }

  const mappingChannel = String(filters.mappingChannel || '').trim();
  const matchAggregate = String(filters.matchAggregate || '').trim();
  if (matchAggregate && mappingChannel) {
    result = result.filter((row) => {
      const status = mappingStatusesForMaster(db, row.id)[mappingChannel] || 'unmapped';
      if (matchAggregate === 'manual_confirmed') return status === 'manual_confirmed';
      if (matchAggregate === 'needs_action') {
        return ['unmapped', 'pending', 'review_required', 'missing_master', 'barcode_conflict', 'auto_matched'].includes(status);
      }
      if (matchAggregate === 'unmapped') return status === 'unmapped';
      return status === matchAggregate;
    });
  }

  return result;
}

export function summarizeMasterMatchAggregate(channelMappings = {}) {
  const statuses = Object.values(channelMappings);
  if (!statuses.length) {
    return { code: 'none', label: 'Kanal eşleşmesi yok' };
  }
  if (statuses.includes('missing_master')) {
    return { code: 'missing_master', label: 'BenimPOS\'ta yok' };
  }
  if (statuses.includes('barcode_conflict')) {
    return { code: 'multi_candidate', label: 'Birden fazla aday' };
  }
  const pending = statuses.filter((s) =>
    ['unmapped', 'pending', 'review_required', 'auto_matched'].includes(s)
  );
  if (pending.length === 0 && statuses.every((s) => s === 'manual_confirmed')) {
    return { code: 'all_matched', label: 'Tüm kanallarda eşleşmiş' };
  }
  if (pending.length > 0 && statuses.some((s) => s === 'manual_confirmed')) {
    return { code: 'partial', label: 'Kısmi eşleşmiş' };
  }
  if (pending.length > 0) {
    return { code: 'pending', label: 'Eşleşme bekliyor' };
  }
  return { code: 'other', label: 'İnceleme gerekli' };
}

/** Toplu havuz işlemleri için kanal eşleştirme kalemleri (saf fonksiyon, test edilebilir). */
export function buildMasterPoolBulkMappingItems(db, masterProductIds = [], options = {}) {
  const pm = db?.productMatching;
  if (!pm) return [];
  const capped = [...new Set(
    masterProductIds.map((id) => String(id || '').trim()).filter(Boolean)
  )].slice(0, 200);
  const mode = String(options.mode || 'confirm');
  const confirmStatuses = options.confirmStatuses || new Set([
    MAPPING_STATUS.AUTO_MATCHED,
    MAPPING_STATUS.PENDING,
    MAPPING_STATUS.REVIEW_REQUIRED
  ]);
  const items = [];
  for (const masterId of capped) {
    for (const mapping of pm.mappings) {
      if (mapping.masterProductId !== masterId) continue;
      if (mode === 'confirm' && !confirmStatuses.has(mapping.status)) continue;
      items.push({
        channelId: mapping.channelId,
        channelProductId: mapping.channelProductId,
        masterProductId: masterId
      });
    }
  }
  return items;
}

/** Ana ürünle ilişkili eşleştirme audit kayıtları (yeniden eskiye). */
export function listMasterMappingHistory(db, masterProductId, limit = 20) {
  const pm = db?.productMatching;
  if (!pm || !masterProductId) return [];
  const channelKeys = new Set(
    pm.mappings
      .filter((m) => m.masterProductId === masterProductId)
      .map((m) => `${m.channelId}|${m.channelProductId}`)
  );
  const cap = Math.min(50, Math.max(1, Number(limit) || 20));
  return (pm.mappingLogs || [])
    .filter((log) => {
      if (log.masterProductId === masterProductId) return true;
      if (log.channelId && log.channelProductId) {
        return channelKeys.has(`${log.channelId}|${log.channelProductId}`);
      }
      return false;
    })
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
    .slice(0, cap);
}
