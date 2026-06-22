import { MAPPING_STATUS } from './mapping-types.js';
import { ensureProductMatching } from './schema.js';
import { countMappingsByChannel } from './store.js';
import { listActiveHzlMrktOpsMatchingSalesChannels, channelHasFeature, getChannel } from '../channels/registry.js';
import { HZLMRKTOPS_PRODUCTS } from '../hzlmrktops/constants.js';
import { buildProductPoolUrl } from './pool-url.js';
import { buildChannelSalesReadiness, resolveBenimposSaleConfirmLevel } from './sales-readiness.js';
import { resolveMatchingModeForChannel } from './resolve.js';

/** Gelen Kutusu action kuyruğu ile aynı durumlar (lib/platform/services/product-matching.js). */
const ACTION_QUEUE_STATUSES = new Set([
  'unmapped',
  MAPPING_STATUS.AUTO_MATCHED,
  MAPPING_STATUS.PENDING,
  MAPPING_STATUS.REVIEW_REQUIRED,
  MAPPING_STATUS.BARCODE_CONFLICT,
  MAPPING_STATUS.MISSING_MASTER
]);

const NEEDS_REVIEW_STATUSES = new Set([
  MAPPING_STATUS.PENDING,
  MAPPING_STATUS.REVIEW_REQUIRED,
  MAPPING_STATUS.BARCODE_CONFLICT
]);

function countChannelActionQueue(db, channelId) {
  const pm = ensureProductMatching(db);
  const mappingByCp = new Map(
    pm.mappings
      .filter((m) => m.channelId === channelId)
      .map((m) => [m.channelProductId, m])
  );

  const counts = {
    productCount: 0,
    manualConfirmed: 0,
    unmapped: 0,
    missingMaster: 0,
    needsReview: 0,
    autoPendingConfirm: 0,
    queueTotal: 0
  };

  for (const cp of pm.channelProducts) {
    if (cp.channelId !== channelId) continue;
    counts.productCount += 1;

    const status = mappingByCp.get(cp.channelProductId)?.status || 'unmapped';
    if (status === MAPPING_STATUS.MANUAL_CONFIRMED) {
      counts.manualConfirmed += 1;
      continue;
    }
    if (!ACTION_QUEUE_STATUSES.has(status)) continue;

    if (status === 'unmapped') counts.unmapped += 1;
    else if (status === MAPPING_STATUS.MISSING_MASTER) counts.missingMaster += 1;
    else if (NEEDS_REVIEW_STATUSES.has(status)) counts.needsReview += 1;
    else if (status === MAPPING_STATUS.AUTO_MATCHED) counts.autoPendingConfirm += 1;

    counts.queueTotal += 1;
  }

  return counts;
}

function poolTabForChannel(channelId) {
  if (channelId === 'uber-eats') return 'uber-eats';
  return channelId;
}

function poolHref(channelId, params = {}) {
  const search = new URLSearchParams({ tab: poolTabForChannel(channelId), ...params });
  return `${HZLMRKTOPS_PRODUCTS}?${search.toString()}`;
}

/**
 * Gelen Kutusu deep-link — kuyruktaki baskın engel türüne göre en uygun filtreyi seçer.
 */
export function resolveInboxHref(row = {}) {
  const channelId = String(row.channelId || '').trim();
  const pool = row.hrefPool || poolHref(channelId);
  const queueTotal = Number(row.queueTotal) || 0;
  if (!channelId || queueTotal <= 0) {
    return pool;
  }

  const base = HZLMRKTOPS_PRODUCTS;
  const missingMaster = Number(row.missingMaster) || 0;
  const needsReview = Number(row.needsReview) || 0;
  const autoPending = Number(row.autoPendingConfirm) || 0;

  if (missingMaster > 0 && missingMaster >= needsReview && missingMaster >= autoPending) {
    return base;
  }
  if (needsReview > 0 && needsReview >= autoPending) {
    return base;
  }
  if (autoPending > 0) {
    return base;
  }
  return base;
}

export function channelReadyPercent(row = {}) {
  const total = Number(row.productCount) || 0;
  const confirmed = Number(row.manualConfirmed) || 0;
  if (total <= 0) return 0;
  return Math.min(100, Math.round((confirmed / total) * 100));
}

function catalogIngestTime(pm, channelId) {
  if (channelId === 'uber-eats') {
    return pm.meta.channelIngest?.['uber-eats-catalog']?.ingestedAt || null;
  }
  if (channelId === 'yemeksepeti') {
    return pm.meta.channelIngest?.yemeksepeti?.ingestedAt || null;
  }
  return pm.meta.channelIngest?.[channelId]?.ingestedAt || null;
}

/**
 * Kanal bazlı eşleştirme kuyruğu — dashboard ve aksiyon merkezi için özet.
 */
