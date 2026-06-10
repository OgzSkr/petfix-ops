import { MAPPING_STATUS } from './constants.js';
import { normalizeBarcode as normalizeBarcodeBase, barcodeLookupKeys, barcodesEquivalent } from './normalize.js';
import { resolveChannelDisplayName, resolveBrandForChannelProduct } from './channel-ingest/uber-eats.js';

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

/** Uber satış hedefi: Ana Havuz satış fiyatının %25 üstü */
export const UBER_MARKUP_TARGET_PCT = 25;
export const UBER_MARKUP_TOLERANCE_PCT = 0.1;

/** Tam ~%25 satış farkı = daha önce kontrol edilmiş Uber fiyatlandırması */
export function isIntentionalUberMarkup(row, tolerance = UBER_MARKUP_TOLERANCE_PCT) {
  if (row.compareBasis !== 'sale') return false;
  const pct = row.priceDiffPct ?? row.uberVsMasterSalePct;
  if (pct == null || Number.isNaN(pct)) return false;
  return Math.abs(pct - UBER_MARKUP_TARGET_PCT) <= tolerance;
}

/** ((a - b) / b) * 100 — b yoksa null */
export function priceDiffPercent(numerator, denominator) {
  const a = Number(numerator);
  const b = Number(denominator);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return null;
  return roundMoney(((a - b) / b) * 100);
}

function uberSellingPrice(channelProduct) {
  const catalog = Number(channelProduct.lastUnitPrice) || 0;
  if (catalog > 0) return catalog;
  return Number(channelProduct.catalogQuantity >= 0 ? channelProduct.lastUnitPrice : 0) || 0;
}

function pickUberPrice(channelProduct) {
  return roundMoney(Number(channelProduct.lastUnitPrice) || 0);
}

function pickCompareBasis(masterSale, masterBuy) {
  const sale = roundMoney(masterSale);
  const buy = roundMoney(masterBuy);
  if (sale > 1) return { price: sale, basis: 'sale' };
  if (buy > 0) return { price: buy, basis: 'cost' };
  return { price: null, basis: 'none' };
}

