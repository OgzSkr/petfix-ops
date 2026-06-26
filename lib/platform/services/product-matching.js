import { readDb, writeDb } from '../../db/store.js';
import { envValue } from '../../env.js';
import { paths } from '../../config.js';
import { readEnvFile, readPlatformConfigEnv } from '../../env.js';
import { isProductMatchingEnabled, effectiveProductMatchingMode } from '../../product-matching/matching-enabled.js';
import {
  computeMasterPoolTabCounts,
  applyMasterPoolTab,
  applyMasterExtendedFilters,
  summarizeMasterMatchAggregate,
  buildMasterPoolBulkMappingItems,
  listMasterMappingHistory
} from '../../product-matching/master-pool-filters.js';
import { analyzeDuplicateChannelMappings } from '../../product-matching/duplicate-channel-mappings.js';
import {
  getProductMatching,
  countMappingsByChannel,
  appendMappingLog,
  findMasterByBarcode
} from '../../product-matching/store.js';
import {
  normalizeBarcode,
  findMasterByBarcodeKeys,
  nameSimilarityScore,
  parseChannelNameHints,
  barcodesEquivalent
} from '../../product-matching/normalize.js';
import {
  WORKBENCH_INDEX_META_KEY,
  buildIndexFromLiteResult,
  clearWorkbenchIndex,
  filterIndexEntries,
  getStoredWorkbenchIndex,
  isWorkbenchIndexFresh,
  saveWorkbenchIndex,
  summarizeFilteredEntries,
  workbenchDataFingerprint
} from '../../product-matching/workbench-index.js';
import {
  MAPPING_STATUS,
  MATCH_METHOD,
  PRODUCT_MATCHING_MODES,
  CHANNEL_PRODUCT_REVIEW,
  CHANNEL_PRODUCT_REVIEW_LABELS,
  listSalesMatchingChannels
} from '../../product-matching/constants.js';
import {
  enrichChannelProductsFromMaster,
  ingestUberEatsChannelProducts,
  ingestUberEatsCatalogProducts,
  isPlaceholderChannelName,
  mergeIncomingChannelProduct,
  mergeCatalogChannelProduct,
  resolveChannelDisplayName,
  stripUberOrderMetadataFromChannelProducts
} from '../../product-matching/channel-ingest/uber-eats.js';
import { ingestYemeksepetiCatalogProducts } from '../../product-matching/channel-ingest/yemeksepeti.js';
import { ingestGetirCatalogProducts } from '../../product-matching/channel-ingest/getir.js';
import {
  runAutoMatchForChannel,
  evaluateChannelToMasterMatch,
  runBarcodeOnlyAutoMatchForChannel,
  proposeMatchForChannelProduct,
  proposeFuzzyMatchForChannelProduct,
  channelProductBarcodes
} from '../../product-matching/matcher.js';
import { buildMatchingReports } from '../../product-matching/reports.js';
import {
  buildMissingMasterReviewRows,
  summarizeReviewRows,
  suggestMissingMasterReview
} from '../../product-matching/missing-master-suggest.js';
import { ensureChannelProduct } from '../../product-matching/ensure-channel-product.js';
import {
  buildPriceCompareReport,
  isIntentionalUberMarkup,
  paginateRows,
  priceDiffPercent
} from '../../product-matching/price-compare.js';
import {
  buildMasterChannelPrices,
  channelSalePriceFromProduct,
  computeMasterSyncStatus,
  createMasterChannelResolver,
  filterMastersByChannel
} from '../../product-matching/master-channel-prices.js';
import { syncMasterProductsFromBenimpos } from '../../product-matching/master-sync.js';
import { enrichSyncJobStatus } from '../../product-matching/sync-progress.js';
import { auditMappingsAfterMasterSync } from '../../product-matching/mapping-audit.js';
import {
  buildCleanupSuggestions,
  dismissCleanupSuggestions
} from '../../product-matching/cleanup-suggestions.js';
import {
  markChannelCatalogPresence,
  markMasterPresenceAfterSync,
  pruneAbsentCatalogChannelProducts,
  shouldHideAbsentCatalogChannelProduct
} from '../../product-matching/source-presence.js';
import {
  buildChannelLookupIndexes,
  findMappingForChannelLine
} from '../../product-matching/lookup.js';
import { buildProductPoolUrl } from '../../product-matching/pool-url.js';

function resolveMatchingMode(platformEnv = {}) {
  return effectiveProductMatchingMode(platformEnv);
}

async function assertMatchingOperationsEnabled() {
  const platformEnv = await readPlatformConfigEnv(paths.platformEnv);
  // Docker: process.env eski kalabilir; mount edilen .env / runtime-secrets öncelikli.
  if (!isProductMatchingEnabled({}, platformEnv)) {
    const error = new Error('Ürün eşleştirme kapalı. Siparişler kanal barkodu ile işlenir.');
    error.statusCode = 403;
    throw error;
  }
}

function masterProfitPctOnCost(master) {
  const buy = Number(master.buyingPrice);
  const sale = Number(master.salePrice1);
  if (!Number.isFinite(buy) || buy <= 0 || !Number.isFinite(sale) || sale <= 0) return null;
  return Math.round(((sale - buy) / buy) * 1000) / 10;
}

function masterMatchesPriceFilters(db, row, filters = {}) {
  const priceGap = String(filters.priceGap || '').trim();
  const lowProfit = String(filters.lowProfit || '').trim();
  const missingChannelPrice = String(filters.missingChannelPrice || '').trim();
  if (!priceGap && !lowProfit && !missingChannelPrice) return true;

  if (lowProfit === '1') {
    const profit = masterProfitPctOnCost(row);
    if (profit == null || profit >= 15) return false;
  }

  const prices = buildMasterChannelPrices(db, row);

  if (missingChannelPrice) {
    const channel = prices.find((item) => item.channelId === missingChannelPrice);
    if (Number(channel?.channelPrice) > 0) return false;
  }

  if (priceGap === 'high') {
    if (!prices.some((item) => item.saleDiffPct != null && Math.abs(item.saleDiffPct) >= 10)) {
      return false;
    }
  }

  if (priceGap === 'markup25_miss') {
    const uber = prices.find((item) => item.channelId === 'uber-eats');
    if (!uber?.channelPrice || uber.saleDiffPct == null) return false;
    if (Math.abs(uber.saleDiffPct - 25) <= 0.5) return false;
  }

  return true;
}

let masterListMetaCache = { key: '', brands: [], categories: [] };

function masterListMetaCacheKey(pm) {
  return `${pm.meta?.masterSyncedAt || ''}:${pm.masterProducts.length}`;
}

function getMasterProductBrands(pm) {
  const key = masterListMetaCacheKey(pm);
  if (masterListMetaCache.key === key && masterListMetaCache.brands.length) {
    return masterListMetaCache.brands;
  }
  const brands = [...new Set(
    pm.masterProducts
      .map((row) => String(row.brand || row.categoryName || '').trim())
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, 'tr-TR'));
  masterListMetaCache = {
    key,
    brands,
    categories: masterListMetaCache.key === key ? masterListMetaCache.categories : []
  };
  return brands;
}

function getMasterProductCategories(pm) {
  const key = masterListMetaCacheKey(pm);
  if (masterListMetaCache.key === key && masterListMetaCache.categories.length) {
    return masterListMetaCache.categories;
  }
  const categories = [...new Set(
    pm.masterProducts
      .map((row) => String(row.categoryName || '').trim())
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, 'tr-TR'));
  masterListMetaCache = {
    key,
    brands: masterListMetaCache.key === key ? masterListMetaCache.brands : [],
    categories
  };
  return categories;
}

function filterMasterProducts(rows, filters = {}) {
  let list = [...rows];
  const q = String(filters.q || '').trim().toLowerCase();
  if (q) {
    list = list.filter((row) =>
      String(row.name || '').toLowerCase().includes(q)
      || String(row.benimposBarcode || '').includes(q)
      || String(row.brand || '').toLowerCase().includes(q)
      || String(row.categoryName || '').toLowerCase().includes(q)
      || String(row.stockCode || '').toLowerCase().includes(q)
    );
  }

  const stock = String(filters.stock || '').trim();
  if (stock === 'in' || filters.hasStock === '1') {
    list = list.filter((row) => Number(row.stock) > 0);
  } else if (stock === 'out') {
    list = list.filter((row) => Number(row.stock) <= 0);
  }

  const cost = String(filters.cost || '').trim();
  if (cost === 'has' || filters.hasCost === '1') {
    list = list.filter((row) => Number(row.buyingPrice) > 0);
  } else if (cost === 'missing') {
    list = list.filter((row) => Number(row.buyingPrice) <= 0);
  }

  if (filters.online === '1') {
    list = list.filter((row) => row.isOnline === true);
  }

  const brand = String(filters.brand || '').trim();
  if (brand) {
    list = list.filter((row) => String(row.brand || row.categoryName || '').trim() === brand);
  }

  if (filters.missingMeta === '1') {
    list = list.filter((row) => !row.normalizedWeightG || !row.variantKey);
  }

  const sort = filters.sort || 'name';
  const sortDirRaw = String(filters.sortDir || '').toLowerCase();
  const sortDir = sortDirRaw === 'asc' || sortDirRaw === 'desc'
    ? sortDirRaw
    : (['stock', 'cost', 'updated'].includes(sort) ? 'desc' : 'asc');
  const mul = sortDir === 'desc' ? -1 : 1;
  list.sort((a, b) => {
    if (sort === 'priceDiff' || sort === 'maxPriceDiff') return 0;
    if (sort === 'stock') return mul * (Number(a.stock) - Number(b.stock));
    if (sort === 'cost') return mul * (Number(a.buyingPrice) - Number(b.buyingPrice));
    if (sort === 'barcode') {
      return mul * String(a.benimposBarcode).localeCompare(String(b.benimposBarcode), 'tr');
    }
    if (sort === 'updated') {
      return mul * String(a.syncedAt || '').localeCompare(String(b.syncedAt || ''));
    }
    return mul * String(a.name || '').localeCompare(String(b.name || ''), 'tr');
  });
  return list;
}

function channelMappingDetailsForMaster(db, masterProductId) {
  const pm = getProductMatching(db);
  return pm.mappings
    .filter((m) => m.masterProductId === masterProductId)
    .map((m) => {
      const cp = pm.channelProducts.find(
        (row) => row.channelId === m.channelId && row.channelProductId === m.channelProductId
      );
      return {
        channelId: m.channelId,
        channelProductId: m.channelProductId,
        channelName: cp?.channelName || m.channelProductId,
        channelBarcode: cp?.channelBarcode || m.channelBarcode || '',
        status: m.status,
        mappingId: m.id,
        channelSalePrice: channelSalePriceFromProduct(cp, m.channelId, db)
      };
    });
}

function applyMasterSyncMerge(existing, incoming) {
  const overrides = existing.masterOverrides || {};
  const keepVariant = overrides.variantKey ? existing.variantKey : null;
  const keepWeight = overrides.normalizedWeightG ? existing.normalizedWeightG : null;
  const keepNotes = existing.notes;
  const keepAutoStock = existing.autoStockSync;
  Object.assign(existing, incoming);
  if (overrides.variantKey && keepVariant !== null) existing.variantKey = keepVariant;
  if (overrides.normalizedWeightG && keepWeight !== null) existing.normalizedWeightG = keepWeight;
  if (keepNotes !== undefined) existing.notes = keepNotes;
  if (keepAutoStock !== undefined) existing.autoStockSync = keepAutoStock;
  existing.masterOverrides = overrides;
}

function filterChannelProducts(rows, filters = {}) {
  let list = [...rows];
  const q = String(filters.q || '').trim().toLowerCase();
  if (q) {
    list = list.filter((row) =>
      String(row.channelName || '').toLowerCase().includes(q)
      || String(row.channelBarcode || '').includes(q)
    );
  }
  const status = String(filters.status || '').trim();
  if (status) list = list.filter((row) => row.mappingStatus === status);

  if (String(filters.withoutMaster || '').trim() === '1') {
    list = list.filter((row) => !row.masterProductId);
  }

  list.sort((a, b) =>
    String(a.channelName || a.channelBarcode).localeCompare(String(b.channelName || b.channelBarcode), 'tr-TR')
  );
  return list;
}

function reEnrichPlaceholderChannelNames(pm, channelId) {
  const masterById = new Map(pm.masterProducts.map((m) => [m.id, m]));
  const masterByBarcode = new Map(
    pm.masterProducts.map((m) => [normalizeBarcode(m.benimposBarcode), m])
  );
  const mappingByCp = new Map(
    pm.mappings.filter((m) => m.channelId === channelId).map((m) => [m.channelProductId, m])
  );

  for (const cp of pm.channelProducts) {
    if (cp.channelId !== channelId || !isPlaceholderChannelName(cp.channelName)) continue;
    const mapping = mappingByCp.get(cp.channelProductId);
    const master = mapping?.masterProductId
      ? masterById.get(mapping.masterProductId)
      : masterByBarcode.get(normalizeBarcode(cp.channelBarcode));
    if (master?.name) cp.channelName = master.name;
  }
}

function resolveLinkedMaster(pm, cp, mapping) {
  const masterById = new Map(pm.masterProducts.map((m) => [m.id, m]));
  if (mapping?.masterProductId) {
    const linked = masterById.get(mapping.masterProductId);
    if (linked) {
      return { master: linked, source: 'mapping' };
    }
  }

  const barcode = cp.channelBarcode || mapping?.channelBarcode || cp.channelProductId;
  if (!barcode) return { master: null, source: null };

  const found = findMasterByBarcodeKeys(pm.masterProducts, barcode);
  if (found?.conflict) {
    return { master: null, source: 'barcode_conflict', conflict: true };
  }
  if (found?.master) {
    return { master: found.master, source: 'barcode_lookup' };
  }
  return { master: null, source: null };
}

function attachMappingToChannelProducts(db, channelId, channelProducts) {
  const pm = getProductMatching(db);
  const mappingByCp = new Map(
    pm.mappings.filter((m) => m.channelId === channelId).map((m) => [m.channelProductId, m])
  );

  return channelProducts.map((cp) => {
    const mapping = mappingByCp.get(cp.channelProductId);
    const resolved = resolveLinkedMaster(pm, cp, mapping);
    const master = resolved.master;
    const masterProductName = master?.name || cp.suggestedMasterName || null;
    return {
      ...cp,
      mappingStatus: mapping?.status || 'unmapped',
      mappingId: mapping?.id || null,
      masterProductId: master?.id || null,
      masterProductName,
      masterLinkSource: resolved.source,
      masterLinkConflict: Boolean(resolved.conflict),
      channelDisplayName: resolveChannelDisplayName(cp, master),
      confidenceScore: mapping?.confidenceScore ?? null,
      mappingReasons: mapping?.reasons || []
    };
  });
}

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

function summarizeMasterAction(row, channelMappings = {}, duplicateAnalysis = null) {
  const qualityFlags = masterQualityFlags(row);
  const dqIssues = masterDataQualityIssueCodes(qualityFlags);
  const matchIssues = [];
  for (const [channelId, status] of Object.entries(channelMappings)) {
    if (['unmapped', 'pending', 'review_required', 'auto_matched', 'missing_master', 'barcode_conflict'].includes(status)) {
      matchIssues.push({ channelId, status });
    }
  }

  let primaryIssue = null;
  let actionHint = 'İncele';
  if (duplicateAnalysis?.hasDuplicates) {
    primaryIssue = 'duplicate_mapping';
    actionHint = 'Fazla eşleşmeyi kaldır';
    for (const group of duplicateAnalysis.byChannel || []) {
      matchIssues.push({
        channelId: group.channelId,
        status: 'duplicate_mapping',
        count: group.count
      });
    }
  } else if (matchIssues.some((m) => m.status === 'auto_matched')) {
    primaryIssue = 'match_pending';
    actionHint = 'Onayla veya reddet';
  } else if (matchIssues.some((m) => m.status === 'review_required')) {
    primaryIssue = 'match_review';
    actionHint = 'Karşılaştır';
  } else if (matchIssues.some((m) => m.status === 'missing_master')) {
    primaryIssue = 'missing_master';
    actionHint = 'BenimPOS\'ta ara';
  } else if (matchIssues.some((m) => m.status === 'barcode_conflict')) {
    primaryIssue = 'multi_candidate';
    actionHint = 'Aday seç';
  } else if (matchIssues.some((m) => m.status === 'unmapped')) {
    primaryIssue = 'unmapped';
    actionHint = 'Eşleştir';
  } else if (dqIssues.length) {
    primaryIssue = 'data_quality';
    actionHint = 'Veriyi düzelt';
  } else if (matchIssues.length) {
    primaryIssue = 'match_other';
    actionHint = 'İncele';
  }

  return {
    dqIssues,
    matchIssues,
    primaryIssue,
    actionHint,
    needsMatchingAction: matchIssues.length > 0,
    needsDataQualityAction: dqIssues.length > 0 && matchIssues.length === 0 && !duplicateAnalysis?.hasDuplicates
  };
}