export function buildMatchingQueue(db, config = {}) {
  const pm = ensureProductMatching(db);
  const globalMode = config.productMatchingMode || 'legacy';
  const modeByChannel = config.productMatchingModeByChannel || {};
  const confirmLevel = resolveBenimposSaleConfirmLevel(
    globalMode,
    config.benimposSaleConfirmLevel
  );

  const channels = [];
  let totalQueue = 0;
  let totalUnmapped = 0;
  let totalMissingMaster = 0;
  let totalNeedsReview = 0;
  let totalAutoPending = 0;

  for (const channel of listActiveHzlMrktOpsMatchingSalesChannels()) {
    if (!channelHasFeature(channel.id, 'matching-catalog')
      && !channelHasFeature(channel.id, 'matching-review')) {
      continue;
    }

    const mappings = countMappingsByChannel(db, channel.id);
    const byStatus = mappings.byStatus || {};
    const actionQueue = countChannelActionQueue(db, channel.id);
    const {
      productCount,
      manualConfirmed,
      unmapped,
      missingMaster,
      needsReview,
      autoPendingConfirm,
      queueTotal
    } = actionQueue;
    const autoMatched = byStatus[MAPPING_STATUS.AUTO_MATCHED] || 0;
    const matchingMode = resolveMatchingModeForChannel(globalMode, channel.id, modeByChannel);
    const readiness = buildChannelSalesReadiness(db, channel.id, confirmLevel);
    const catalogSyncedAt = catalogIngestTime(pm, channel.id);

    totalQueue += queueTotal;
    totalUnmapped += unmapped;
    totalMissingMaster += missingMaster;
    totalNeedsReview += needsReview;
    totalAutoPending += autoPendingConfirm;

    channels.push({
      channelId: channel.id,
      label: channel.label,
      status: channel.status,
      productCount,
      mappingCount: mappings.total,
      manualConfirmed,
      autoMatched,
      unmapped,
      missingMaster,
      needsReview,
      autoPendingConfirm,
      queueTotal,
      matchingMode,
      readyForSales: readiness.readyForSales,
      readyPct: channelReadyPercent({ productCount, manualConfirmed }),
      blockers: readiness.blockers,
      nextStep: readiness.nextSteps[0] || null,
      catalogSyncedAt,
      masterSyncedAt: pm.meta.masterSyncedAt || null,
      hrefPool: poolHref(channel.id),
      hrefMissing: HZLMRKTOPS_PRODUCTS,
      hrefAutoMatched: HZLMRKTOPS_PRODUCTS,
      hrefReview: HZLMRKTOPS_PRODUCTS
    });
  }

  for (const row of channels) {
    row.href = resolveInboxHref(row);
  }

  return {
    updatedAt: new Date().toISOString(),
    confirmLevel,
    productMatchingMode: globalMode,
    totals: {
      queue: totalQueue,
      unmapped: totalUnmapped,
      missingMaster: totalMissingMaster,
      needsReview: totalNeedsReview,
      autoPendingConfirm: totalAutoPending
    },
    channels: channels.sort((a, b) => b.queueTotal - a.queueTotal)
  };
}

export function matchingQueueActionItems(queue, { maxItems = 6 } = {}) {
  const items = [];

  for (const row of queue.channels || []) {
    const smartHref = resolveInboxHref(row);

    if (!row.readyForSales && row.blockers?.length) {
      items.push({
        id: `matching-readiness-${row.channelId}`,
        severity: row.missingMaster > 0 ? 'danger' : 'warning',
        label: `${row.label} — satışa hazır değil`,
        count: row.queueTotal || null,
        hint: row.blockers[0],
        href: smartHref,
        action: 'Eksik adımı tamamla'
      });
    }

    if (row.queueTotal <= 0) continue;

    if (items.some((item) => item.id === `matching-readiness-${row.channelId}`)) {
      continue;
    }

    const parts = [];
    if (row.unmapped > 0) parts.push(`${row.unmapped} eşleşmemiş`);
    if (row.missingMaster > 0) parts.push(`${row.missingMaster} ana ürün yok`);
    if (row.autoPendingConfirm > 0) parts.push(`${row.autoPendingConfirm} otomatik onay bekliyor`);
    if (row.needsReview > 0) parts.push(`${row.needsReview} kontrol/çakışma`);

    items.push({
      id: `matching-queue-${row.channelId}`,
      severity: row.missingMaster > 0 ? 'danger' : (row.needsReview > 0 ? 'warning' : 'info'),
      label: `${row.label} — eşleştirme kuyruğu`,
      count: row.queueTotal,
      hint: parts.join(' · ') || 'Eşleştirme tamamlanmadı',
      href: smartHref,
      action: row.queueTotal > 0 ? 'Gelen kutusunu aç' : 'Ürün havuzunu aç'
    });
  }

  if (queue.totals?.missingMaster > 0) {
    const channelCoversMissing = (queue.channels || []).some(
      (row) => row.missingMaster > 0 && row.queueTotal > 0
    );
    if (!channelCoversMissing) {
      items.push({
        id: 'matching-missing-master',
        severity: 'danger',
        label: 'BenimPOS eşleşmesi eksik ürünler',
        count: queue.totals.missingMaster,
        hint: 'Tüm kanallarda ana havuzda karşılığı olmayan SKU/barkodlar',
        href: buildProductPoolUrl(channel.id),
        action: 'Eksikleri incele'
      });
    }
  }

  return items.slice(0, maxItems);
}

export function catalogChannelOpsConfig(channelId) {
  const channel = getChannel(channelId);
  if (!channel || channel.status !== 'active') return null;
  if (channel.productLine !== 'hzlmrktops') return null;
  if (channelId === 'yemeksepeti') {
    return {
      channelId,
      label: channel.label,
      steps: ['master', 'catalog', 'auto-match'],
      catalogLabel: 'Yemeksepeti katalog sync',
      catalogDetail: 'Partner Assortment API üzerinden mağaza ürünlerini havuza çeker'
    };
  }
  return null;
}