export function buildPriceCompareReport(db, channelId = 'uber-eats', filters = {}) {
  const pm = db.productMatching;
  const channelProducts = pm.channelProducts.filter((cp) => cp.channelId === channelId);
  const mappings = pm.mappings.filter((m) => m.channelId === channelId);

  const masterById = new Map(pm.masterProducts.map((m) => [m.id, m]));
  const masterByBarcode = new Map();
  for (const m of pm.masterProducts) {
    for (const code of barcodeLookupKeys(m.benimposBarcode)) {
      if (code && !masterByBarcode.has(code)) masterByBarcode.set(code, m);
    }
  }

  const mappingByCp = new Map(mappings.map((m) => [m.channelProductId, m]));

  function resolveBarcodeMaster(channelBarcode) {
    for (const code of barcodeLookupKeys(channelBarcode)) {
      const master = masterByBarcode.get(code);
      if (master) return master;
    }
    return null;
  }

  const allRows = channelProducts.map((cp) => {
    const mapping = mappingByCp.get(cp.channelProductId);
    const barcode = normalizeBarcodeBase(cp.channelBarcode);
    const mappedMaster = mapping?.masterProductId
      ? masterById.get(mapping.masterProductId)
      : null;
    const barcodeMaster = resolveBarcodeMaster(cp.channelBarcode);
    const master = mappedMaster || barcodeMaster || null;

    const uberPrice = pickUberPrice(cp);
    const masterBuy = roundMoney(master?.buyingPrice);
    const masterSale = roundMoney(master?.salePrice1);
    const compare = pickCompareBasis(masterSale, masterBuy);
    const saleDiffPct = priceDiffPercent(uberPrice, masterSale);
    const compareDiffPct = compare.price ? priceDiffPercent(uberPrice, compare.price) : null;

    return {
      channelProductId: cp.channelProductId,
      channelBarcode: cp.channelBarcode,
      channelName: cp.channelName || '',
      channelDisplayName: resolveChannelDisplayName(cp, master),
      channelBrand: cp.uberBrand || null,
      uberBrand: cp.uberBrand || null,
      uberPrice,
      uberOnSale: cp.catalogOnSale ?? null,
      ingestSource: cp.ingestSource || 'catalog',
      masterProductId: master?.id || mapping?.masterProductId || null,
      masterName: master?.name || null,
      masterBarcode: master?.benimposBarcode || null,
      masterBrand: master?.brand || master?.categoryName || null,
      masterBuyingPrice: masterBuy,
      masterSalePrice: masterSale,
      masterSaleSuspect: masterSale > 0 && masterSale <= 1,
      compareBasis: compare.basis,
      uberVsMasterSalePct: saleDiffPct,
      priceDiffPct: compareDiffPct,
      marginOnCostPct: priceDiffPercent(uberPrice, masterBuy),
      mappingReasons: mapping?.reasons || [],
      confidenceScore: mapping?.confidenceScore ?? null,
      mappingStatus: mapping?.status || (barcodeMaster ? 'barcode_match_unmapped' : 'unmapped'),
      mappingId: mapping?.id || null,
      salesPrimary: Boolean(mapping?.salesPrimary),
      hasBarcodeMaster: Boolean(barcodeMaster),
      hasMappedMaster: Boolean(mappedMaster),
      barcodeEquivalentOnly: Boolean(
        master?.benimposBarcode
        && cp.channelBarcode
        && normalizeBarcodeBase(master.benimposBarcode) !== normalizeBarcodeBase(cp.channelBarcode)
        && barcodesEquivalent(master.benimposBarcode, cp.channelBarcode)
      )
    };
  });

  const masterMultiUber = buildMasterMultiUberGroups(channelProducts, mappings, masterById, mappingByCp);
  const splitRecommendedCpIds = new Set(
    masterMultiUber
      .filter((g) => g.recommendation?.strategy === 'split_recommended')
      .flatMap((g) => g.uberItems.map((i) => i.channelProductId))
  );

  const withBothPricesAll = allRows.filter((r) => r.uberPrice > 0 && r.priceDiffPct != null);
  const saleDiffsAll = withBothPricesAll.map((r) => r.priceDiffPct).filter((v) => v != null).sort((a, b) => a - b);
  const avgSaleDiffAll = saleDiffsAll.length
    ? roundMoney(saleDiffsAll.reduce((s, v) => s + v, 0) / saleDiffsAll.length)
    : null;
  const medianSaleDiffAll = saleDiffsAll.length
    ? roundMoney(saleDiffsAll[Math.floor(saleDiffsAll.length / 2)])
    : null;

  const summary = {
    totalUber: channelProducts.length,
    withMasterBarcode: allRows.filter((r) => r.hasBarcodeMaster).length,
    mapped: allRows.filter((r) => r.hasMappedMaster).length,
    manualConfirmed: allRows.filter((r) => r.mappingStatus === MAPPING_STATUS.MANUAL_CONFIRMED).length,
    reviewRequired: allRows.filter((r) => r.mappingStatus === MAPPING_STATUS.REVIEW_REQUIRED).length,
    missingMaster: allRows.filter((r) => r.mappingStatus === MAPPING_STATUS.MISSING_MASTER).length,
    avgSaleDiffPct: avgSaleDiffAll,
    medianSaleDiffPct: medianSaleDiffAll,
    highDiffCount: allRows.filter((r) =>
      r.priceDiffPct != null && Math.abs(r.priceDiffPct) >= 10 && r.compareBasis === 'sale'
    ).length,
    suspiciousSaleCount: allRows.filter((r) => r.masterSaleSuspect).length,
    masterMultiUberGroups: masterMultiUber.length,
    splitRecommendedGroups: masterMultiUber.filter((g) => g.recommendation?.strategy === 'split_recommended').length,
    markup25ReviewCount: allRows.filter((r) =>
      r.mappingStatus === MAPPING_STATUS.REVIEW_REQUIRED && isIntentionalUberMarkup(r)
    ).length,
    readyForSalesPct: channelProducts.length
      ? roundMoney(
        (allRows.filter((r) => r.mappingStatus === MAPPING_STATUS.MANUAL_CONFIRMED).length / channelProducts.length) * 100
      )
      : null,
    onSaleCount: allRows.filter((r) => r.uberOnSale === true).length,
    notOnSaleCount: allRows.filter((r) => r.uberOnSale === false).length,
    onSaleUnknownCount: allRows.filter((r) => r.uberOnSale == null).length
  };

  let rows = [...allRows];

  const q = String(filters.q || '').trim().toLowerCase();
  const qRaw = String(filters.q || '').trim();
  if (q) {
    rows = rows.filter((row) =>
      String(row.channelName || '').toLowerCase().includes(q)
      || String(row.channelDisplayName || '').toLowerCase().includes(q)
      || String(row.channelBarcode || '').includes(qRaw)
      || barcodesEquivalent(row.channelBarcode, qRaw)
      || String(row.masterName || '').toLowerCase().includes(q)
      || barcodesEquivalent(row.masterBarcode, qRaw)
    );
  }

  const matchFilter = String(filters.match || '').trim();
  if (matchFilter === 'barcode') {
    rows = rows.filter((row) => row.hasBarcodeMaster);
  } else if (matchFilter === 'mapped') {
    rows = rows.filter((row) => row.hasMappedMaster);
  } else if (matchFilter === 'unmapped') {
    rows = rows.filter((row) => !row.hasMappedMaster && row.hasBarcodeMaster);
  } else if (matchFilter === 'no_master') {
    rows = rows.filter((row) => !row.hasBarcodeMaster);
  } else if (matchFilter === 'split_recommended') {
    rows = rows.filter((row) => splitRecommendedCpIds.has(row.channelProductId));
  }

  const statusFilter = String(filters.status || '').trim();
  if (statusFilter) {
    rows = rows.filter((row) => {
      if (statusFilter === 'unmapped') {
        return !row.hasMappedMaster && row.mappingStatus !== 'missing_master';
      }
      if (statusFilter === 'missing_master') {
        return row.mappingStatus === 'missing_master' || (!row.hasBarcodeMaster && !row.hasMappedMaster);
      }
      return row.mappingStatus === statusFilter;
    });
  }

  const diffFilter = String(filters.diff || '').trim();
  if (diffFilter === 'high') {
    rows = rows.filter((row) =>
      row.priceDiffPct != null && Math.abs(row.priceDiffPct) >= 10
    );
  } else if (diffFilter === 'missing_price') {
    rows = rows.filter((row) => !row.uberPrice || !row.masterSalePrice);
  } else if (diffFilter === 'suspicious_sale') {
    rows = rows.filter((row) => row.masterSaleSuspect);
  } else if (diffFilter === 'meaningful') {
    rows = rows.filter((row) =>
      row.priceDiffPct != null && Math.abs(row.priceDiffPct) >= 10 && row.compareBasis === 'sale'
    );
  }

  const onSaleFilter = String(filters.onSale || '').trim();
  if (onSaleFilter === 'on') {
    rows = rows.filter((row) => row.uberOnSale === true);
  } else if (onSaleFilter === 'off') {
    rows = rows.filter((row) => row.uberOnSale === false);
  } else if (onSaleFilter === 'unknown') {
    rows = rows.filter((row) => row.uberOnSale == null);
  }

  const sort = String(filters.sort || 'sale_diff_desc').trim();
  rows.sort((a, b) => {
    if (sort === 'name') {
      return String(a.channelName || a.channelBarcode).localeCompare(String(b.channelName || b.channelBarcode), 'tr-TR');
    }
    if (sort === 'uber_price') return (b.uberPrice || 0) - (a.uberPrice || 0);
    if (sort === 'sale_diff_asc') {
      return Math.abs(a.priceDiffPct ?? a.uberVsMasterSalePct ?? 0) - Math.abs(b.priceDiffPct ?? b.uberVsMasterSalePct ?? 0);
    }
    if (sort === 'margin_desc') {
      return Math.abs(b.marginOnCostPct ?? 0) - Math.abs(a.marginOnCostPct ?? 0);
    }
    return Math.abs(b.priceDiffPct ?? b.uberVsMasterSalePct ?? 0) - Math.abs(a.priceDiffPct ?? a.uberVsMasterSalePct ?? 0);
  });

  return {
    channelId,
    summary,
    masterMultiUber,
    rows,
    searchHint: buildPriceCompareSearchHint({
      q: qRaw,
      channelId,
      channelProducts,
      masterProducts: pm.masterProducts,
      mappings,
      masterByBarcode,
      resolveBarcodeMaster
    })
  };
}