export function createProductMatchingService() {
  async function getMode() {
    const env = await readEnvFile(paths.platformEnv);
    return resolveMatchingMode(env);
  }

  async function getStatus() {
    const db = await readDb();
    const pm = getProductMatching(db);
    const uberMappings = countMappingsByChannel(db, 'uber-eats');
    const uberChannelCount = pm.channelProducts.filter((cp) => cp.channelId === 'uber-eats').length;
    const priceSummary = buildPriceCompareReport(db, 'uber-eats', {}).summary;
    const salesChannels = listSalesMatchingChannels();
    const channelStats = {};

    for (const channel of salesChannels) {
      const mappings = countMappingsByChannel(db, channel.id);
      const productCount = pm.channelProducts.filter((cp) => cp.channelId === channel.id).length;
      const confirmed = (mappings.byStatus?.manual_confirmed || 0)
        + (mappings.byStatus?.auto_matched || 0);
      channelStats[channel.id] = {
        id: channel.id,
        label: channel.label,
        status: channel.status,
        productCount,
        mappingCount: mappings.total,
        confirmedCount: confirmed,
        byStatus: mappings.byStatus
      };
    }

    return {
      mode: await getMode(),
      masterProductCount: pm.masterProducts.length,
      channelProductCount: pm.channelProducts.length,
      uberChannelProductCount: uberChannelCount,
      mappingCount: pm.mappings.length,
      conflictCount: pm.conflicts.length,
      masterSyncedAt: pm.meta.masterSyncedAt || null,
      uberChannelIngestedAt: pm.meta.channelIngest?.['uber-eats']?.ingestedAt || null,
      uberCatalogSyncedAt: pm.meta.channelIngest?.['uber-eats-catalog']?.ingestedAt || null,
      yemeksepetiCatalogSyncedAt: pm.meta.channelIngest?.yemeksepeti?.ingestedAt || null,
      yemeksepetiCatalogProductCount: pm.meta.channelIngest?.yemeksepeti?.prepared
        ?? pm.meta.channelIngest?.yemeksepeti?.distinctProducts
        ?? null,
      yemeksepetiCatalogPages: pm.meta.channelIngest?.yemeksepeti?.totalPages || null,
      uberCatalogStoreId: pm.meta.channelIngest?.['uber-eats-catalog']?.storeId || null,
      uberCatalogProductCount: pm.meta.channelIngest?.['uber-eats-catalog']?.distinctProducts || null,
      salesChannels,
      channelStats,
      uberEats: {
        ...uberMappings,
        markup25ReviewCount: priceSummary.markup25ReviewCount ?? 0,
        readyForSalesPct: priceSummary.readyForSalesPct ?? null,
        reviewRequired: priceSummary.reviewRequired ?? 0,
        missingMaster: priceSummary.missingMaster ?? 0,
        notOnSaleCount: priceSummary.notOnSaleCount ?? 0
      },
      channels: salesChannels
    };
  }

  function mappingStatusForMaster(db, masterProductId, channelId) {
    const pm = getProductMatching(db);
    const mapping = pm.mappings.find(
      (m) => m.masterProductId === masterProductId && m.channelId === channelId
    );
    return mapping?.status || 'unmapped';
  }

  function mappingStatusesForMaster(db, masterProductId) {
    const statuses = {};
    for (const channel of listSalesMatchingChannels()) {
      statuses[channel.id] = mappingStatusForMaster(db, masterProductId, channel.id);
    }
    return statuses;
  }

  function masterNeedsAction(db, masterProductId) {
    const statuses = mappingStatusesForMaster(db, masterProductId);
    return Object.values(statuses).some((status) =>
      ['unmapped', 'pending', 'review_required', 'missing_master', 'barcode_conflict'].includes(status)
    );
  }

  async function listMasterProducts(searchParams = {}) {
    const db = await readDb();
    const pm = getProductMatching(db);
    const page = Math.max(1, Number(searchParams.get?.('page') ?? searchParams.page ?? 1) || 1);
    const limit = Math.min(200, Math.max(10, Number(searchParams.get?.('limit') ?? searchParams.limit ?? 50) || 50));

    const filterInput = {
      q: searchParams.get?.('q') ?? '',
      hasStock: searchParams.get?.('hasStock') ?? '',
      hasCost: searchParams.get?.('hasCost') ?? '',
      stock: searchParams.get?.('stock') ?? '',
      cost: searchParams.get?.('cost') ?? '',
      brand: searchParams.get?.('brand') ?? '',
      online: searchParams.get?.('online') ?? '',
      missingMeta: searchParams.get?.('missingMeta') ?? '',
      sort: searchParams.get?.('sort') ?? 'name',
      sortDir: searchParams.get?.('sortDir') ?? ''
    };

    let filtered = filterMasterProducts(pm.masterProducts, filterInput);

    const mappingChannel = String(searchParams.get?.('mappingChannel') ?? '').trim();
    const mappingStatus = String(searchParams.get?.('mappingStatus') ?? '').trim();
    if (mappingChannel) {
      filtered = filtered.filter((row) => {
        const status = mappingStatusForMaster(db, row.id, mappingChannel);
        if (!mappingStatus) return true;
        if (mappingStatus === 'mapped') return status !== 'unmapped';
        if (mappingStatus === 'needs_action') {
          return ['unmapped', 'pending', 'review_required', 'missing_master', 'barcode_conflict'].includes(status);
        }
        return status === mappingStatus;
      });
    }

    const priceFilters = {
      priceGap: searchParams.get?.('priceGap') ?? '',
      lowProfit: searchParams.get?.('lowProfit') ?? '',
      missingChannelPrice: searchParams.get?.('missingChannelPrice') ?? ''
    };
    if (priceFilters.priceGap || priceFilters.lowProfit || priceFilters.missingChannelPrice) {
      filtered = filtered.filter((row) => masterMatchesPriceFilters(db, row, priceFilters));
    }

    const actionFilter = String(searchParams.get?.('actionFilter') ?? '').trim();
    if (actionFilter === 'data_issues') {
      filtered = filtered.filter((row) => masterDataQualityIssueCodes(masterQualityFlags(row)).length > 0);
    } else if (actionFilter === 'pending_match') {
      filtered = filtered.filter((row) => masterNeedsAction(db, row.id));
    } else if (actionFilter === 'missing_master') {
      filtered = filtered.filter((row) =>
        mappingStatusForMaster(db, row.id, 'uber-eats') === 'missing_master'
        || Object.values(mappingStatusesForMaster(db, row.id)).includes('missing_master')
      );
    } else     if (actionFilter === 'multi_candidate') {
      filtered = filtered.filter((row) =>
        Object.values(mappingStatusesForMaster(db, row.id)).includes('barcode_conflict')
      );
    }

    const poolTab = String(searchParams.get?.('poolTab') ?? searchParams.poolTab ?? '').trim();
    const tabCounts = poolTab
      ? computeMasterPoolTabCounts(db, pm.masterProducts)
      : null;

    filtered = applyMasterExtendedFilters(filtered, {
      category: searchParams.get?.('category') ?? '',
      stockCode: searchParams.get?.('stockCode') ?? '',
      channelCode: searchParams.get?.('channelCode') ?? '',
      dataQuality: searchParams.get?.('dataQuality') ?? '',
      negativeStock: searchParams.get?.('negativeStock') ?? '',
      variant: searchParams.get?.('variant') ?? '',
      weightMin: searchParams.get?.('weightMin') ?? '',
      weightMax: searchParams.get?.('weightMax') ?? '',
      updatedSince: searchParams.get?.('updatedSince') ?? '',
      mappingChannel,
      matchAggregate: searchParams.get?.('matchAggregate') ?? searchParams.matchAggregate ?? ''
    }, db);

    if (poolTab) {
      filtered = applyMasterPoolTab(filtered, poolTab, db);
    }

    const syncStatus = String(searchParams.get?.('syncStatus') ?? '').trim();
    const channelResolver = createMasterChannelResolver(pm);
    if (syncStatus) {
      filtered = filtered.filter((row) => {
        const channelPrices = buildMasterChannelPrices(db, row, channelResolver);
        return computeMasterSyncStatus(row, channelPrices) === syncStatus;
      });
    }

    const channelFocus = String(searchParams.get?.('channelFocus') ?? '').trim();
    const channelSaleStatus = String(searchParams.get?.('channelSaleStatus') ?? '').trim();
    if (channelFocus) {
      filtered = filterMastersByChannel(filtered, db, { channelFocus, channelSaleStatus });
    }

    const sortKey = String(filterInput.sort || 'name').trim();
    const sortDirRaw = String(filterInput.sortDir || '').toLowerCase();
    const sortDir = sortDirRaw === 'asc' || sortDirRaw === 'desc'
      ? sortDirRaw
      : (['stock', 'cost', 'updated', 'priceDiff', 'maxPriceDiff'].includes(sortKey) ? 'desc' : 'asc');
    const sortMul = sortDir === 'desc' ? -1 : 1;
    if (sortKey === 'priceDiff' || sortKey === 'maxPriceDiff') {
      const diffChannel = channelFocus || 'getir';
      const activeChannels = listSalesMatchingChannels().filter((channel) => channel.status !== 'planned');
      const masterComparePrice = (row) => {
        const sale = Number(row.salePrice1) || 0;
        const cost = Number(row.buyingPrice) || 0;
        return sale > 1 ? sale : (cost > 0 ? cost : null);
      };
      const diffValue = (row) => {
        const comparePrice = masterComparePrice(row);
        if (!comparePrice) return -1;
        if (sortKey === 'maxPriceDiff') {
          let max = -1;
          for (const channel of activeChannels) {
            const { cp } = channelResolver.resolve(row, channel.id);
            if (!cp) continue;
            const channelPrice = channelSalePriceFromProduct(cp, channel.id, db);
            if (channelPrice == null) continue;
            const pct = Math.abs(Number(priceDiffPercent(channelPrice, comparePrice)) || 0);
            if (pct > max) max = pct;
          }
          return max;
        }
        const { cp } = channelResolver.resolve(row, diffChannel);
        if (!cp) return -1;
        const channelPrice = channelSalePriceFromProduct(cp, diffChannel, db);
        if (channelPrice == null) return -1;
        return Math.abs(Number(priceDiffPercent(channelPrice, comparePrice)) || 0);
      };
      filtered.sort((a, b) => sortMul * (diffValue(a) - diffValue(b)));
    }

    const avgProfitPct = null;

    const brands = getMasterProductBrands(pm);
    const categories = getMasterProductCategories(pm);

    const start = (page - 1) * limit;
    const rows = filtered.slice(start, start + limit).map((row) => {
      const channelMappings = mappingStatusesForMaster(db, row.id);
      const channelPrices = buildMasterChannelPrices(db, row, channelResolver);
      const channelMappingDetails = channelMappingDetailsForMaster(db, row.id);
      const duplicateChannelMappings = analyzeDuplicateChannelMappings(
        channelMappingDetails,
        row.benimposBarcode
      );
      return {
        ...row,
        uberMappingStatus: mappingStatusForMaster(db, row.id, 'uber-eats'),
        channelMappings,
        channelMappingDetails,
        duplicateChannelMappings,
        channelPrices,
        syncStatus: computeMasterSyncStatus(row, channelPrices),
        qualityFlags: masterQualityFlags(row),
        profitPct: masterProfitPctOnCost(row),
        actionSummary: summarizeMasterAction(row, channelMappings, duplicateChannelMappings),
        matchAggregate: summarizeMasterMatchAggregate(channelMappings, duplicateChannelMappings),
        autoStockSync: row.autoStockSync !== false
      };
    });

    return {
      rows,
      total: filtered.length,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(filtered.length / limit)),
      syncedAt: pm.meta.masterSyncedAt,
      brands,
      categories,
      summary: {
        poolTotal: pm.masterProducts.length,
        filtered: filtered.length,
        avgProfitPct,
        tabCounts
      }
    };
  }

  async function updateMasterProduct(masterProductId, payload = {}) {
    const id = String(masterProductId || '').trim();
    if (!id) throw new Error('Ana ürün kimliği gerekli.');

    const db = await readDb();
    const pm = getProductMatching(db);
    const master = pm.masterProducts.find((row) => row.id === id);
    if (!master) throw new Error('Ana ürün bulunamadı.');

    master.masterOverrides = master.masterOverrides || {};

    if (payload.variantKey !== undefined) {
      const next = String(payload.variantKey || '').trim();
      master.variantKey = next || master.variantKey || null;
      master.masterOverrides.variantKey = true;
    }

    if (payload.normalizedWeightG !== undefined) {
      const raw = payload.normalizedWeightG;
      const n = raw === '' || raw === null ? null : Number(raw);
      master.normalizedWeightG = Number.isFinite(n) && n > 0 ? Math.round(n) : null;
      master.masterOverrides.normalizedWeightG = true;
    }

    if (payload.notes !== undefined) {
      master.notes = String(payload.notes || '').trim();
    }

    if (payload.autoStockSync !== undefined) {
      master.autoStockSync = payload.autoStockSync === true || payload.autoStockSync === 'true';
    }

    master.updatedAt = new Date().toISOString();
    db.meta = db.meta || {};
    db.meta.updatedAt = new Date().toISOString();
    await writeDb(db);

    return {
      ok: true,
      master: {
        ...master,
        channelMappings: mappingStatusesForMaster(db, master.id),
        channelMappingDetails: channelMappingDetailsForMaster(db, master.id)
      }
    };
  }

  async function setMasterAutoStockBulk(payload = {}) {
    const enabled = payload.enabled === true || payload.enabled === 'true';
    const db = await readDb();
    const pm = getProductMatching(db);
    let updated = 0;

    if (payload.all === true) {
      for (const master of pm.masterProducts) {
        master.autoStockSync = enabled;
        updated += 1;
      }
    } else {
      const ids = new Set(
        (Array.isArray(payload.masterProductIds) ? payload.masterProductIds : [])
          .map((id) => String(id || '').trim())
          .filter(Boolean)
      );
      const barcodes = new Set(
        (Array.isArray(payload.barcodes) ? payload.barcodes : [])
          .map((code) => normalizeBarcode(code))
          .filter(Boolean)
      );

      for (const master of pm.masterProducts) {
        const matchId = ids.has(master.id);
        const matchBarcode = barcodes.has(normalizeBarcode(master.benimposBarcode));
        if (!matchId && !matchBarcode) continue;
        master.autoStockSync = enabled;
        updated += 1;
      }
    }

    db.meta = db.meta || {};
    db.meta.updatedAt = new Date().toISOString();
    await writeDb(db);

    return {
      ok: true,
      updated,
      enabled,
      total: pm.masterProducts.length,
      included: pm.masterProducts.filter((row) => row.autoStockSync !== false).length
    };
  }

  async function listChannelProducts(channelId, searchParams = {}) {
    const db = await readDb();
    const pm = getProductMatching(db);
    const page = Math.max(1, Number(searchParams.get?.('page') ?? searchParams.page ?? 1) || 1);
    const limit = Math.min(200, Math.max(10, Number(searchParams.get?.('limit') ?? searchParams.limit ?? 50) || 50));

    const base = pm.channelProducts.filter((cp) => cp.channelId === channelId);
    const enriched = attachMappingToChannelProducts(db, channelId, base);
    const filtered = filterChannelProducts(enriched, {
      q: searchParams.get?.('q') ?? '',
      status: searchParams.get?.('status') ?? '',
      withoutMaster: searchParams.get?.('withoutMaster') ?? ''
    });

    const start = (page - 1) * limit;
    return {
      rows: filtered.slice(start, start + limit),
      total: filtered.length,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(filtered.length / limit))
    };
  }

  const masterSyncJob = {
    running: false,
    startedAt: null,
    finishedAt: null,
    result: null,
    error: null,
    progress: null
  };

  function getMasterSyncStatus() {
    return enrichSyncJobStatus(masterSyncJob);
  }

  const catalogSyncJobs = new Map();

  function getCatalogSyncJob(channelId) {
    const id = String(channelId || '').trim();
    if (!catalogSyncJobs.has(id)) {
      catalogSyncJobs.set(id, {
        running: false,
        startedAt: null,
        finishedAt: null,
        result: null,
        error: null,
        progress: null
      });
    }
    return catalogSyncJobs.get(id);
  }

  function getCatalogSyncStatus(channelId) {
    return enrichSyncJobStatus(getCatalogSyncJob(channelId));
  }

  function startCatalogSyncJob(channelId, label, runner) {
    const job = getCatalogSyncJob(channelId);
    if (job.running) {
      return {
        ok: true,
        skipped: true,
        running: true,
        channelId,
        message: `${label} sync zaten çalışıyor.`,
        ...getCatalogSyncStatus(channelId)
      };
    }

    job.running = true;
    job.startedAt = new Date().toISOString();
    job.finishedAt = null;
    job.result = null;
    job.error = null;
    job.progress = { phase: 'start', message: `${label} başlatılıyor…`, percent: 0 };

    setImmediate(() => {
      Promise.resolve(runner((progress) => {
        job.progress = progress;
      }))
        .then((result) => {
          job.result = result;
          job.finishedAt = new Date().toISOString();
          job.progress = {
            phase: 'done',
            percent: 100,
            message: `${label} tamamlandı`
          };
        })
        .catch((error) => {
          job.error = error.message || String(error);
          job.finishedAt = new Date().toISOString();
          job.progress = {
            phase: 'error',
            message: job.error,
            percent: enrichSyncJobStatus(job).percent
          };
        })
        .finally(() => {
          job.running = false;
        });
    });

    return {
      ok: true,
      started: true,
      running: true,
      channelId,
      startedAt: job.startedAt,
      message: `${label} arka planda başlatıldı.`
    };
  }

  function startUberCatalogSync(options = {}) {
    return startCatalogSyncJob('uber-eats', 'Uber Eats katalog', (onProgress) =>
      syncUberCatalogProducts({ ...options, onProgress })
    );
  }

  function startGetirCatalogSync(options = {}) {
    return startCatalogSyncJob('getir', 'Getir katalog', (onProgress) =>
      syncGetirCatalogProducts({ ...options, onProgress })
    );
  }

  function startYemeksepetiCatalogSync(options = {}) {
    return startCatalogSyncJob('yemeksepeti', 'Yemeksepeti katalog', (onProgress) =>
      syncYemeksepetiCatalogProducts({ ...options, onProgress })
    );
  }

  async function syncMasterFromBenimpos(options = {}) {
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
    onProgress({ phase: 'fetch', message: 'BenimPOS ürün listesi çekiliyor…' });
    const result = await syncMasterProductsFromBenimpos({
      onPage: (page, totalPage, count) => {
        onProgress({
          phase: 'fetch',
          page,
          totalPages: totalPage,
          fetched: count,
          basePercent: 0,
          slicePercent: 90,
          message: `BenimPOS sayfa ${page}/${totalPage} (${count} ürün)`
        });
      }
    });
    onProgress({ phase: 'save', message: 'Veritabanı güncelleniyor…', percent: 92 });
    const db = await readDb();
    const pm = getProductMatching(db);
    const existingByBarcode = new Map(
      pm.masterProducts.map((row) => [normalizeBarcode(row.benimposBarcode), row])
    );

    let added = 0;
    let updated = 0;
    for (const incoming of result.masterProducts) {
      const key = normalizeBarcode(incoming.benimposBarcode);
      if (existingByBarcode.has(key)) {
        applyMasterSyncMerge(existingByBarcode.get(key), incoming);
        updated += 1;
      } else {
        pm.masterProducts.push(incoming);
        existingByBarcode.set(key, incoming);
        added += 1;
      }
    }

    enrichChannelProductsFromMaster(
      pm.channelProducts.filter((cp) => cp.channelId === 'uber-eats'),
      pm.masterProducts
    );

    markMasterPresenceAfterSync(pm, result.masterProducts, result.summary.syncedAt);

    pm.meta.masterSyncedAt = result.summary.syncedAt;
    pm.meta.masterProductCount = pm.masterProducts.length;
    pm.meta.lastMasterSync = result.summary;
    const mappingAudit = auditMappingsAfterMasterSync(db);
    db.meta = db.meta || {};
    db.meta.updatedAt = new Date().toISOString();
    await writeDb(db);

    return {
      ok: true,
      ...result.summary,
      added,
      updated,
      totalInDb: pm.masterProducts.length,
      mappingAudit
    };
  }

  async function startMasterSyncFromBenimpos() {
    if (masterSyncJob.running) {
      return {
        ok: true,
        skipped: true,
        running: true,
        startedAt: masterSyncJob.startedAt,
        message: 'BenimPOS sync zaten çalışıyor.'
      };
    }

    masterSyncJob.running = true;
    masterSyncJob.startedAt = new Date().toISOString();
    masterSyncJob.finishedAt = null;
    masterSyncJob.result = null;
    masterSyncJob.error = null;
    masterSyncJob.progress = { phase: 'start', message: 'BenimPOS sync başlatılıyor…' };

    setImmediate(() => {
      syncMasterFromBenimpos({
        onProgress: (progress) => {
          masterSyncJob.progress = progress;
        }
      })
        .then((result) => {
          masterSyncJob.result = result;
          masterSyncJob.finishedAt = new Date().toISOString();
        })
        .catch((error) => {
          masterSyncJob.error = error.message || String(error);
          masterSyncJob.finishedAt = new Date().toISOString();
        })
        .finally(() => {
          masterSyncJob.running = false;
        });
    });

    return {
      ok: true,
      started: true,
      running: true,
      startedAt: masterSyncJob.startedAt,
      message: 'BenimPOS sync arka planda başlatıldı.'
    };
  }

  async function syncUberChannelProducts(days = 90) {
    const ingest = await ingestUberEatsChannelProducts(days);
    const db = await readDb();
    const pm = getProductMatching(db);

    enrichChannelProductsFromMaster(ingest.channelProducts, pm.masterProducts);

    const existing = new Map(
      pm.channelProducts
        .filter((cp) => cp.channelId === 'uber-eats')
        .map((cp) => [cp.channelProductId, cp])
    );

    let added = 0;
    let updated = 0;
    const masterByBarcode = new Map(
      pm.masterProducts.map((m) => [normalizeBarcode(m.benimposBarcode), m])
    );

    for (const incoming of ingest.channelProducts) {
      const master = masterByBarcode.get(normalizeBarcode(incoming.channelBarcode));
      if (existing.has(incoming.channelProductId)) {
        const current = existing.get(incoming.channelProductId);
        Object.assign(current, mergeIncomingChannelProduct(current, incoming, master?.name));
        updated += 1;
      } else {
        pm.channelProducts.push(incoming);
        existing.set(incoming.channelProductId, incoming);
        added += 1;
      }
    }

    reEnrichPlaceholderChannelNames(pm, 'uber-eats');

    pm.meta.channelIngest = pm.meta.channelIngest || {};
    pm.meta.channelIngest['uber-eats'] = ingest.summary;
    db.meta = db.meta || {};
    db.meta.updatedAt = new Date().toISOString();
    await writeDb(db);

    return { ok: true, ...ingest.summary, added, updated, totalInDb: existing.size };
  }

  async function syncUberCatalogProducts(options = {}) {
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
    onProgress({ phase: 'fetch', message: 'Uber Eats katalog API çekiliyor…', percent: 2 });
    const ingest = await ingestUberEatsCatalogProducts(options);
    onProgress({ phase: 'save', message: 'Veritabanına yazılıyor…', percent: 92 });
    const db = await readDb();
    const pm = getProductMatching(db);

    enrichChannelProductsFromMaster(ingest.channelProducts, pm.masterProducts);

    const existing = new Map(
      pm.channelProducts
        .filter((cp) => cp.channelId === 'uber-eats')
        .map((cp) => [cp.channelProductId, cp])
    );

    let added = 0;
    let updated = 0;

    for (const incoming of ingest.channelProducts) {
      if (existing.has(incoming.channelProductId)) {
        const current = existing.get(incoming.channelProductId);
        Object.assign(current, mergeCatalogChannelProduct(current, incoming));
        updated += 1;
      } else {
        pm.channelProducts.push(incoming);
        existing.set(incoming.channelProductId, incoming);
        added += 1;
      }
    }

    reEnrichPlaceholderChannelNames(pm, 'uber-eats');

    const orderMetaCleaned = stripUberOrderMetadataFromChannelProducts(pm.channelProducts);

    markChannelCatalogPresence(
      pm,
      'uber-eats',
      ingest.channelProducts.map((row) => row.channelProductId),
      ingest.summary?.ingestedAt || ingest.summary?.catalogSyncedAt
    );

    const pruned = pruneAbsentCatalogChannelProducts(pm, 'uber-eats');
    if (pruned.removedProducts > 0) {
      markWorkbenchStoresDirty(pm);
    }

    pm.meta.channelIngest = pm.meta.channelIngest || {};
    pm.meta.channelIngest['uber-eats-catalog'] = {
      ...ingest.summary,
      prunedAbsent: pruned.removedProducts,
      prunedMappings: pruned.removedMappings
    };
    db.meta = db.meta || {};
    db.meta.updatedAt = new Date().toISOString();
    await writeDb(db);

    onProgress({ phase: 'save', message: 'Barkod eşleştirmesi yapılıyor…', percent: 96 });
    const barcodeLink = runBarcodeOnlyAutoMatchForChannel(db, 'uber-eats');
    db.meta.lastBarcodeLink = { channelId: 'uber-eats', at: new Date().toISOString(), ...barcodeLink };
    await writeDb(db);

    return {
      ok: true,
      ...ingest.summary,
      added,
      updated,
      totalInDb: pm.channelProducts.filter((cp) => cp.channelId === 'uber-eats').length,
      prunedAbsent: pruned.removedProducts,
      prunedMappings: pruned.removedMappings,
      orderMetaCleaned,
      barcodeLink
    };
  }

  async function syncGetirCatalogProducts(options = {}) {
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
    onProgress({ phase: 'fetch', message: 'Getir katalog API çekiliyor…', percent: 2 });
    const ingest = await ingestGetirCatalogProducts(options);
    onProgress({ phase: 'save', message: 'Veritabanına yazılıyor…', percent: 92 });
    const db = await readDb();
    const pm = getProductMatching(db);

    enrichChannelProductsFromMaster(ingest.channelProducts, pm.masterProducts);

    const existing = new Map(
      pm.channelProducts
        .filter((cp) => cp.channelId === 'getir')
        .map((cp) => [cp.channelProductId, cp])
    );

    let added = 0;
    let updated = 0;

    for (const incoming of ingest.channelProducts) {
      if (existing.has(incoming.channelProductId)) {
        const current = existing.get(incoming.channelProductId);
        Object.assign(current, mergeCatalogChannelProduct(current, incoming));
        updated += 1;
      } else {
        pm.channelProducts.push(incoming);
        existing.set(incoming.channelProductId, incoming);
        added += 1;
      }
    }

    markChannelCatalogPresence(
      pm,
      'getir',
      ingest.channelProducts.map((row) => row.channelProductId),
      ingest.summary?.ingestedAt
    );

    const pruned = pruneAbsentCatalogChannelProducts(pm, 'getir');
    if (pruned.removedProducts > 0) {
      markWorkbenchStoresDirty(pm);
    }

    pm.meta.channelIngest = pm.meta.channelIngest || {};
    pm.meta.channelIngest['getir-catalog'] = {
      ...ingest.summary,
      prunedAbsent: pruned.removedProducts,
      prunedMappings: pruned.removedMappings
    };
    db.meta = db.meta || {};
    db.meta.updatedAt = new Date().toISOString();
    await writeDb(db);

    onProgress({ phase: 'save', message: 'Barkod eşleştirmesi yapılıyor…', percent: 96 });
    const barcodeLink = runBarcodeOnlyAutoMatchForChannel(db, 'getir');
    db.meta.lastBarcodeLink = { channelId: 'getir', at: new Date().toISOString(), ...barcodeLink };
    await writeDb(db);

    return {
      ok: true,
      ...ingest.summary,
      added,
      updated,
      totalInDb: pm.channelProducts.filter((cp) => cp.channelId === 'getir').length,
      prunedAbsent: pruned.removedProducts,
      prunedMappings: pruned.removedMappings,
      barcodeLink
    };
  }

  async function syncYemeksepetiCatalogProducts(options = {}) {
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
    onProgress({ phase: 'fetch', message: 'Yemeksepeti katalog API çekiliyor…', percent: 2 });
    const db = await readDb();
    const pm = getProductMatching(db);

    const existing = new Map(
      pm.channelProducts
        .filter((cp) => cp.channelId === 'yemeksepeti')
        .map((cp) => [cp.channelProductId, cp])
    );

    let added = 0;
    let updated = 0;
    let lastPage = 0;
    let totalPages = 0;

    const mergeIncoming = (incoming) => {
      if (existing.has(incoming.channelProductId)) {
        const current = existing.get(incoming.channelProductId);
        if (incoming.channelName && incoming.channelName !== current.channelName) {
          current.channelName = incoming.channelName;
        }
        if (incoming.channelBarcode && incoming.channelBarcode !== current.channelBarcode) {
          current.channelBarcode = incoming.channelBarcode;
        }
        if (incoming.channelPrice != null) current.channelPrice = incoming.channelPrice;
        if (incoming.channelImageUrl) current.channelImageUrl = incoming.channelImageUrl;
        if (incoming.ysRemoteProductId) current.ysRemoteProductId = incoming.ysRemoteProductId;
        if (incoming.ysSku) current.ysSku = incoming.ysSku;
        if (incoming.ysActive != null) current.ysActive = incoming.ysActive;
        current.updatedAt = new Date().toISOString();
        updated += 1;
      } else {
        pm.channelProducts.push(incoming);
        existing.set(incoming.channelProductId, incoming);
        added += 1;
      }
    };

    const ingest = await ingestYemeksepetiCatalogProducts({
      ...options,
      onProgress,
      onBatch: async (batch, meta) => {
        lastPage = meta.page;
        totalPages = meta.totalPages;
        for (const incoming of batch) mergeIncoming(incoming);
        pm.meta.channelIngest = pm.meta.channelIngest || {};
        pm.meta.channelIngest.yemeksepeti = {
          source: 'yemeksepeti_catalog',
          ingestedAt: new Date().toISOString(),
          fetchedPages: meta.page,
          totalPages: meta.totalPages,
          prepared: existing.size
        };
        db.meta = db.meta || {};
        db.meta.updatedAt = new Date().toISOString();
        await writeDb(db);
      }
    });

    onProgress({ phase: 'save', message: 'Katalog varlığı işaretleniyor…', percent: 92 });

    markChannelCatalogPresence(
      pm,
      'yemeksepeti',
      ingest.channelProducts.map((row) => row.channelProductId),
      ingest.summary?.ingestedAt,
      { markAbsent: !ingest.summary?.truncated }
    );

    const pruned = pruneAbsentCatalogChannelProducts(pm, 'yemeksepeti');
    if (pruned.removedProducts > 0) {
      markWorkbenchStoresDirty(pm);
    }

    pm.meta.channelIngest = pm.meta.channelIngest || {};
    pm.meta.channelIngest.yemeksepeti = {
      ...ingest.summary,
      prunedAbsent: pruned.removedProducts,
      prunedMappings: pruned.removedMappings
    };
    db.meta = db.meta || {};
    db.meta.updatedAt = new Date().toISOString();
    await writeDb(db);

    const barcodeLink = runBarcodeOnlyAutoMatchForChannel(db, 'yemeksepeti');
    db.meta.lastBarcodeLink = { channelId: 'yemeksepeti', at: new Date().toISOString(), ...barcodeLink };
    await writeDb(db);

    return {
      ok: true,
      ...ingest.summary,
      added,
      updated,
      totalInDb: pm.channelProducts.filter((cp) => cp.channelId === 'yemeksepeti').length,
      lastPage,
      totalPages: ingest.summary.totalPages || totalPages,
      prunedAbsent: pruned.removedProducts,
      prunedMappings: pruned.removedMappings,
      barcodeLink
    };
  }

  async function cleanUberOrderMetadata() {
    const db = await readDb();
    const pm = getProductMatching(db);
    const cleaned = stripUberOrderMetadataFromChannelProducts(pm.channelProducts);
    if (cleaned > 0) {
      db.meta = db.meta || {};
      db.meta.updatedAt = new Date().toISOString();
      await writeDb(db);
    }
    return { ok: true, cleaned, totalUber: pm.channelProducts.filter((cp) => cp.channelId === 'uber-eats').length };
  }

  async function linkChannelProductsByBarcode(channelId = 'yemeksepeti') {
    const db = await readDb();
    const pm = getProductMatching(db);
    const summary = runBarcodeOnlyAutoMatchForChannel(db, channelId);
    db.meta = db.meta || {};
    db.meta.updatedAt = new Date().toISOString();
    db.meta.lastBarcodeLink = { channelId, at: new Date().toISOString(), ...summary };
    markWorkbenchStoresDirty(pm);
    await writeDb(db);
    return { ok: true, ...summary };
  }

  async function runAutoMatch(channelId = 'uber-eats', options = {}) {
    await assertMatchingOperationsEnabled();
    const db = await readDb();
    const pm = getProductMatching(db);
    const barcodeSummary = runBarcodeOnlyAutoMatchForChannel(db, channelId);
    const summary = runAutoMatchForChannel(db, channelId, {
      allowFuzzy: options.allowFuzzy === true
    });
    db.meta = db.meta || {};
    db.meta.updatedAt = new Date().toISOString();
    db.meta.lastAutoMatch = {
      channelId,
      at: new Date().toISOString(),
      ...summary,
      barcodeLink: barcodeSummary
    };
    markWorkbenchStoresDirty(pm);
    await writeDb(db);

    let confirm = null;
    if (options.confirm !== false) {
      confirm = await confirmAutoMatchedBulk({
        channelId,
        confirmedBy: options.confirmedBy || 'auto_match_confirm'
      });
    }

    return { ok: true, ...summary, barcodeLink: barcodeSummary, confirm };
  }

  async function runAutoMatchAllChannels(options = {}) {
    const { HZLMRKTOPS_BUYBOX_CHANNEL_IDS } = await import('../../hzlmrktops/constants.js');
    const channels = Array.isArray(options.channels) && options.channels.length
      ? options.channels
      : [...HZLMRKTOPS_BUYBOX_CHANNEL_IDS];
    const confirm = options.confirm !== false;
    const results = [];

    for (const channelId of channels) {
      const match = await runAutoMatch(channelId);
      const confirmResult = confirm
        ? await confirmAutoMatchedBulk({ channelId })
        : null;
      results.push({ channelId, match, confirm: confirmResult });
    }

    return { ok: true, channels: results };
  }

  function applyManualConfirmMapping(db, pm, payload = {}) {
    const channelId = String(payload.channelId || 'uber-eats').trim();
    const channelProductId = String(payload.channelProductId || '').trim();
    const masterProductId = String(payload.masterProductId || '').trim();
    if (!channelProductId || !masterProductId) {
      return { ok: false, reason: 'missing_ids' };
    }

    const master = pm.masterProducts.find((m) => m.id === masterProductId);
    if (!master) return { ok: false, reason: 'missing_master' };

    let channelProduct = pm.channelProducts.find(
      (cp) => cp.channelId === channelId && cp.channelProductId === channelProductId
    );
    if (!channelProduct && payload.ensureChannelProduct) {
      const ensured = ensureChannelProduct(db, {
        channelId,
        channelProductId,
        channelBarcode: payload.channelBarcode || channelProductId,
        channelName: payload.channelName || channelProductId,
        source: payload.source || 'order_line'
      });
      channelProduct = ensured.channelProduct;
    }
    if (!channelProduct) return { ok: false, reason: 'missing_channel_product' };

    const now = payload.now || new Date().toISOString();
    let mapping = pm.mappings.find(
      (m) => m.channelId === channelId && m.channelProductId === channelProductId
    );

    if (!mapping) {
      mapping = {
        id: `map-${channelId}-${channelProductId}`,
        channelId,
        channelProductId,
        channelBarcode: channelProduct.channelBarcode
      };
      pm.mappings.push(mapping);
    }

    Object.assign(mapping, {
      masterProductId,
      status: MAPPING_STATUS.MANUAL_CONFIRMED,
      matchMethod: MATCH_METHOD.MANUAL,
      confidenceScore: 100,
      reasons: [],
      confirmedAt: now,
      confirmedBy: payload.confirmedBy || 'user',
      updatedAt: now
    });

    if (isPlaceholderChannelName(channelProduct.channelName)) {
      channelProduct.channelName = master.name;
    }

    if (channelProduct.reviewClassification === CHANNEL_PRODUCT_REVIEW.OUT_OF_SCOPE) {
      channelProduct.reviewClassification = CHANNEL_PRODUCT_REVIEW.UNREVIEWED;
      channelProduct.reviewNote = null;
      channelProduct.reviewUpdatedAt = now;
    }

    pm.conflicts = pm.conflicts.filter(
      (c) => !(c.channelId === channelId && c.channelProductId === channelProductId)
    );

    appendMappingLog(db, {
      action: payload.logAction || 'manual_confirm',
      channelId,
      channelProductId,
      masterProductId,
      masterName: master.name,
      channelName: channelProduct.channelName
    });

    return { ok: true, mapping };
  }

  async function confirmMapping(payload) {
    await assertMatchingOperationsEnabled();
    const channelId = String(payload.channelId || 'uber-eats').trim();
    let channelProductId = String(payload.channelProductId || '').trim();
    const channelBarcode = String(payload.channelBarcode || payload.barcode || '').trim();
    let masterProductId = String(payload.masterProductId || '').trim();
    const channelName = String(payload.channelName || '').trim();

    if (!masterProductId && payload.masterBarcode) {
      const dbLookup = await readDb();
      const master = findMasterByBarcode(dbLookup, payload.masterBarcode);
      if (master?.id) masterProductId = master.id;
    }

    if (!channelProductId) {
      channelProductId = channelBarcode;
    }
    if (!channelProductId && channelName) {
      const slug = channelName
        .toLowerCase()
        .replace(/[^a-z0-9ğüşıöç]+/gi, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 56);
      if (slug) channelProductId = `order-name-${slug}`;
    }

    if (!channelProductId || !masterProductId) {
      const err = new Error('Eşleştirme için kanal ürünü ve BenimPOS master seçilmeli.');
      err.statusCode = 400;
      throw err;
    }

    const db = await readDb();
    const pm = getProductMatching(db);
    const result = applyManualConfirmMapping(db, pm, {
      ...payload,
      channelId,
      channelProductId,
      masterProductId,
      channelBarcode: channelBarcode || channelProductId,
      channelName: channelName || channelProductId,
      ensureChannelProduct: payload.ensureChannelProduct !== false
    });
    if (!result.ok) {
      if (result.reason === 'missing_master') throw new Error('Ana ürün bulunamadı.');
      if (result.reason === 'missing_channel_product') throw new Error('Kanal ürünü bulunamadı.');
      throw new Error('Eşleştirme onaylanamadı.');
    }

    const now = new Date().toISOString();
    db.meta = db.meta || {};
    db.meta.updatedAt = now;
    markWorkbenchStoresDirty(pm);
    await writeDb(db);
    return { ok: true, mapping: result.mapping };
  }

  async function confirmMappingsBulk(payload = {}) {
    await assertMatchingOperationsEnabled();
    const items = Array.isArray(payload.items)
      ? payload.items.map((item) => ({
        channelId: String(item.channelId || '').trim(),
        channelProductId: String(item.channelProductId || '').trim(),
        masterProductId: String(item.masterProductId || '').trim()
      })).filter((item) => item.channelId && item.channelProductId)
      : [];

    if (!items.length) {
      throw new Error('Onaylanacak kayıt seçilmedi.');
    }

    const cap = Math.min(items.length, 500);
    const db = await readDb();
    const pm = getProductMatching(db);
    const now = new Date().toISOString();
    let confirmed = 0;
    let skipped = 0;
    const touchedChannels = new Set();

    for (const item of items.slice(0, cap)) {
      let masterProductId = item.masterProductId;
      if (!masterProductId) {
        const existing = pm.mappings.find(
          (m) => m.channelId === item.channelId && m.channelProductId === item.channelProductId
        );
        masterProductId = String(existing?.masterProductId || '').trim();
      }
      if (!masterProductId) {
        skipped += 1;
        continue;
      }

      const result = applyManualConfirmMapping(db, pm, {
        ...item,
        masterProductId,
        now,
        confirmedBy: payload.confirmedBy || 'workbench_bulk',
        logAction: 'workbench_bulk_confirm'
      });
      if (!result.ok) {
        skipped += 1;
        continue;
      }
      confirmed += 1;
      touchedChannels.add(item.channelId);
    }

    for (const channelId of touchedChannels) {
      reEnrichPlaceholderChannelNames(pm, channelId);
    }

    if (confirmed > 0) {
      db.meta = db.meta || {};
      db.meta.updatedAt = now;
      markWorkbenchStoresDirty(pm);
      await writeDb(db);
    }

    return {
      ok: true,
      requested: items.length,
      processed: cap,
      confirmed,
      skipped
    };
  }

  async function confirmAutoMatchedBulk(payload = {}) {
    const channelId = String(payload.channelId || 'uber-eats').trim();
    const limit = Math.min(Math.max(Number(payload.limit) || 0, 0), 5000);

    const db = await readDb();
    const pm = getProductMatching(db);
    const now = new Date().toISOString();
    let confirmed = 0;
    let skipped = 0;

    const candidates = pm.mappings.filter(
      (m) => m.channelId === channelId
        && m.status === MAPPING_STATUS.AUTO_MATCHED
        && m.masterProductId
    );

    const toConfirm = limit > 0 ? candidates.slice(0, limit) : candidates;

    for (const mapping of toConfirm) {
      const master = pm.masterProducts.find((m) => m.id === mapping.masterProductId);
      if (!master) {
        skipped += 1;
        continue;
      }

      const channelProduct = pm.channelProducts.find(
        (cp) => cp.channelId === channelId && cp.channelProductId === mapping.channelProductId
      );

      if (channelProduct && isPlaceholderChannelName(channelProduct.channelName)) {
        channelProduct.channelName = master.name;
      }

      Object.assign(mapping, {
        status: MAPPING_STATUS.MANUAL_CONFIRMED,
        matchMethod: MATCH_METHOD.MANUAL,
        confidenceScore: 100,
        confirmedAt: now,
        confirmedBy: payload.confirmedBy || 'bulk_confirm',
        updatedAt: now
      });

      pm.conflicts = pm.conflicts.filter(
        (c) => !(c.channelId === channelId && c.channelProductId === mapping.channelProductId)
      );

      appendMappingLog(db, {
        action: 'bulk_manual_confirm',
        channelId,
        channelProductId: mapping.channelProductId,
        masterProductId: mapping.masterProductId,
        masterName: master.name,
        channelName: channelProduct?.channelName
      });

      confirmed += 1;
    }

    reEnrichPlaceholderChannelNames(pm, channelId);

    db.meta = db.meta || {};
    db.meta.updatedAt = now;
    await writeDb(db);

    return {
      ok: true,
      channelId,
      confirmed,
      skipped,
      remaining: candidates.length - confirmed
    };
  }

  async function autoMatchPerfectConfidence(payload = {}) {
    await assertMatchingOperationsEnabled();
    const minConfidence = Math.max(50, Math.min(100, Number(payload.minConfidence) || 95));
    const channelFilter = String(payload.channelId || '').trim();
    const { HZLMRKTOPS_BUYBOX_CHANNEL_IDS } = await import('../../hzlmrktops/constants.js');
    const channelIds = channelFilter ? [channelFilter] : [...HZLMRKTOPS_BUYBOX_CHANNEL_IDS];

    const db = await readDb();
    const pm = getProductMatching(db);
    const channelById = new Map(
      listSalesMatchingChannels().filter((c) => c.status !== 'planned').map((c) => [c.id, c])
    );
    const now = new Date().toISOString();
    let confirmed = 0;
    let skipped = 0;
    let scanned = 0;
    const byChannel = {};

    for (const channelId of channelIds) {
      const channel = channelById.get(channelId);
      if (!channel) continue;

      const barcodeLink = runBarcodeOnlyAutoMatchForChannel(db, channelId);
      let channelConfirmed = 0;

      // Barkod eşleşmesiyle oluşan auto_matched kayıtlar — isim uyarısı olsa da onayla
      for (const mapping of pm.mappings) {
        if (mapping.channelId !== channelId) continue;
        if (mapping.status !== MAPPING_STATUS.AUTO_MATCHED || !mapping.masterProductId) continue;
        const result = applyManualConfirmMapping(db, pm, {
          channelId,
          channelProductId: mapping.channelProductId,
          masterProductId: mapping.masterProductId,
          now,
          confirmedBy: payload.confirmedBy || 'auto_match_perfect',
          logAction: 'auto_match_barcode_confirm'
        });
        if (result.ok) {
          confirmed += 1;
          channelConfirmed += 1;
        }
      }

      const products = pm.channelProducts.filter((cp) => cp.channelId === channelId);
      const enrichedList = attachMappingToChannelProducts(db, channelId, products);
      const mappingIndex = buildMappingIndex(pm);

      for (const cp of enrichedList) {
        if (cp.mappingStatus === MAPPING_STATUS.MANUAL_CONFIRMED) continue;
        scanned += 1;
        const mapping = mappingIndex.get(`${channelId}:${cp.channelProductId}`) || null;
        const row = buildWorkbenchRow(db, pm, channel, cp, mapping);
        if (!row.canConfirm || !row.suggestedMasterProductId) {
          skipped += 1;
          continue;
        }
        if (Number(row.confidenceScore) < minConfidence) {
          skipped += 1;
          continue;
        }
        if (
          row.mappingStatus === MAPPING_STATUS.MISSING_MASTER
          || row.mappingStatus === MAPPING_STATUS.BARCODE_CONFLICT
          || row.masterLinkConflict
        ) {
          skipped += 1;
          continue;
        }

        const barcodeField = (row.compareFields || []).find((f) => f.key === 'barcode');
        const trustBarcode = mapping?.matchMethod === MATCH_METHOD.AUTO_BARCODE
          || row.mappingStatus === MAPPING_STATUS.AUTO_MATCHED
          || barcodeField?.state === 'match';
        const safeToConfirm = trustBarcode
          || (!row.suspicious && !(row.qualityFlags || []).length);
        if (!safeToConfirm) {
          skipped += 1;
          continue;
        }

        const result = applyManualConfirmMapping(db, pm, {
          channelId,
          channelProductId: cp.channelProductId,
          masterProductId: row.suggestedMasterProductId,
          now,
          confirmedBy: payload.confirmedBy || 'auto_match_perfect',
          logAction: 'auto_match_perfect_confirm'
        });
        if (result.ok) {
          confirmed += 1;
          channelConfirmed += 1;
        } else {
          skipped += 1;
        }
      }

      reEnrichPlaceholderChannelNames(pm, channelId);
      byChannel[channelId] = { barcodeLink, confirmed: channelConfirmed };
    }

    db.meta = db.meta || {};
    db.meta.updatedAt = now;
    db.meta.lastPerfectAutoMatch = { at: now, minConfidence, confirmed, byChannel };
    markWorkbenchStoresDirty(pm);
    await writeDb(db);

    return { ok: true, minConfidence, confirmed, skipped, scanned, byChannel };
  }

  async function confirmMarkup25Bulk(payload = {}) {
    const channelId = String(payload.channelId || 'uber-eats').trim();
    const limit = Math.min(Math.max(Number(payload.limit) || 0, 0), 5000);

    const db = await readDb();
    const report = buildPriceCompareReport(db, channelId, { status: 'review_required' });
    let candidates = report.rows.filter(
      (row) => row.masterProductId && isIntentionalUberMarkup(row)
    );
    if (limit > 0) candidates = candidates.slice(0, limit);

    let confirmed = 0;
    let failed = 0;
    for (const row of candidates) {
      try {
        await confirmMapping({
          channelId,
          channelProductId: row.channelProductId,
          masterProductId: row.masterProductId,
          confirmedBy: payload.confirmedBy || 'markup_25_rule'
        });
        confirmed += 1;
      } catch {
        failed += 1;
      }
    }

    return {
      ok: true,
      channelId,
      confirmed,
      failed,
      remaining: Math.max(0, report.summary.markup25ReviewCount - confirmed)
    };
  }

  async function removeMapping(payload) {
    const channelId = String(payload.channelId || 'uber-eats').trim();
    const channelProductId = String(payload.channelProductId || '').trim();
    const db = await readDb();
    const pm = getProductMatching(db);
    const idx = pm.mappings.findIndex(
      (m) => m.channelId === channelId && m.channelProductId === channelProductId
    );
    if (idx === -1) throw new Error('Eşleştirme bulunamadı.');

    const removed = pm.mappings.splice(idx, 1)[0];
    appendMappingLog(db, {
      action: 'remove_mapping',
      channelId,
      channelProductId,
      masterProductId: removed.masterProductId
    });

    db.meta = db.meta || {};
    db.meta.updatedAt = new Date().toISOString();
    markWorkbenchStoresDirty(pm);
    await writeDb(db);
    return { ok: true };
  }

  /** Ana ürün satırından kanal eşleştirmesini kaldır (onaylı kayıtlar dahil). */
  async function removeMasterChannelMapping(payload = {}) {
    const channelId = String(payload.channelId || 'getir').trim();
    const benimposBarcode = normalizeBarcode(payload.benimposBarcode || payload.barcode || '');
    const masterProductId = String(payload.masterProductId || '').trim();
    const db = await readDb();
    const pm = getProductMatching(db);

    const master = masterProductId
      ? pm.masterProducts.find((row) => row.id === masterProductId)
      : pm.masterProducts.find((row) => normalizeBarcode(row.benimposBarcode) === benimposBarcode);
    if (!master) throw new Error('Ana ürün bulunamadı.');

    const idx = pm.mappings.findIndex(
      (m) => m.channelId === channelId && m.masterProductId === master.id
    );
    if (idx === -1) throw new Error('Bu ürün için kayıtlı kanal eşleştirmesi yok.');

    const removed = pm.mappings.splice(idx, 1)[0];
    appendMappingLog(db, {
      action: 'remove_mapping',
      channelId,
      channelProductId: removed.channelProductId,
      masterProductId: removed.masterProductId,
      source: 'master_row'
    });

    db.meta = db.meta || {};
    db.meta.updatedAt = new Date().toISOString();
    markWorkbenchStoresDirty(pm);
    await writeDb(db);
    return {
      ok: true,
      channelId,
      channelProductId: removed.channelProductId,
      masterProductId: master.id
    };
  }

  async function removeMasterChannelMappingsBulk(payload = {}) {
    const channelId = String(payload.channelId || 'getir').trim();
    const barcodes = Array.isArray(payload.barcodes)
      ? [...new Set(payload.barcodes.map((value) => String(value || '').trim()).filter(Boolean))]
      : [];
    const masterProductIds = Array.isArray(payload.masterProductIds)
      ? [...new Set(payload.masterProductIds.map((value) => String(value || '').trim()).filter(Boolean))]
      : [];

    if (!barcodes.length && !masterProductIds.length) {
      throw new Error('Kaldırılacak ürün seçilmedi.');
    }

    const db = await readDb();
    const pm = getProductMatching(db);
    const targetMasterIds = new Set(masterProductIds);

    for (const barcode of barcodes) {
      const master = pm.masterProducts.find(
        (row) => normalizeBarcode(row.benimposBarcode) === normalizeBarcode(barcode)
      );
      if (master?.id) targetMasterIds.add(master.id);
    }

    let removed = 0;
    let notFound = 0;
    const now = new Date().toISOString();

    for (const masterId of [...targetMasterIds].slice(0, 200)) {
      const idx = pm.mappings.findIndex(
        (mapping) => mapping.channelId === channelId && mapping.masterProductId === masterId
      );
      if (idx === -1) {
        notFound += 1;
        continue;
      }
      const removedMapping = pm.mappings.splice(idx, 1)[0];
      appendMappingLog(db, {
        action: 'remove_mapping',
        channelId,
        channelProductId: removedMapping.channelProductId,
        masterProductId: removedMapping.masterProductId,
        source: 'master_row_bulk'
      });
      removed += 1;
    }

    if (removed > 0) {
      db.meta = db.meta || {};
      db.meta.updatedAt = now;
      markWorkbenchStoresDirty(pm);
      await writeDb(db);
    }

    return {
      ok: true,
      channelId,
      removed,
      notFound,
      requested: targetMasterIds.size
    };
  }

  async function removeChannelMappingsBulk(payload = {}) {
    const items = Array.isArray(payload.items)
      ? payload.items.map((item) => ({
        channelId: String(item.channelId || 'uber-eats').trim(),
        channelProductId: String(item.channelProductId || '').trim()
      })).filter((item) => item.channelId && item.channelProductId)
      : [];

    if (!items.length) {
      throw new Error('Kaldırılacak eşleştirme seçilmedi.');
    }

    const db = await readDb();
    const pm = getProductMatching(db);
    let removed = 0;
    let notFound = 0;

    for (const item of items.slice(0, 500)) {
      const idx = pm.mappings.findIndex(
        (m) => m.channelId === item.channelId && m.channelProductId === item.channelProductId
      );
      if (idx === -1) {
        notFound += 1;
        continue;
      }
      const removedMapping = pm.mappings.splice(idx, 1)[0];
      appendMappingLog(db, {
        action: 'remove_mapping',
        channelId: item.channelId,
        channelProductId: item.channelProductId,
        masterProductId: removedMapping.masterProductId,
        source: payload.source || 'workbench_bulk'
      });
      removed += 1;
    }

    if (removed > 0) {
      db.meta = db.meta || {};
      db.meta.updatedAt = new Date().toISOString();
      await writeDb(db);
    }

    return {
      ok: true,
      requested: items.length,
      removed,
      notFound
    };
  }

  async function masterPoolBulkAction(payload = {}) {
    const action = String(payload.action || '').trim();
    const masterProductIds = [...new Set(
      (Array.isArray(payload.masterProductIds) ? payload.masterProductIds : [])
        .map((id) => String(id || '').trim())
        .filter(Boolean)
    )];
    if (!masterProductIds.length) {
      throw new Error('En az bir ana ürün seçilmeli.');
    }

    const cappedIds = masterProductIds.slice(0, 200);
    const db = await readDb();

    if (action === 'confirm') {
      const items = buildMasterPoolBulkMappingItems(db, cappedIds, { mode: 'confirm' });
      if (!items.length) {
        return {
          ok: true,
          action,
          confirmed: 0,
          skipped: 0,
          message: 'Seçili ürünlerde onaylanacak eşleştirme bulunamadı.'
        };
      }
      const result = await confirmMappingsBulk({
        items,
        confirmedBy: 'master_pool_bulk'
      });
      return { ...result, action };
    }

    if (action === 'unmap') {
      const items = buildMasterPoolBulkMappingItems(db, cappedIds, { mode: 'unmap' });
      if (!items.length) {
        return {
          ok: true,
          action,
          removed: 0,
          message: 'Seçili ürünlerde kaldırılacak eşleştirme yok.'
        };
      }
      const result = await removeChannelMappingsBulk({
        items,
        source: 'master_pool_bulk'
      });
      return { ...result, action };
    }

    if (action === 'review') {
      return {
        ok: true,
        action,
        masterCount: cappedIds.length,
        redirect: buildProductPoolUrl('workbench', { tab: 'workbench', queueMode: 'manual_review' }),
        message: 'Manuel kontrol listesine yönlendirildi.'
      };
    }

    throw new Error('Desteklenmeyen toplu işlem.');
  }

  async function removeMappingsBulk(payload) {
    const channelId = String(payload.channelId || 'uber-eats').trim();
    const barcodes = Array.isArray(payload.barcodes)
      ? [...new Set(payload.barcodes.map((value) => String(value || '').trim()).filter(Boolean))]
      : [];
    if (!barcodes.length) {
      throw new Error('Kaldırılacak ürün barkodu yok.');
    }

    const db = await readDb();
    const pm = getProductMatching(db);
    const indexes = buildChannelLookupIndexes(db, channelId);
    const channelProductIds = new Set();
    const matchedBarcodes = new Set();

    for (const barcode of barcodes) {
      const mapping = findMappingForChannelLine(db, channelId, barcode, indexes);
      if (mapping?.channelProductId) {
        channelProductIds.add(mapping.channelProductId);
        matchedBarcodes.add(barcode);
        continue;
      }

      const master = pm.masterProducts.find((row) => normalizeBarcode(row.benimposBarcode) === normalizeBarcode(barcode));
      const byMaster = master
        ? pm.mappings.find((row) => row.channelId === channelId && row.masterProductId === master.id)
        : null;
      if (byMaster?.channelProductId) {
        channelProductIds.add(byMaster.channelProductId);
        matchedBarcodes.add(barcode);
      }
    }

    let removed = 0;
    const removedBarcodes = [];

    for (const channelProductId of channelProductIds) {
      const idx = pm.mappings.findIndex(
        (mapping) => mapping.channelId === channelId && mapping.channelProductId === channelProductId
      );
      if (idx === -1) continue;

      const removedMapping = pm.mappings.splice(idx, 1)[0];
      appendMappingLog(db, {
        action: 'remove_mapping',
        channelId,
        channelProductId,
        masterProductId: removedMapping.masterProductId,
        source: 'bulk_loss_products'
      });
      removed += 1;
      if (removedMapping.channelBarcode) {
        removedBarcodes.push(String(removedMapping.channelBarcode));
      }
    }

    if (removed > 0) {
      db.meta = db.meta || {};
      db.meta.updatedAt = new Date().toISOString();
      await writeDb(db);
    }

    return {
      ok: true,
      channelId,
      requested: barcodes.length,
      matched: matchedBarcodes.size,
      removed,
      notFound: barcodes.length - matchedBarcodes.size,
      removedBarcodes
    };
  }

  const SYSTEM_MAPPING_CONFIRMED_BY = new Set([
    'bulk_confirm',
    'workbench_bulk',
    'markup_25_rule',
    'auto_match'
  ]);

  function isSystemGeneratedMapping(mapping) {
    const method = String(mapping?.matchMethod || '').trim();
    if (method === MATCH_METHOD.AUTO_BARCODE || method === MATCH_METHOD.AUTO_FUZZY) {
      return true;
    }
    if (mapping?.status === MAPPING_STATUS.MISSING_MASTER) {
      return true;
    }
    const confirmedBy = String(mapping?.confirmedBy || '').trim();
    if (!confirmedBy || confirmedBy === 'none') {
      return true;
    }
    return SYSTEM_MAPPING_CONFIRMED_BY.has(confirmedBy);
  }

  async function clearSystemMappings(payload = {}) {
    const channelId = String(payload.channelId || '').trim();
    const keepUserConfirmed = payload.keepUserConfirmed !== false;
    const db = await readDb();
    const pm = getProductMatching(db);
    const before = pm.mappings.length;
    const removedMappings = [];

    pm.mappings = pm.mappings.filter((mapping) => {
      if (channelId && mapping.channelId !== channelId) {
        return true;
      }
      if (keepUserConfirmed && String(mapping.confirmedBy || '').trim() === 'user') {
        return true;
      }
      if (!isSystemGeneratedMapping(mapping)) {
        return true;
      }
      removedMappings.push(mapping);
      return false;
    });

    for (const mapping of removedMappings.slice(0, 5000)) {
      appendMappingLog(db, {
        action: 'remove_mapping',
        channelId: mapping.channelId,
        channelProductId: mapping.channelProductId,
        masterProductId: mapping.masterProductId,
        source: payload.source || 'clear_system_mappings'
      });
    }

    if (removedMappings.length > 0) {
      db.meta = db.meta || {};
      db.meta.updatedAt = new Date().toISOString();
      await writeDb(db);
    }

    return {
      ok: true,
      channelId: channelId || null,
      before,
      removed: removedMappings.length,
      remaining: pm.mappings.length,
      keptUserConfirmed: keepUserConfirmed
    };
  }

  async function getCleanupSuggestions(options = {}) {
    const db = await readDb();
    return buildCleanupSuggestions(db, options);
  }

  async function applyCleanupSuggestions(payload = {}) {
    const db = await readDb();
    const pm = getProductMatching(db);
    const report = buildCleanupSuggestions(db, { limit: 200, channelId: payload.channelId });
    const requestedIds = payload.all
      ? report.items.map((row) => row.id)
      : (Array.isArray(payload.suggestionIds) ? payload.suggestionIds : []);
    const idSet = new Set(requestedIds.map((value) => String(value || '').trim()).filter(Boolean));

    if (!idSet.size) {
      throw new Error('Kaldırılacak öneri seçilmedi.');
    }

    let removed = 0;
    const removedBarcodes = [];

    for (const item of report.items) {
      if (!idSet.has(item.id)) continue;
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
        source: 'cleanup_suggestion'
      });
      removed += 1;
      if (item.benimposBarcode) removedBarcodes.push(item.benimposBarcode);
    }

    if (removed > 0) {
      markWorkbenchStoresDirty(pm);
      db.meta = db.meta || {};
      db.meta.updatedAt = new Date().toISOString();
      await writeDb(db);
    }

    return {
      ok: true,
      removed,
      requested: idSet.size,
      removedBarcodes
    };
  }

  async function dismissCleanupSuggestionsRequest(payload = {}) {
    const db = await readDb();
    const pm = getProductMatching(db);
    const ids = payload.all
      ? buildCleanupSuggestions(db, { limit: 200, channelId: payload.channelId }).items.map((row) => row.id)
      : (Array.isArray(payload.suggestionIds) ? payload.suggestionIds : []);

    const result = dismissCleanupSuggestions(pm, ids);
    if (result.dismissed > 0) {
      db.meta = db.meta || {};
      db.meta.updatedAt = new Date().toISOString();
      await writeDb(db);
    }

    return { ok: true, ...result };
  }

  async function getReports(channelId = 'uber-eats') {
    const db = await readDb();
    return buildMatchingReports(db, channelId);
  }

  async function listMappingLogs(limit = 50) {
    const db = await readDb();
    const pm = getProductMatching(db);
    const cap = Math.min(200, limit);
    const combined = [
      ...(pm.orderMappingLogs || []).map((row) => ({ ...row, logType: 'order' })),
      ...(pm.mappingLogs || []).map((row) => ({ ...row, logType: 'mapping' }))
    ].sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
    return { rows: combined.slice(0, cap) };
  }

  async function findMasterByBarcode(barcode) {
    const db = await readDb();
    const result = findMasterByBarcodeKeys(getProductMatching(db).masterProducts, barcode);
    if (!result || result.conflict) return null;
    return result.master;
  }

  async function searchMasters(q, limit = 20) {
    const db = await readDb();
    const query = String(q || '').trim().toLowerCase();
    if (!query) return { rows: [] };

    const rows = getProductMatching(db).masterProducts
      .filter((m) =>
        String(m.name || '').toLowerCase().includes(query)
        || String(m.benimposBarcode || '').includes(query)
      )
      .slice(0, limit);

    return { rows };
  }

  async function listMissingMasterReview(channelId = 'uber-eats', searchParams = {}) {
    const db = await readDb();
    const filters = {
      onSale: searchParams.get?.('onSale') ?? searchParams.onSale
    };
    const allRows = buildMissingMasterReviewRows(db, channelId);
    const rows = buildMissingMasterReviewRows(db, channelId, filters);
    const summary = summarizeReviewRows(allRows);

    return {
      channelId,
      total: rows.length,
      totalUnfiltered: allRows.length,
      byClassification: summary.byClassification,
      bySuggestion: summary.bySuggestion,
      byOnSale: summary.byOnSale,
      labels: CHANNEL_PRODUCT_REVIEW_LABELS,
      rows
    };
  }

  async function applyMissingMasterSuggestions(payload = {}) {
    const channelId = String(payload.channelId || 'uber-eats').trim();
    const minConfidence = Math.max(50, Number(payload.minConfidence) || 70);
    const onlyUnreviewed = payload.onlyUnreviewed !== false;

    const db = await readDb();
    const pm = getProductMatching(db);
    const rows = buildMissingMasterReviewRows(db, channelId);
    const now = new Date().toISOString();
    let applied = 0;
    const appliedRows = [];

    for (const row of rows) {
      if (onlyUnreviewed && row.reviewClassification !== CHANNEL_PRODUCT_REVIEW.UNREVIEWED) {
        continue;
      }
      const sug = row.suggestion;
      if (!sug || (sug.confidence || 0) < minConfidence) continue;

      const cp = pm.channelProducts.find(
        (item) => item.channelId === channelId && item.channelProductId === row.channelProductId
      );
      if (!cp) continue;

      cp.reviewClassification = sug.suggestedClassification;
      cp.reviewNote = sug.suggestedNote || '';
      cp.reviewUpdatedAt = now;
      applied += 1;
      appliedRows.push({
        channelProductId: row.channelProductId,
        channelBarcode: row.channelBarcode,
        reviewClassification: cp.reviewClassification,
        confidence: sug.confidence
      });
    }

    if (applied > 0) {
      appendMappingLog(db, {
        action: 'missing_master_bulk_suggest',
        channelId,
        applied,
        minConfidence
      });
      db.meta = db.meta || {};
      db.meta.updatedAt = now;
      await writeDb(db);
    }

    return { ok: true, applied, minConfidence, rows: appliedRows };
  }

  async function saveMissingMasterReview(payload) {
    const channelId = String(payload.channelId || 'uber-eats').trim();
    const channelProductId = String(payload.channelProductId || '').trim();
    const reviewClassification = String(payload.reviewClassification || '').trim();
    const reviewNote = String(payload.reviewNote || '').trim();

    if (!channelProductId) {
      throw new Error('channelProductId zorunlu.');
    }
    if (!Object.values(CHANNEL_PRODUCT_REVIEW).includes(reviewClassification)) {
      throw new Error('Geçersiz inceleme sınıfı.');
    }

    const db = await readDb();
    const pm = getProductMatching(db);
    const cp = pm.channelProducts.find(
      (row) => row.channelId === channelId && row.channelProductId === channelProductId
    );
    if (!cp) {
      throw new Error('Kanal ürünü bulunamadı.');
    }

    const now = new Date().toISOString();
    cp.reviewClassification = reviewClassification;
    cp.reviewNote = reviewNote;
    cp.reviewUpdatedAt = now;

    appendMappingLog(db, {
      action: 'missing_master_review',
      channelId,
      channelProductId,
      channelName: cp.channelName,
      reviewClassification,
      reviewNote
    });

    db.meta = db.meta || {};
    db.meta.updatedAt = now;
    await writeDb(db);

    return {
      ok: true,
      channelProductId,
      reviewClassification,
      reviewNote,
      reviewUpdatedAt: now
    };
  }

  async function listPriceCompare(channelId = 'uber-eats', searchParams = {}) {
    const db = await readDb();
    const filters = {
      q: searchParams.get?.('q') ?? searchParams.q,
      status: searchParams.get?.('status') ?? searchParams.status,
      match: searchParams.get?.('match') ?? searchParams.match,
      diff: searchParams.get?.('diff') ?? searchParams.diff,
      onSale: searchParams.get?.('onSale') ?? searchParams.onSale,
      sort: searchParams.get?.('sort') ?? searchParams.sort
    };
    const report = buildPriceCompareReport(db, channelId, filters);
    const page = Number(searchParams.get?.('page') ?? searchParams.page) || 1;
    const limit = Number(searchParams.get?.('limit') ?? searchParams.limit) || 100;
    const paged = paginateRows(report.rows, page, limit);

    return {
      ok: true,
      summary: report.summary,
      masterMultiUber: report.masterMultiUber,
      searchHint: report.searchHint || null,
      ...paged
    };
  }

  async function setPrimaryMapping(payload = {}) {
    const channelId = String(payload.channelId || 'uber-eats').trim();
    const masterProductId = String(payload.masterProductId || '').trim();
    const channelProductId = String(payload.channelProductId || '').trim();

    if (!masterProductId || !channelProductId) {
      throw new Error('masterProductId ve channelProductId zorunlu.');
    }

    const db = await readDb();
    const pm = getProductMatching(db);
    const target = pm.mappings.find(
      (m) => m.channelId === channelId
        && m.channelProductId === channelProductId
        && m.masterProductId === masterProductId
    );
    if (!target) {
      throw new Error('Eşleştirme bulunamadı.');
    }

    for (const mapping of pm.mappings) {
      if (mapping.channelId === channelId && mapping.masterProductId === masterProductId) {
        mapping.salesPrimary = mapping.channelProductId === channelProductId;
        mapping.updatedAt = new Date().toISOString();
      }
    }

    appendMappingLog(db, {
      action: 'set_sales_primary',
      channelId,
      channelProductId,
      masterProductId,
      masterName: pm.masterProducts.find((m) => m.id === masterProductId)?.name
    });

    db.meta = db.meta || {};
    db.meta.updatedAt = new Date().toISOString();
    await writeDb(db);

    return { ok: true, channelProductId, masterProductId, salesPrimary: true };
  }

  const WORKBENCH_STATUSES = new Set([
    'unmapped',
    'auto_matched',
    'pending',
    'review_required',
    'barcode_conflict',
    'missing_master'
  ]);

  function matchMethodLabel(method, reasons = []) {
    if (method === MATCH_METHOD.AUTO_BARCODE) return 'Barkod aynı';
    if (method === MATCH_METHOD.AUTO_FUZZY) return 'İsim / gramaj benzerliği';
    if (method === MATCH_METHOD.MANUAL) return 'Manuel';
    if (reasons.length) return reasons[0];
    return '—';
  }

  function compareFieldState(channelVal, masterVal) {
    const c = String(channelVal ?? '').trim();
    const m = String(masterVal ?? '').trim();
    if (!c && !m) return 'missing';
    if (!c || !m) return 'missing';
    if (c.toLowerCase() === m.toLowerCase()) return 'match';
    return 'diff';
  }

  function barcodeCompareField(cp, masterBarcode) {
    const master = normalizeBarcode(masterBarcode);
    const codes = channelProductBarcodes(cp);
    const matched = master ? codes.find((code) => barcodesEquivalent(code, master)) : null;
    const display = matched || cp.channelBarcode || codes[0] || '';
    if (!master || !display) {
      return { channel: display, state: 'missing' };
    }
    if (matched) {
      return { channel: matched, state: 'match' };
    }
    return { channel: cp.channelBarcode || display, state: 'diff' };
  }

  function buildWorkbenchCompareFields(cp, master, channelPrice) {
    const channelName = cp.channelDisplayName || cp.channelName || '';
    const barcodeField = barcodeCompareField(cp, master.benimposBarcode);
    return [
      { key: 'name', label: 'Ürün adı', channel: channelName, master: master.name || '', state: compareFieldState(channelName, master.name) },
      { key: 'barcode', label: 'Barkod', channel: barcodeField.channel, master: master.benimposBarcode || '', state: barcodeField.state },
      { key: 'weight', label: 'Gramaj', channel: cp.normalizedWeightG ? `${cp.normalizedWeightG}g` : '', master: master.normalizedWeightG ? `${master.normalizedWeightG}g` : '', state: compareFieldState(cp.normalizedWeightG, master.normalizedWeightG) },
      { key: 'brand', label: 'Marka', channel: cp.brand || '', master: master.brand || master.categoryName || '', state: compareFieldState(cp.brand, master.brand || master.categoryName) },
      { key: 'variant', label: 'Varyant', channel: cp.variantKey || '', master: master.variantKey || '', state: compareFieldState(cp.variantKey, master.variantKey) },
      { key: 'stockCode', label: 'Stok kodu', channel: cp.stockCode || cp.channelProductId || '', master: master.stockCode || '', state: compareFieldState(cp.stockCode || cp.channelProductId, master.stockCode) },
      { key: 'category', label: 'Kategori', channel: cp.categoryName || '', master: master.categoryName || '', state: compareFieldState(cp.categoryName, master.categoryName) },
      { key: 'price', label: 'Satış fiyatı', channel: channelPrice > 0 ? String(channelPrice) : '', master: Number(master.salePrice1) > 0 ? String(master.salePrice1) : '', state: compareFieldState(channelPrice, master.salePrice1) }
    ];
  }

  function confidenceLevelFromScore(score) {
    const n = Number(score);
    if (!Number.isFinite(n)) return 'unknown';
    if (n >= 88) return 'high';
    if (n >= 55) return 'medium';
    return 'low';
  }

  function buildConfidenceBreakdown(cp, master, mapping, compareFields, nameSimilarityPct) {
    const items = [];
    const barcode = compareFields.find((f) => f.key === 'barcode');
    if (mapping?.matchMethod === MATCH_METHOD.AUTO_BARCODE || barcode?.state === 'match') {
      items.push({ label: 'Barkod birebir', points: 60 });
    }
    const brand = compareFields.find((f) => f.key === 'brand');
    if (brand?.state === 'match') items.push({ label: 'Marka uyumu', points: 15 });
    const weight = compareFields.find((f) => f.key === 'weight');
    if (weight?.state === 'match') items.push({ label: 'Gramaj uyumu', points: 15 });
    if (nameSimilarityPct != null && nameSimilarityPct >= 55) {
      items.push({ label: 'İsim benzerliği', points: 10 });
    } else if (nameSimilarityPct != null && nameSimilarityPct >= 35) {
      items.push({ label: 'İsim benzerliği (düşük)', points: 5 });
    }
    if (!items.length && barcode?.state === 'diff') {
      items.push({ label: 'Barkod farklı', points: -20 });
    }
    return items;
  }

  function buildSystemComment(row, compareFields, nameSimilarityPct) {
    const parts = [];
    const barcode = compareFields.find((f) => f.key === 'barcode');
    const brand = compareFields.find((f) => f.key === 'brand');
    const weight = compareFields.find((f) => f.key === 'weight');
    if (row.mappingStatus === 'missing_master') {
      return 'BenimPOS havuzunda barkod bulunamadı. Ana ürün oluşturun veya farklı barkodla eşleştirin.';
    }
    if (row.masterLinkConflict) {
      return 'Birden fazla BenimPOS adayı var. Doğru ürünü manuel seçin.';
    }
    if (barcode?.state === 'match') parts.push('Barkod birebir eşleşti');
    else if (barcode?.state === 'diff') parts.push('Barkod farklı');
    if (brand?.state === 'match') parts.push('marka uyumlu');
    if (weight?.state === 'match') parts.push('gramaj uyumlu');
    else if (weight?.state === 'diff') parts.push('gramaj farklı');
    if (nameSimilarityPct != null && nameSimilarityPct >= 55) parts.push('ürün adı benzer');
    const score = Number(row.confidenceScore);
    if (Number.isFinite(score) && score >= 88 && !row.suspicious) {
      return `${parts.join('. ')}${parts.length ? '.' : ''} Güvenli onay önerilir.`;
    }
    if (row.suspicious || (Number.isFinite(score) && score < 55)) {
      return `${parts.join('. ')}${parts.length ? '.' : ''} Manuel kontrol önerilir.`;
    }
    return `${parts.join('. ')}${parts.length ? '.' : ''} Karar öncesi alanları kontrol edin.`;
  }

  function passesInboxQueueFilter(row, filter) {
    if (!filter || filter === 'all') return true;
    if (filter === 'high_confidence') {
      return row.canConfirm && Number(row.confidenceScore) >= 88 && !row.suspicious && !(row.qualityFlags || []).length;
    }
    if (filter === 'manual_review') {
      return row.suspicious
        || row.mappingStatus === MAPPING_STATUS.REVIEW_REQUIRED
        || (row.canConfirm && Number(row.confidenceScore) < 88);
    }
    if (filter === 'missing_master') return row.mappingStatus === MAPPING_STATUS.MISSING_MASTER;
    if (filter === 'multi_candidate') return Boolean(row.masterLinkConflict);
    if (filter === 'barcode_diff') {
      const bf = (row.compareFields || []).find((f) => f.key === 'barcode');
      return bf?.state === 'diff';
    }
    if (filter === 'data_gap') return (row.masterDataIssues || []).length > 0;
    return true;
  }

  const WORKBENCH_SUSPICIOUS_FLAGS = new Set([
    'gramaj_farkli',
    'isim_uyusmazligi',
    'varyant_farkli',
    'paket_tipi_farkli'
  ]);
  /** Onaylı eşleştirmede Uber ↔ Ana Havuz fiyatı bu band içindeyse genelde doğru eşleşmedir. */
  const WORKBENCH_CONFIRMED_PRICE_TOLERANCE_PCT = 50;

  function masterCompareSalePrice(master) {
    if (!master) return null;
    const sale = Number(master.salePrice1);
    if (Number.isFinite(sale) && sale > 1) return Math.round(sale * 100) / 100;
    const buy = Number(master.buyingPrice);
    if (Number.isFinite(buy) && buy > 0) return Math.round(buy * 100) / 100;
    return null;
  }

  function evaluateConfirmedMappingSuspicion(master, channelPrice, nameFlags, confidenceScore) {
    const masterPrice = masterCompareSalePrice(master);
    const uberPrice = channelPrice != null && Number(channelPrice) > 0
      ? Math.round(Number(channelPrice) * 100) / 100
      : null;
    const priceDiffPct = masterPrice && uberPrice
      ? priceDiffPercent(uberPrice, masterPrice)
      : null;

    if (priceDiffPct != null && Math.abs(priceDiffPct) <= WORKBENCH_CONFIRMED_PRICE_TOLERANCE_PCT) {
      return { suspicious: false, qualityFlags: [], priceDiffPct, masterComparePrice: masterPrice };
    }
    if (priceDiffPct != null && Math.abs(priceDiffPct) > WORKBENCH_CONFIRMED_PRICE_TOLERANCE_PCT) {
      const flags = ['fiyat_uyusmazligi'];
      if (nameFlags.length) flags.push(nameFlags[0]);
      return { suspicious: true, qualityFlags: flags, priceDiffPct, masterComparePrice: masterPrice };
    }
    const suspicious = nameFlags.length > 0 && confidenceScore != null && confidenceScore < 40;
    return {
      suspicious,
      qualityFlags: suspicious ? nameFlags.slice(0, 2) : [],
      priceDiffPct,
      masterComparePrice: masterPrice
    };
  }

  function resolveWorkbenchSuggestion(db, pm, cp, mapping) {
    let masterLinkConflict = Boolean(cp.masterLinkConflict);

    const barcodeProposal = proposeMatchForChannelProduct(cp, pm.masterProducts);
    if (barcodeProposal.status === MAPPING_STATUS.BARCODE_CONFLICT) {
      return {
        suggestedMasterProductId: null,
        suggestedMasterName: null,
        confidenceScore: 0,
        suggestionReason: 'Aynı barkodda birden fazla BenimPOS ürünü',
        masterLinkConflict: true
      };
    }
    if (barcodeProposal.masterProductId && barcodeProposal.status === MAPPING_STATUS.AUTO_MATCHED) {
      return {
        suggestedMasterProductId: barcodeProposal.masterProductId,
        suggestedMasterName: barcodeProposal.masterProductName || null,
        confidenceScore: barcodeProposal.confidenceScore,
        suggestionReason: 'Barkod eşleşmesi',
        masterLinkConflict: false
      };
    }

    let suggestedMasterProductId = cp.masterProductId || mapping?.masterProductId || null;
    let suggestedMasterName = cp.masterProductName || null;
    let confidenceScore = cp.confidenceScore ?? mapping?.confidenceScore ?? null;
    let suggestionReason = matchMethodLabel(mapping?.matchMethod, mapping?.reasons || cp.mappingReasons);

    if (!suggestedMasterProductId && !masterLinkConflict) {
      if (barcodeProposal.masterProductId) {
        suggestedMasterProductId = barcodeProposal.masterProductId;
        suggestedMasterName = barcodeProposal.masterProductName || null;
        confidenceScore = barcodeProposal.confidenceScore;
        suggestionReason = barcodeProposal.reasons?.[0] || 'Barkod eşleşmesi';
      } else {
        const fuzzy = proposeFuzzyMatchForChannelProduct(cp, pm.masterProducts);
        if (fuzzy?.masterProductId) {
          suggestedMasterProductId = fuzzy.masterProductId;
          suggestedMasterName = fuzzy.masterProductName || null;
          confidenceScore = fuzzy.confidenceScore;
          suggestionReason = 'İsim benzerliği';
        } else {
          const review = suggestMissingMasterReview(cp, pm.masterProducts);
          if (review.candidateMaster?.masterProductId) {
            suggestedMasterProductId = review.candidateMaster.masterProductId;
            suggestedMasterName = review.candidateMaster.name || null;
            confidenceScore = review.confidence;
            suggestionReason = review.suggestedNote || review.reason || 'Öneri';
          } else if (Array.isArray(review.candidates) && review.candidates.length === 1) {
            suggestedMasterProductId = review.candidates[0].masterProductId;
            suggestedMasterName = review.candidates[0].name || null;
            confidenceScore = review.confidence;
            suggestionReason = review.suggestedNote || review.reason || 'Öneri';
          }
        }
      }
    }

    return {
      suggestedMasterProductId,
      suggestedMasterName,
      confidenceScore,
      suggestionReason,
      masterLinkConflict
    };
  }

  function buildWorkbenchRow(db, pm, channel, cp, mapping) {
    const suggestion = resolveWorkbenchSuggestion(db, pm, cp, mapping);
    let suggestedMasterProductId = suggestion.suggestedMasterProductId;
    let suggestedMasterName = suggestion.suggestedMasterName;
    let confidenceScore = suggestion.confidenceScore;
    let suggestionReason = suggestion.suggestionReason;
    const masterLinkConflict = suggestion.masterLinkConflict || cp.masterLinkConflict;
    const suggestionRecovered = cp.masterLinkSource === 'barcode_lookup'
      && Boolean(suggestedMasterProductId)
      && (mapping?.status === 'missing_master' || !mapping?.masterProductId);

    const master = suggestedMasterProductId
      ? pm.masterProducts.find((row) => row.id === suggestedMasterProductId)
      : null;

    if (suggestionRecovered && master) {
      const evaluation = evaluateChannelToMasterMatch(
        { ...cp, channelName: cp.channelDisplayName || cp.channelName },
        master,
        { trustExactBarcode: true }
      );
      confidenceScore = evaluation.confidenceScore;
      suggestionReason = 'Barkod aynı · havuzdan bulundu';
    } else if (master && mapping?.status === MAPPING_STATUS.MANUAL_CONFIRMED) {
      const evaluation = evaluateChannelToMasterMatch(
        { ...cp, channelName: cp.channelDisplayName || cp.channelName },
        master,
        { trustExactBarcode: mapping?.matchMethod === MATCH_METHOD.AUTO_BARCODE }
      );
      confidenceScore = evaluation.confidenceScore;
    }

    const nameQualityFlags = master && mapping
      ? evaluateChannelToMasterMatch(
        { ...cp, channelName: cp.channelDisplayName || cp.channelName },
        master,
        { trustExactBarcode: mapping?.matchMethod === MATCH_METHOD.AUTO_BARCODE }
      ).reasons.filter((flag) => WORKBENCH_SUSPICIOUS_FLAGS.has(flag))
      : [];

    const channelPrice = cp.lastUnitPrice ?? channelSalePriceFromProduct(cp, cp.channelId, db);
    let qualityFlags = nameQualityFlags;
    let suspicious;
    let priceDiffPct = null;
    let masterComparePrice = null;

    if (mapping?.status === MAPPING_STATUS.MANUAL_CONFIRMED && master) {
      const priceReview = evaluateConfirmedMappingSuspicion(
        master,
        channelPrice,
        nameQualityFlags,
        confidenceScore
      );
      qualityFlags = priceReview.qualityFlags;
      suspicious = priceReview.suspicious;
      priceDiffPct = priceReview.priceDiffPct;
      masterComparePrice = priceReview.masterComparePrice;
    } else if (master) {
      masterComparePrice = masterCompareSalePrice(master);
      if (masterComparePrice && channelPrice > 0) {
        priceDiffPct = priceDiffPercent(channelPrice, masterComparePrice);
      }
      suspicious = nameQualityFlags.length > 0 || (confidenceScore != null && confidenceScore < 55);
      qualityFlags = nameQualityFlags;
    } else {
      suspicious = nameQualityFlags.length > 0 || (confidenceScore != null && confidenceScore < 55);
      qualityFlags = nameQualityFlags;
    }

    const canConfirm = Boolean(
      suggestedMasterProductId
      && !masterLinkConflict
      && cp.mappingStatus !== MAPPING_STATUS.MANUAL_CONFIRMED
    );

    const compareFields = master
      ? buildWorkbenchCompareFields(cp, master, channelPrice)
      : [];

    const channelNameForSim = cp.channelDisplayName || cp.channelName || '';
    const nameSimilarityPct = master && channelNameForSim
      ? Math.round(nameSimilarityScore(channelNameForSim, master.name || ''))
      : null;

    const masterDataIssues = master ? masterDataQualityIssueCodes(masterQualityFlags(master)) : [];
    const confidenceBreakdown = master
      ? buildConfidenceBreakdown(cp, master, mapping, compareFields, nameSimilarityPct)
      : [];
    const confidenceLevel = confidenceLevelFromScore(confidenceScore);
    const systemComment = buildSystemComment(
      {
        mappingStatus: cp.mappingStatus,
        masterLinkConflict: cp.masterLinkConflict,
        confidenceScore,
        suspicious
      },
      compareFields,
      nameSimilarityPct
    );

    let estimatedProfitPct = null;
    if (master && channelPrice > 0 && Number(master.buyingPrice) > 0) {
      estimatedProfitPct = Math.round(((channelPrice - master.buyingPrice) / master.buyingPrice) * 1000) / 10;
    }

    const priceDiffAbs = masterComparePrice && channelPrice > 0
      ? Math.round((channelPrice - masterComparePrice) * 100) / 100
      : null;

    const channelNameForHints = cp.channelDisplayName || cp.channelName || '';
    const parsedNameHints = master && channelNameForHints
      ? parseChannelNameHints(channelNameForHints).filter((hint) => {
        if (hint.field === 'gramaj' && master.normalizedWeightG) return false;
        if (hint.field === 'marka' && (master.brand || master.categoryName)) return false;
        if (hint.field === 'varyant' && master.variantKey) return false;
        return true;
      })
      : [];

    return {
      channelId: cp.channelId,
      channelLabel: channel.label,
      channelProductId: cp.channelProductId,
      channelName: cp.channelDisplayName || cp.channelName,
      channelBarcode: cp.channelBarcode || '',
      salePrice: channelPrice,
      masterComparePrice,
      priceDiffPct,
      priceDiffAbs,
      channelImageUrl: cp.channelImageUrl || cp.imageUrl || cp.catalogImageUrl || null,
      channelSku: cp.stockCode || cp.channelProductId || '',
      parsedNameHints,
      mappingStatus: cp.mappingStatus,
      mappingId: cp.mappingId,
      suggestedMasterProductId,
      suggestedMasterName,
      linkedMasterBarcode: master?.benimposBarcode || '',
      masterBuyingPrice: master?.buyingPrice ?? null,
      matchMethod: mapping?.matchMethod || null,
      suggestionReason,
      suggestionRecovered,
      masterLinkConflict,
      confidenceScore: masterLinkConflict ? 0 : confidenceScore,
      reviewClassification: cp.reviewClassification || null,
      qualityFlags,
      suspicious,
      canConfirm,
      compareFields,
      masterBrand: master?.brand || master?.categoryName || '',
      masterWeightG: master?.normalizedWeightG ?? null,
      masterVariant: master?.variantKey || '',
      masterStockCode: master?.stockCode || '',
      masterStock: master?.stock ?? null,
      masterSalePrice: master?.salePrice1 ?? null,
      masterCategory: master?.categoryName || '',
      channelBrand: cp.brand || '',
      channelVariant: cp.variantKey || '',
      channelWeightG: cp.normalizedWeightG ?? null,
      channelStockCode: cp.stockCode || cp.channelProductId || '',
      channelCategory: cp.categoryName || '',
      masterDataIssues,
      nameSimilarityPct,
      confidenceLevel,
      confidenceBreakdown,
      systemComment,
      estimatedProfitPct
    };
  }

  function passesWorkbenchQualityFilter(row, qualityFilter) {
    if (!qualityFilter || qualityFilter === 'all') return true;
    if (qualityFilter === 'suspicious') return row.suspicious;
    if (qualityFilter === 'confirmable') return row.canConfirm;
    if (qualityFilter === 'recovered') return row.suggestionRecovered;
    if (qualityFilter === 'ok') return !row.suspicious;
    return true;
  }

  async function getOpsSummary() {
    const db = await readDb();
    const pm = getProductMatching(db);
    const activeChannels = listSalesMatchingChannels().filter((c) => c.status !== 'planned');

    const confirmedMasterIds = new Set();
    for (const mapping of pm.mappings) {
      if (mapping.status === MAPPING_STATUS.MANUAL_CONFIRMED && mapping.masterProductId) {
        confirmedMasterIds.add(mapping.masterProductId);
      }
    }

    let unmatchedChannelProducts = 0;
    let multiCandidate = 0;
    let pendingMatch = 0;
    let bulkConfirmable = 0;

    const storedIndex = getStoredWorkbenchIndex(pm);
    if (isWorkbenchIndexFresh(pm, storedIndex, { queue: 'action' })) {
      pendingMatch = storedIndex.total;
      bulkConfirmable = storedIndex.safeConfirmable;
      unmatchedChannelProducts = storedIndex.unmatchedChannelProducts;
      multiCandidate = storedIndex.multiCandidate;
    } else {
      const lite = collectWorkbenchLiteCandidates(db, pm, {
        channelFilter: '',
        q: '',
        statusFilter: '',
        confirmedQueue: false,
        activeChannels
      });
      pendingMatch = lite.candidates.length;
      bulkConfirmable = lite.safeConfirmable;
      unmatchedChannelProducts = lite.unmatchedChannelProducts;
      multiCandidate = lite.multiCandidate;
    }

    const notInBenimpos = pm.mappings.filter((m) =>
      m.status === MAPPING_STATUS.MISSING_MASTER
    ).length;

    const costlessProducts = pm.masterProducts.filter((row) => Number(row.buyingPrice) <= 0).length;
    const negativeStockProducts = pm.masterProducts.filter((row) => Number(row.stock) < 0).length;
    const missingMetaProducts = pm.masterProducts.filter((row) =>
      !row.normalizedWeightG || !row.variantKey
    ).length;
    const missingNameProducts = pm.masterProducts.filter((row) => masterHasNameIssue(row)).length;

    const dataIssueMasters = pm.masterProducts.filter((row) => {
      const flags = masterQualityFlags(row);
      return flags.missingName || flags.negativeStock || flags.missingCost || flags.missingMeta;
    }).length;

    return {
      masterTotal: pm.masterProducts.length,
      matchedMasters: confirmedMasterIds.size,
      unmatchedChannelProducts,
      notInBenimpos,
      costlessProducts,
      negativeStockProducts,
      missingMetaProducts,
      missingNameProducts,
      dataIssueMasters,
      pendingMatch,
      bulkConfirmable,
      multiCandidate,
      conflictCount: pm.conflicts.length,
      masterSyncedAt: pm.meta.masterSyncedAt || null,
      channelStats: activeChannels.map((channel) => ({
        id: channel.id,
        label: channel.label,
        productCount: pm.channelProducts.filter((cp) => cp.channelId === channel.id).length
      }))
    };
  }

  function compareWorkbenchCandidates(a, b, confirmedQueue) {
    const cpA = a.cp;
    const cpB = b.cp;
    const mapA = a.mapping;
    const mapB = b.mapping;
    const canConfirmA = Boolean(
      cpA.masterProductId
      && !cpA.masterLinkConflict
      && cpA.mappingStatus !== MAPPING_STATUS.MANUAL_CONFIRMED
    );
    const canConfirmB = Boolean(
      cpB.masterProductId
      && !cpB.masterLinkConflict
      && cpB.mappingStatus !== MAPPING_STATUS.MANUAL_CONFIRMED
    );
    const missA = cpA.mappingStatus === MAPPING_STATUS.MISSING_MASTER ? 1 : 0;
    const missB = cpB.mappingStatus === MAPPING_STATUS.MISSING_MASTER ? 1 : 0;
    const recoveredA = cpA.masterLinkSource === 'barcode_lookup'
      && Boolean(cpA.masterProductId)
      && (mapA?.status === MAPPING_STATUS.MISSING_MASTER || !mapA?.masterProductId);
    const recoveredB = cpB.masterLinkSource === 'barcode_lookup'
      && Boolean(cpB.masterProductId)
      && (mapB?.status === MAPPING_STATUS.MISSING_MASTER || !mapB?.masterProductId);
    const scoreA = cpA.confidenceScore ?? mapA?.confidenceScore ?? -1;
    const scoreB = cpB.confidenceScore ?? mapB?.confidenceScore ?? -1;
    const nameA = cpA.channelDisplayName || cpA.channelName || '';
    const nameB = cpB.channelDisplayName || cpB.channelName || '';

    if (confirmedQueue) {
      // suspicious sıralaması tam satır gerektirir; aday listesinde isim sırası yeterli
      if (scoreA !== scoreB) return scoreA - scoreB;
    } else {
      if (canConfirmA !== canConfirmB) return canConfirmA ? -1 : 1;
      if (!canConfirmA && !canConfirmB && missA !== missB) return missA - missB;
      if (canConfirmA && canConfirmB && recoveredA !== recoveredB) return recoveredA ? -1 : 1;
      if (canConfirmA && canConfirmB) {
        if (scoreA !== scoreB) return scoreB - scoreA;
      } else if (!canConfirmA && !canConfirmB && scoreA !== scoreB) {
        return scoreA - scoreB;
      }
    }
    return String(nameA).localeCompare(String(nameB), 'tr');
  }

  function workbenchNeedsFullRowFilter(inboxFilter, qualityFilter) {
    if (qualityFilter && qualityFilter !== 'all') return true;
    const normalized = inboxFilter === 'pending' ? 'all' : inboxFilter;
    return Boolean(normalized && normalized !== 'all');
  }

  function liteSafeConfirmable(cp, mapping) {
    const canConfirm = Boolean(
      cp.masterProductId
      && !cp.masterLinkConflict
      && cp.mappingStatus !== MAPPING_STATUS.MANUAL_CONFIRMED
    );
    const score = Number(cp.confidenceScore ?? mapping?.confidenceScore);
    return canConfirm && Number.isFinite(score) && score >= 88;
  }

  let workbenchLiteCache = null;
  let workbenchLiteCacheAt = 0;
  let workbenchIndexWriteAt = 0;
  const WORKBENCH_LITE_CACHE_MS = 120_000;
  const WORKBENCH_INDEX_WRITE_COOLDOWN_MS = 300_000;

  function buildMappingIndex(pm) {
    const index = new Map();
    for (const mapping of pm.mappings) {
      index.set(`${mapping.channelId}:${mapping.channelProductId}`, mapping);
    }
    return index;
  }

  function workbenchLiteCacheKey(opts) {
    return [
      opts.channelFilter || '',
      opts.q || '',
      opts.statusFilter || '',
      opts.confirmedQueue ? '1' : '0'
    ].join('|');
  }

  function collectWorkbenchLiteCandidates(db, pm, opts = {}) {
    const cacheKey = workbenchLiteCacheKey(opts);
    const now = Date.now();
    if (
      workbenchLiteCache?.key === cacheKey
      && now - workbenchLiteCacheAt < WORKBENCH_LITE_CACHE_MS
    ) {
      return workbenchLiteCache.data;
    }

    const {
      channelFilter = '',
      q = '',
      statusFilter = '',
      confirmedQueue = false,
      activeChannels = listSalesMatchingChannels().filter((c) =>
        c.status !== 'planned' && (!channelFilter || c.id === channelFilter)
      )
    } = opts;

    const mappingIndex = buildMappingIndex(pm);
    const candidates = [];
    let unmatchedChannelProducts = 0;
    let multiCandidate = 0;
    for (const channel of activeChannels) {
      const cps = pm.channelProducts.filter((cp) => cp.channelId === channel.id);
      const enriched = attachMappingToChannelProducts(db, channel.id, cps);
      for (const cp of enriched) {
        if (shouldHideAbsentCatalogChannelProduct(cp)) continue;
        if (cp.masterLinkConflict) multiCandidate += 1;
        if (cp.mappingStatus !== MAPPING_STATUS.MANUAL_CONFIRMED) {
          unmatchedChannelProducts += 1;
        }
        if (confirmedQueue) {
          if (cp.mappingStatus !== MAPPING_STATUS.MANUAL_CONFIRMED) continue;
        } else if (!WORKBENCH_STATUSES.has(cp.mappingStatus)) {
          continue;
        }
        if (statusFilter && cp.mappingStatus !== statusFilter) continue;
        const hay = [
          cp.channelName,
          cp.channelBarcode,
          cp.channelProductId,
          cp.masterProductName
        ].join(' ').toLowerCase();
        if (q && !hay.includes(q)) continue;

        const mapping = mappingIndex.get(`${cp.channelId}:${cp.channelProductId}`) || null;
        candidates.push({ channel, cp, mapping });
      }
    }

    candidates.sort((a, b) => compareWorkbenchCandidates(a, b, confirmedQueue));

    const channelCounts = {};
    let safeConfirmable = 0;
    for (const item of candidates) {
      channelCounts[item.cp.channelId] = (channelCounts[item.cp.channelId] || 0) + 1;
      if (liteSafeConfirmable(item.cp, item.mapping)) safeConfirmable += 1;
    }

    const data = {
      candidates,
      channelCounts,
      safeConfirmable,
      activeChannels,
      unmatchedChannelProducts,
      multiCandidate
    };
    workbenchLiteCache = { key: cacheKey, data };
    workbenchLiteCacheAt = now;
    return data;
  }

  function invalidateWorkbenchLiteCache() {
    workbenchLiteCache = null;
    workbenchLiteCacheAt = 0;
  }

  function markWorkbenchStoresDirty(pm) {
    invalidateWorkbenchLiteCache();
    clearWorkbenchIndex(pm);
  }

  async function rebuildWorkbenchIndex({ persist = true } = {}) {
    const db = await readDb();
    const pm = getProductMatching(db);
    const activeChannels = listSalesMatchingChannels().filter((c) => c.status !== 'planned');
    const lite = collectWorkbenchLiteCandidates(db, pm, {
      channelFilter: '',
      q: '',
      statusFilter: '',
      confirmedQueue: false,
      activeChannels
    });
    const index = buildIndexFromLiteResult(lite, workbenchDataFingerprint(pm));
    saveWorkbenchIndex(pm, index);
    invalidateWorkbenchLiteCache();
    if (persist) {
      await writeDb(db);
    }
    return { ok: true, total: index.total, builtAt: index.builtAt };
  }

  async function rebuildWorkbenchIndexIfNeeded() {
    const db = await readDb();
    const pm = getProductMatching(db);
    const stored = getStoredWorkbenchIndex(pm);
    if (isWorkbenchIndexFresh(pm, stored, { queue: 'action' })) {
      return { ok: true, skipped: true, total: stored.total, builtAt: stored.builtAt };
    }
    return rebuildWorkbenchIndex({ persist: true });
  }

  function hydrateWorkbenchRowsFromEntries(db, pm, entries) {
    const channelById = new Map(
      listSalesMatchingChannels().filter((c) => c.status !== 'planned').map((c) => [c.id, c])
    );
    const cpByKey = new Map();
    for (const cp of pm.channelProducts) {
      cpByKey.set(`${cp.channelId}:${cp.channelProductId}`, cp);
    }
    const mappingIndex = buildMappingIndex(pm);
    const rows = [];
    for (const entry of entries) {
      const raw = cpByKey.get(`${entry.channelId}:${entry.channelProductId}`);
      if (!raw) continue;
      const channel = channelById.get(entry.channelId) || { id: entry.channelId, label: entry.channelId };
      const [enriched] = attachMappingToChannelProducts(db, entry.channelId, [raw]);
      const mapping = mappingIndex.get(`${entry.channelId}:${entry.channelProductId}`) || null;
      rows.push(buildWorkbenchRow(db, pm, channel, enriched, mapping));
    }
    return rows;
  }

  async function listMatchingWorkbench(searchParams = {}) {
    const db = await readDb();
    const pm = getProductMatching(db);
    const page = Math.max(1, Number(searchParams.get?.('page') ?? searchParams.page ?? 1) || 1);
    const limit = Math.min(100, Math.max(1, Number(searchParams.get?.('limit') ?? searchParams.limit ?? 50) || 50));
    const channelFilter = String(searchParams.get?.('channelId') ?? '').trim();
    const q = String(searchParams.get?.('q') ?? '').trim().toLowerCase();
    const statusFilter = String(searchParams.get?.('status') ?? '').trim();
    const queue = String(searchParams.get?.('queue') ?? searchParams.queue ?? 'action').trim();
    const qualityFilter = String(searchParams.get?.('quality') ?? searchParams.quality ?? '').trim();
    const inboxFilter = String(searchParams.get?.('inboxFilter') ?? searchParams.inboxFilter ?? '').trim();
    const confirmedQueue = queue === 'confirmed';
    const useLitePath = !workbenchNeedsFullRowFilter(inboxFilter, qualityFilter);

    const activeChannels = listSalesMatchingChannels().filter((c) =>
      c.status !== 'planned' && (!channelFilter || c.id === channelFilter)
    );

    if (useLitePath) {
      const canUseStoredIndex = !confirmedQueue
        && !inboxFilter
        && !qualityFilter;
      const storedIndex = getStoredWorkbenchIndex(pm);

      if (canUseStoredIndex && isWorkbenchIndexFresh(pm, storedIndex, { queue: 'action' })) {
        const filtered = filterIndexEntries(storedIndex, { channelFilter, q, statusFilter });
        const { channelCounts, total } = summarizeFilteredEntries(filtered);
        const start = (page - 1) * limit;
        const pageEntries = filtered.slice(start, start + limit);
        const rows = hydrateWorkbenchRowsFromEntries(db, pm, pageEntries);
        const summaryCounts = channelFilter || q || statusFilter
          ? channelCounts
          : storedIndex.channelCounts;

        return {
          rows,
          total,
          page,
          limit,
          totalPages: Math.max(1, Math.ceil(total / limit)),
          queue,
          summary: {
            suspicious: 0,
            filtered: total,
            safeConfirmable: storedIndex.safeConfirmable,
            channelCounts: summaryCounts
          }
        };
      }

      const lite = collectWorkbenchLiteCandidates(db, pm, {
        channelFilter,
        q,
        statusFilter,
        confirmedQueue,
        activeChannels
      });

      if (canUseStoredIndex && !channelFilter && !q && !statusFilter) {
        const index = buildIndexFromLiteResult(lite, workbenchDataFingerprint(pm));
        saveWorkbenchIndex(pm, index);
        invalidateWorkbenchLiteCache();
        const writeNow = Date.now();
        if (writeNow - workbenchIndexWriteAt >= WORKBENCH_INDEX_WRITE_COOLDOWN_MS) {
          workbenchIndexWriteAt = writeNow;
          writeDb(db).catch(() => {});
        }
      }

      const start = (page - 1) * limit;
      const pageItems = lite.candidates.slice(start, start + limit);
      const rows = pageItems.map((item) =>
        buildWorkbenchRow(db, pm, item.channel, item.cp, item.mapping)
      );

      return {
        rows,
        total: lite.candidates.length,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(lite.candidates.length / limit)),
        queue,
        summary: {
          suspicious: 0,
          filtered: lite.candidates.length,
          safeConfirmable: lite.safeConfirmable,
          channelCounts: lite.channelCounts
        }
      };
    }

    let rows = [];
    let suspiciousTotal = 0;
    for (const channel of activeChannels) {
      const cps = pm.channelProducts.filter((cp) => cp.channelId === channel.id);
      const enriched = attachMappingToChannelProducts(db, channel.id, cps);
      for (const cp of enriched) {
        if (shouldHideAbsentCatalogChannelProduct(cp)) continue;
        if (confirmedQueue) {
          if (cp.mappingStatus !== MAPPING_STATUS.MANUAL_CONFIRMED) continue;
        } else if (!WORKBENCH_STATUSES.has(cp.mappingStatus)) {
          continue;
        }
        if (statusFilter && cp.mappingStatus !== statusFilter) continue;
        const hay = [
          cp.channelName,
          cp.channelBarcode,
          cp.channelProductId,
          cp.masterProductName
        ].join(' ').toLowerCase();
        if (q && !hay.includes(q)) continue;

        const mapping = pm.mappings.find((m) =>
          m.channelId === cp.channelId && m.channelProductId === cp.channelProductId
        );
        const row = buildWorkbenchRow(db, pm, channel, cp, mapping);
        if (row.suspicious) suspiciousTotal += 1;
        if (!passesWorkbenchQualityFilter(row, qualityFilter)) continue;
        if (!passesInboxQueueFilter(row, inboxFilter)) continue;
        rows.push(row);
      }
    }

    const channelCounts = {};
    let safeConfirmable = 0;
    for (const row of rows) {
      channelCounts[row.channelId] = (channelCounts[row.channelId] || 0) + 1;
      if (row.canConfirm && Number(row.confidenceScore) >= 88 && !row.suspicious && !(row.qualityFlags || []).length) {
        safeConfirmable += 1;
      }
    }

    rows.sort((a, b) => {
      if (confirmedQueue) {
        if (a.suspicious !== b.suspicious) return a.suspicious ? -1 : 1;
      } else {
        if (a.canConfirm !== b.canConfirm) return a.canConfirm ? -1 : 1;
        const missA = a.mappingStatus === 'missing_master' ? 1 : 0;
        const missB = b.mappingStatus === 'missing_master' ? 1 : 0;
        if (!a.canConfirm && !b.canConfirm && missA !== missB) return missA - missB;
        if (a.canConfirm && b.canConfirm && a.suggestionRecovered !== b.suggestionRecovered) {
          return a.suggestionRecovered ? -1 : 1;
        }
      }
      const scoreA = a.confidenceScore ?? -1;
      const scoreB = b.confidenceScore ?? -1;
      if (confirmedQueue) {
        if (scoreA !== scoreB) return scoreA - scoreB;
      } else if (a.canConfirm && b.canConfirm) {
        if (scoreA !== scoreB) return scoreB - scoreA;
      } else if (!a.canConfirm && !b.canConfirm && scoreA !== scoreB) {
        return scoreA - scoreB;
      }
      return String(a.channelName || '').localeCompare(String(b.channelName || ''), 'tr');
    });

    const start = (page - 1) * limit;
    return {
      rows: rows.slice(start, start + limit),
      total: rows.length,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(rows.length / limit)),
      queue,
      summary: {
        suspicious: suspiciousTotal,
        filtered: rows.length,
        safeConfirmable,
        channelCounts
      }
    };
  }

  async function getDataQualityReport(searchParams = {}) {
    const db = await readDb();
    const pm = getProductMatching(db);
    const category = String(searchParams.get?.('category') ?? 'missing_name').trim();
    const page = Math.max(1, Number(searchParams.get?.('page') ?? 1) || 1);
    const limit = Math.min(100, Math.max(25, Number(searchParams.get?.('limit') ?? 50) || 50));

    const barcodeGroups = new Map();
    for (const row of pm.masterProducts) {
      const key = normalizeBarcode(row.benimposBarcode);
      if (!key) continue;
      if (!barcodeGroups.has(key)) barcodeGroups.set(key, []);
      barcodeGroups.get(key).push(row);
    }

    const duplicateSuspects = [];
    for (const [barcode, items] of barcodeGroups) {
      if (items.length <= 1) continue;
      duplicateSuspects.push({
        id: `dup-${barcode}`,
        barcode,
        count: items.length,
        names: items.map((i) => i.name).join(' · '),
        masterProductIds: items.map((i) => i.id)
      });
    }

    const categories = {
      missing_name: pm.masterProducts.filter((row) => masterHasNameIssue(row)),
      negative_stock: pm.masterProducts.filter((row) => Number(row.stock) < 0),
      missing_cost: pm.masterProducts.filter((row) => Number(row.buyingPrice) <= 0),
      barcode_conflicts: pm.conflicts.map((c) => ({
        id: c.id,
        barcode: c.channelBarcode,
        reason: c.reason,
        channelId: c.channelId,
        candidates: (c.candidates || []).map((x) => x.name).join(' · ')
      })),
      channel_not_in_master: pm.mappings
        .filter((m) => m.status === MAPPING_STATUS.MISSING_MASTER)
        .map((m) => {
          const cp = pm.channelProducts.find((row) =>
            row.channelId === m.channelId && row.channelProductId === m.channelProductId
          );
          return {
            id: m.id,
            channelId: m.channelId,
            channelProductId: m.channelProductId,
            channelName: cp?.channelName || m.channelProductId,
            channelBarcode: cp?.channelBarcode || m.channelBarcode || ''
          };
        }),
      duplicate_suspects: duplicateSuspects
    };

    const counts = Object.fromEntries(
      Object.entries(categories).map(([key, list]) => [key, list.length])
    );

    const list = categories[category] || categories.missing_name;
    const start = (page - 1) * limit;
    const paged = list.slice(start, start + limit).map((row) => {
      if (category === 'missing_name' || category === 'negative_stock' || category === 'missing_cost') {
        return {
          id: row.id,
          name: row.name,
          benimposBarcode: row.benimposBarcode,
          stockCode: row.stockCode || '',
          stock: row.stock,
          buyingPrice: row.buyingPrice,
          flags: masterQualityFlags(row)
        };
      }
      return row;
    });

    return {
      category,
      counts,
      rows: paged,
      total: list.length,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(list.length / limit))
    };
  }

  async function getMasterProductDetail(masterProductId) {
    const db = await readDb();
    const pm = getProductMatching(db);
    const master = pm.masterProducts.find((row) => row.id === masterProductId);
    if (!master) {
      const error = new Error('Ana ürün bulunamadı.');
      error.statusCode = 404;
      throw error;
    }

    const channelMappings = mappingStatusesForMaster(db, masterProductId);
    const channelDetails = channelMappingDetailsForMaster(db, masterProductId).map((detail) => {
      const cp = pm.channelProducts.find((row) =>
        row.channelId === detail.channelId && row.channelProductId === detail.channelProductId
      );
      return {
        ...detail,
        channelSalePrice: detail.channelSalePrice ?? channelSalePriceFromProduct(cp, detail.channelId, db),
        lastSeenAt: cp?.lastSeenAt || cp?.updatedAt || null,
        ingestSource: cp?.ingestSource || null
      };
    });

    const activeChannels = listSalesMatchingChannels();
    const channelSlots = activeChannels.map((channel) => {
      const hit = channelDetails.find((d) => d.channelId === channel.id);
      return {
        channelId: channel.id,
        channelLabel: channel.label,
        channelStatus: channel.status,
        mapping: hit || null,
        mappingStatus: hit?.status || mappingStatusForMaster(db, masterProductId, channel.id)
      };
    });

    return {
      master: {
        ...master,
        qualityFlags: masterQualityFlags(master),
        profitPct: masterProfitPctOnCost(master),
        matchAggregate: summarizeMasterMatchAggregate(channelMappings)
      },
      channelSlots,
      channelPrices: buildMasterChannelPrices(db, master),
      mappingHistory: listMasterMappingHistory(db, masterProductId, 25)
    };
  }

  return {
    getMode,
    getStatus,
    getOpsSummary,
    listMatchingWorkbench,
    rebuildWorkbenchIndex,
    rebuildWorkbenchIndexIfNeeded,
    getDataQualityReport,
    getMasterProductDetail,
    listMasterProducts,
    updateMasterProduct,
    setMasterAutoStockBulk,
    listChannelProducts,
    syncMasterFromBenimpos,
    startMasterSyncFromBenimpos,
    getMasterSyncStatus,
    syncUberChannelProducts,
    syncUberCatalogProducts,
    startUberCatalogSync,
    startGetirCatalogSync,
    startYemeksepetiCatalogSync,
    getCatalogSyncStatus,
    syncYemeksepetiCatalogProducts,
    syncGetirCatalogProducts,
    cleanUberOrderMetadata,
    linkChannelProductsByBarcode,
    runAutoMatch,
    runAutoMatchAllChannels,
    confirmMapping,
    confirmMappingsBulk,
    confirmAutoMatchedBulk,
    autoMatchPerfectConfidence,
    confirmMarkup25Bulk,
    removeMapping,
    removeMasterChannelMapping,
    removeMasterChannelMappingsBulk,
    removeChannelMappingsBulk,
    removeMappingsBulk,
    masterPoolBulkAction,
    clearSystemMappings,
    getCleanupSuggestions,
    applyCleanupSuggestions,
    dismissCleanupSuggestions: dismissCleanupSuggestionsRequest,
    getReports,
    listPriceCompare,
    setPrimaryMapping,
    listMappingLogs,
    findMasterByBarcode,
    searchMasters,
    listMissingMasterReview,
    saveMissingMasterReview,
    applyMissingMasterSuggestions
  };
}