function buildPriceCompareSearchHint({
  q,
  channelId,
  channelProducts,
  masterProducts,
  mappings,
  masterByBarcode,
  resolveBarcodeMaster
}) {
  const query = String(q || '').trim();
  if (!query) return null;

  let master = null;
  for (const code of barcodeLookupKeys(query)) {
    master = masterByBarcode.get(code) || null;
    if (master) break;
  }
  if (!master) {
    const needle = query.toLowerCase();
    master = masterProducts.find((row) =>
      String(row.name || '').toLowerCase().includes(needle)
      || String(row.benimposBarcode || '').includes(query)
    ) || null;
  }
  if (!master) return null;

  const uberProduct = channelProducts.find((cp) =>
    barcodesEquivalent(cp.channelBarcode, master.benimposBarcode)
  ) || null;

  const mapping = uberProduct
    ? mappings.find((m) => m.channelId === channelId && m.channelProductId === uberProduct.channelProductId)
    : null;

  const relatedUber = channelProducts
    .filter((cp) => {
      if (uberProduct && cp.channelProductId === uberProduct.channelProductId) return false;
      const brand = String(cp.uberBrand || '').trim().toLowerCase();
      const masterBrand = String(master.brand || master.categoryName || '').trim().toLowerCase();
      if (brand && masterBrand && brand === masterBrand) return true;
      const prefix = String(master.benimposBarcode || '').slice(0, 8);
      return prefix.length >= 8 && String(cp.channelBarcode || '').startsWith(prefix);
    })
    .slice(0, 3)
    .map((cp) => ({
      channelProductId: cp.channelProductId,
      channelBarcode: cp.channelBarcode,
      channelName: cp.channelName || ''
    }));

  return {
    masterProductId: master.id,
    masterName: master.name,
    masterBarcode: master.benimposBarcode,
    masterStock: master.stock,
    uberInCatalog: Boolean(uberProduct),
    uberProductName: uberProduct?.channelName || null,
    uberOnSale: uberProduct?.catalogOnSale ?? null,
    mappingStatus: mapping?.status || (uberProduct ? 'unmapped' : null),
    relatedUber
  };
}

function buildMasterMultiUberGroups(channelProducts, mappings, masterById, mappingByCp) {
  const cpById = new Map(channelProducts.map((cp) => [cp.channelProductId, cp]));
  const byMaster = new Map();

  for (const mapping of mappings) {
    if (!mapping.masterProductId) continue;
    if (![MAPPING_STATUS.MANUAL_CONFIRMED, MAPPING_STATUS.AUTO_MATCHED].includes(mapping.status)) continue;

    const cp = cpById.get(mapping.channelProductId);
    if (!cp) continue;

    if (!byMaster.has(mapping.masterProductId)) {
      byMaster.set(mapping.masterProductId, []);
    }

    byMaster.get(mapping.masterProductId).push({
      channelProductId: cp.channelProductId,
      channelBarcode: cp.channelBarcode,
      channelName: cp.channelName,
      channelDisplayName: resolveChannelDisplayName(cp, masterById.get(mapping.masterProductId)),
      uberPrice: pickUberPrice(cp),
      mappingStatus: mapping.status,
      mappingId: mapping.id,
      salesPrimary: Boolean(mapping.salesPrimary)
    });
  }

  return [...byMaster.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([masterProductId, uberItems]) => {
      const master = masterById.get(masterProductId);
      const sorted = [...uberItems].sort((a, b) => {
        if (a.salesPrimary !== b.salesPrimary) return a.salesPrimary ? -1 : 1;
        const aExact = barcodesEquivalent(a.channelBarcode, master?.benimposBarcode);
        const bExact = barcodesEquivalent(b.channelBarcode, master?.benimposBarcode);
        if (aExact !== bExact) return aExact ? -1 : 1;
        return String(a.channelName || '').localeCompare(String(b.channelName || ''), 'tr-TR');
      });
      const recommendedPrimary = sorted[0];

      return {
        masterProductId,
        masterName: master?.name || '—',
        masterBarcode: master?.benimposBarcode || '',
        masterSalePrice: roundMoney(master?.salePrice1),
        masterBuyingPrice: roundMoney(master?.buyingPrice),
        uberCount: uberItems.length,
        uberItems: sorted,
        recommendedPrimaryId: recommendedPrimary.channelProductId,
        recommendation: recommendMultiUberStrategy(sorted, master)
      };
    })
    .sort((a, b) => b.uberCount - a.uberCount);
}

function recommendMultiUberStrategy(uberItems, master) {
  const priceSpread = uberItems.map((i) => i.uberPrice).filter((p) => p > 0);
  const minP = Math.min(...priceSpread);
  const maxP = Math.max(...priceSpread);
  const priceRatio = minP > 0 ? maxP / minP : 0;
  const likelyDifferentProducts = priceRatio >= 3;

  const primary = uberItems.find((i) => i.salesPrimary)
    || uberItems.find((i) => barcodesEquivalent(i.channelBarcode, master?.benimposBarcode))
    || uberItems[0];
  const others = uberItems.filter((i) => i.channelProductId !== primary.channelProductId);

  if (likelyDifferentProducts) {
    return {
      strategy: 'split_recommended',
      primaryChannelProductId: primary.channelProductId,
      primaryLabel: primary.channelName || primary.channelBarcode,
      summary:
        'Uber listeleri fiyat/gramaj olarak çok farklı — muhtemelen ayrı ana ürünler olmalı. '
        + 'Aynı BenimPOS master\'a bağlamak stok ve fiyat karşılaştırmasını bozar.',
      steps: [
        `Fiyat aralığı: ₺${minP} – ₺${maxP} (${priceRatio.toFixed(1)}x fark)`,
        'Her gramaj/paket için BenimPOS\'ta ayrı ana ürün var mı kontrol edin',
        'Yalnızca gerçekten aynı fiziksel ürünse aynı master\'da tutun; değilse eşleştirmeyi kaldırın',
        ...others.map((o) => `Aday: ${o.channelBarcode} · ${o.channelName?.slice(0, 40) || ''}`)
      ]
    };
  }

  return {
    strategy: 'primary_plus_aliases',
    primaryChannelProductId: primary.channelProductId,
    primaryLabel: primary.channelName || primary.channelBarcode,
    summary:
      'Aynı BenimPOS ana ürününe birden fazla Uber listesi bağlanmış. '
      + 'BenimPOS satışında yalnızca birincil (primary) SKU kullanın; diğerleri alias/türev olarak kalabilir.',
    steps: [
      'Birincil SKU: satışta olan + sipariş geçmişi en yüksek + barkod BenimPOS ile birebir eşleşen',
      'Diğer Uber listeleri: aynı ana ürüne bağlı kalabilir ama "Birincil" işaretli olmayan satırlar ikincil sayılır',
      others.length
        ? `${others.length} alias satır: ${others.map((o) => o.channelBarcode).join(', ')}`
        : 'Alias satır yok'
    ]
  };
}

export function paginateRows(rows, page = 1, limit = 100) {
  const safeLimit = Math.min(200, Math.max(25, Number(limit) || 100));
  const safePage = Math.max(1, Number(page) || 1);
  const start = (safePage - 1) * safeLimit;
  return {
    rows: rows.slice(start, start + safeLimit),
    page: safePage,
    limit: safeLimit,
    total: rows.length,
    totalPages: Math.max(1, Math.ceil(rows.length / safeLimit))
  };
}
