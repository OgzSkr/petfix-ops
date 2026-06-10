import { findByBarcode, toNumber } from '../utils.js';
import { productLinkMeta } from '../product-thumb.js';
import { autoTrackMap, calculateProfit, calculateProfitBreakdown, latestByBarcodeMap } from '../platform/services/profitability.js';
import { resolveCommissionTier } from './resolve.js';
import { analyzeTierProfit, tierCommissionRate, tierReferencePrice } from './bulk-select.js';

function formatMoneyLabel(value) {
  const amount = toNumber(value);
  if (!amount) return '—';
  return `₺${amount.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatTierRangeLabel(item, tier) {
  if (!item) return '—';
  if (tier === 1) {
    return item.tier1Lower ? `${formatMoneyLabel(item.tier1Lower)} ve üzeri` : '—';
  }
  if (tier === 2) {
    return item.tier2Lower && item.tier2Upper
      ? `${formatMoneyLabel(item.tier2Lower)} – ${formatMoneyLabel(item.tier2Upper)}`
      : '—';
  }
  if (tier === 3) {
    return item.tier3Lower && item.tier3Upper
      ? `${formatMoneyLabel(item.tier3Lower)} – ${formatMoneyLabel(item.tier3Upper)}`
      : '—';
  }
  if (tier === 4) {
    return item.tier4Upper ? `${formatMoneyLabel(item.tier4Upper)} ve altı` : '—';
  }
  return '—';
}

function tierCell(item, tier, cost, context = {}) {
  const analysis = analyzeTierProfit(item, tier, cost, context);
  const profit = analysis.profit;
  const referencePrice = analysis.price;
  const priceBasis = analysis.basis || 'tier-bound';

  if (!referencePrice || !analysis.rate) {
    return {
      tier,
      rangeLabel: formatTierRangeLabel(item, tier),
      referencePrice: '',
      priceBasis: 'none',
      rate: '',
      netProfit: '',
      profitRate: '',
      status: 'YOK',
      missing: profit?.missing || ['Tarife verisi yok']
    };
  }

  if (!profit || profit.status === 'EKSIK_VERI') {
    return {
      tier,
      rangeLabel: formatTierRangeLabel(item, tier),
      referencePrice,
      priceBasis,
      rate: analysis.rate,
      netProfit: '',
      profitRate: '',
      status: 'EKSIK_VERI',
      missing: profit?.missing || []
    };
  }

  const netProfit = toNumber(profit.netProfit);
  return {
    tier,
    rangeLabel: formatTierRangeLabel(item, tier),
    referencePrice,
    priceBasis,
    rate: analysis.rate,
    netProfit: profit.netProfit,
    profitRate: profit.profitRate,
    status: netProfit >= 0 ? 'KAR' : 'ZARAR',
    missing: []
  };
}

function buyboxUnavailableReason(product, item) {
  const stock = toNumber(product?.stock ?? item?.stock);
  const status = String(product?.status || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g');
  if (stock <= 0) {
    if (status.includes('satista degil')) return 'off_sale';
    return 'no_stock';
  }
  return 'no_buybox';
}

function buyboxProfitAtSnapshot(snapshot, item, cost, product = {}) {
  const livePrice = toNumber(snapshot?.buyboxPrice);
  const unavailableReason = livePrice ? '' : buyboxUnavailableReason(product, item);
  let price = livePrice;
  let priceSource = livePrice ? 'buybox' : '';

  if (!price) {
    const tsf = toNumber(item?.currentTsf);
    if (tsf > 0 && (unavailableReason === 'off_sale' || unavailableReason === 'no_stock')) {
      price = tsf;
      priceSource = 'tsf';
    }
  }

  if (!price) {
    return {
      buyboxPrice: '',
      buyboxOrder: snapshot?.buyboxOrder ?? '',
      buyboxSeller: snapshot?.sellerName || snapshot?.merchantName || '',
      netProfit: '',
      profitRate: '',
      status: 'YOK',
      commissionTier: null,
      commissionRate: '',
      priceSource: '',
      buyboxUnavailableReason: unavailableReason
    };
  }

  let commissionRate = toNumber(cost?.commissionRate);
  let commissionTier = null;
  if (item) {
    const resolved = resolveCommissionTier(item, price);
    if (resolved?.rate) {
      commissionRate = resolved.rate;
      commissionTier = resolved.tier;
    }
  }

  const profit = calculateProfit({
    buyboxPrice: price,
    commissionRate,
    productCost: cost?.productCost,
    desi: cost?.desi
  });

  const netProfit = toNumber(profit.netProfit);
  return {
    buyboxPrice: livePrice || '',
    buyboxOrder: snapshot?.buyboxOrder ?? '',
    buyboxSeller: snapshot?.sellerName || snapshot?.merchantName || snapshot?.sellerId || '',
    netProfit: profit.netProfit,
    profitRate: profit.profitRate,
    status: profit.status === 'EKSIK_VERI' ? 'EKSIK_VERI' : (netProfit >= 0 ? 'KAR' : 'ZARAR'),
    commissionTier,
    commissionRate,
    priceSource,
    buyboxUnavailableReason: unavailableReason
  };
}

function rankMatchesFilter(order, filter) {
  const rank = Number(order);
  if (!filter) return true;
  if (!Number.isFinite(rank) || rank <= 0) return filter === '4+';
  if (filter === '1') return rank === 1;
  if (filter === '2-3') return rank >= 2 && rank <= 3;
  if (filter === '4+') return rank >= 4;
  return true;
}

function selectedTierCell(row) {
  if (!row.selectedTier) return null;
  return (row.tiers || []).find((tier) => tier.tier === row.selectedTier) || null;
}

function rowHasMissingCost(row) {
  if (row.buyboxProfitStatus === 'EKSIK_VERI') return true;
  return (row.tiers || []).some((tier) => tier.status === 'EKSIK_VERI');
}

function rowHasLossRisk(row) {
  if (row.buyboxProfitStatus === 'ZARAR') return true;
  const selected = selectedTierCell(row);
  return selected?.status === 'ZARAR';
}

function rowMatchesProfitFilter(row, profitFilter) {
  if (!profitFilter || profitFilter === 'all') return true;
  if (profitFilter === 'missing') return rowHasMissingCost(row);
  if (profitFilter === 'profit') {
    if (row.buyboxProfitStatus === 'KAR') return true;
    const selected = selectedTierCell(row);
    return selected?.status === 'KAR';
  }
  if (profitFilter === 'loss') {
    if (row.buyboxProfitStatus === 'ZARAR') return true;
    const selected = selectedTierCell(row);
    return selected?.status === 'ZARAR';
  }
  return true;
}

function matchesFilter(row, filters) {
  const title = String(filters.title || '').trim().toLocaleLowerCase('tr-TR');
  const barcode = String(filters.barcode || '').trim();
  const modelCode = String(filters.modelCode || '').trim().toLocaleLowerCase('tr-TR');
  const category = String(filters.category || '').trim();
  const brand = String(filters.brand || '').trim();
  const minStock = filters.minStock === '' || filters.minStock === undefined ? null : Number(filters.minStock);
  const maxStock = filters.maxStock === '' || filters.maxStock === undefined ? null : Number(filters.maxStock);

  if (title && !String(row.title || '').toLocaleLowerCase('tr-TR').includes(title)) return false;
  if (barcode && !String(row.barcode || '').includes(barcode)) return false;
  if (modelCode && !String(row.modelCode || '').toLocaleLowerCase('tr-TR').includes(modelCode)) return false;
  if (category && row.category !== category) return false;
  if (brand && row.brand !== brand) return false;
  if (minStock !== null && !Number.isNaN(minStock) && toNumber(row.stock) < minStock) return false;
  if (maxStock !== null && !Number.isNaN(maxStock) && toNumber(row.stock) > maxStock) return false;
  if (filters.selectedOnly && !row.selectedTier) return false;
  if (filters.missingBuybox && row.buyboxPrice) return false;
  if (filters.withBuybox && !toNumber(row.buyboxPrice)) return false;
  if (filters.fetchableMissing && (toNumber(row.buyboxPrice) || !row.productUrl)) return false;
  if (filters.missingUrl && row.productUrl) return false;
  if (filters.buyboxRank && !rankMatchesFilter(row.buyboxOrder, filters.buyboxRank)) return false;
  if (filters.missingCost && !rowHasMissingCost(row)) return false;
  if (filters.lossRisk && !rowHasLossRisk(row)) return false;
  if (!rowMatchesProfitFilter(row, filters.profitFilter)) return false;
  return true;
}

export function sortTariffRows(rows, sortBy = 'title', sortDir = 'asc') {
  const dir = sortDir === 'desc' ? -1 : 1;
  const sorted = rows.slice();

  sorted.sort((a, b) => {
    let av;
    let bv;

    switch (sortBy) {
      case 'stock':
        av = toNumber(a.stock);
        bv = toNumber(b.stock);
        break;
      case 'currentTsf':
        av = toNumber(a.currentTsf);
        bv = toNumber(b.currentTsf);
        break;
      case 'buyboxOrder': {
        const safe = (value) => {
          const rank = Number(value);
          return Number.isFinite(rank) && rank > 0 ? rank : 9999;
        };
        av = safe(a.buyboxOrder);
        bv = safe(b.buyboxOrder);
        break;
      }
      case 'buyboxPrice':
        av = toNumber(a.buyboxPrice);
        bv = toNumber(b.buyboxPrice);
        break;
      case 'buyboxNetProfit': {
        const profitValue = (row) => {
          const status = String(row.buyboxProfitStatus || '').toUpperCase();
          if (status === 'KAR' || status === 'ZARAR') return toNumber(row.buyboxNetProfit);
          return null;
        };
        av = profitValue(a);
        bv = profitValue(b);
        if (av === null && bv === null) {
          return String(a.title || '').localeCompare(String(b.title || ''), 'tr');
        }
        if (av === null) return 1;
        if (bv === null) return -1;
        break;
      }
      case 'selectedTier':
        av = toNumber(a.selectedTier) || 0;
        bv = toNumber(b.selectedTier) || 0;
        break;
      case 'title':
      default:
        return dir * String(a.title || '').localeCompare(String(b.title || ''), 'tr');
    }

    if (av === bv) {
      return String(a.title || '').localeCompare(String(b.title || ''), 'tr');
    }
    return av > bv ? dir : -dir;
  });

  return sorted;
}

export function buildTariffSummary(db) {
  const tariff = db.commissionTariff?.byBarcode;
  if (!tariff) {
    return {
      total: 0,
      withBuybox: 0,
      missingBuybox: 0,
      missingOffSale: 0,
      missingFetchable: 0,
      missingUrl: 0,
      selected: 0
    };
  }

  const latestBuybox = latestByBarcodeMap(db.buyboxSnapshots || []);
  let withBuybox = 0;
  let selected = 0;
  let missingOffSale = 0;
  let missingFetchable = 0;
  let missingUrl = 0;

  for (const item of Object.values(tariff)) {
    if (toNumber(latestBuybox[item.barcode]?.buyboxPrice)) {
      withBuybox += 1;
    } else {
      const product = findByBarcode(db.products, item.barcode) || {};
      const linkMeta = productLinkMeta(product);
      const reason = buyboxUnavailableReason(product, item);
      if (reason === 'off_sale' || reason === 'no_stock') {
        missingOffSale += 1;
      }
      if (linkMeta.productUrl) {
        missingFetchable += 1;
      } else if (reason === 'no_buybox') {
        missingUrl += 1;
      }
    }
    if (item.selectedTier) selected += 1;
  }

  const total = Object.keys(tariff).length;
  return {
    total,
    withBuybox,
    missingBuybox: total - withBuybox,
    missingOffSale,
    missingFetchable,
    missingUrl,
    selected
  };
}

export function buildTariffAnalysis(db, filters = {}) {
  const tariff = db.commissionTariff;
  if (!tariff?.byBarcode) {
    return { rows: [], filterOptions: { brands: [], categories: [] } };
  }

  const latestBuybox = latestByBarcodeMap(db.buyboxSnapshots || []);
  const autoTrackByBarcode = autoTrackMap(db.autoTrackList || []);
  const brands = new Set();
  const categories = new Set();
  const rows = [];

  for (const item of Object.values(tariff.byBarcode)) {
    if (item.brand) brands.add(item.brand);
    if (item.category) categories.add(item.category);

    const product = findByBarcode(db.products, item.barcode) || {};
    const cost = findByBarcode(db.costs, item.barcode) || {};
    const snapshot = latestBuybox[item.barcode];
    const autoTrack = autoTrackByBarcode[item.barcode];
    const linkMeta = productLinkMeta(product);
    const buybox = buyboxProfitAtSnapshot(snapshot, item, cost, product);
    const tierContext = {
      buyboxPrice: buybox.buyboxPrice,
      selectedPrice: item.selectedPrice
    };
    const tiers = [1, 2, 3, 4].map((tier) => tierCell(item, tier, cost, tierContext));
    const activeTierCell = item.selectedTier
      ? tiers.find((tier) => tier.tier === item.selectedTier) || null
      : null;

    const row = {
      barcode: item.barcode,
      title: item.title || product.title || '',
      brand: item.brand || product.brand || '',
      category: item.category || '',
      modelCode: item.modelCode || '',
      size: item.size || '',
      stock: toNumber(item.stock ?? product.stock),
      productStatus: product.status || '',
      currentTsf: toNumber(item.currentTsf),
      buyboxPrice: buybox.buyboxPrice,
      buyboxOrder: buybox.buyboxOrder,
      buyboxSeller: buybox.buyboxSeller,
      buyboxNetProfit: buybox.netProfit,
      buyboxProfitRate: buybox.profitRate,
      buyboxProfitStatus: buybox.status,
      buyboxCommissionTier: buybox.commissionTier,
      buyboxCommissionRate: buybox.commissionRate,
      buyboxSource: snapshot?.buyboxSource || '',
      priceSource: buybox.priceSource || '',
      buyboxUnavailableReason: buybox.buyboxUnavailableReason || '',
      updatedAt: snapshot?.updatedAt || '',
      autoTracked: Boolean(autoTrack && autoTrack.enabled !== false),
      autoTrackPriority: autoTrack?.priority || '',
      productUrl: linkMeta.productUrl,
      imageUrl: linkMeta.imageUrl,
      selectedTier: item.selectedTier || null,
      selectedPrice: item.selectedPrice || '',
      selectionProfit: item.selectionProfit ?? '',
      selectionProfitRate: item.selectionProfitRate ?? '',
      selectedProfitStatus: activeTierCell?.status || '',
      tiers
    };

    if (matchesFilter(row, filters)) {
      rows.push(row);
    }
  }

  const sortBy = String(filters.sortBy || 'title');
  const sortDir = String(filters.sortDir || 'asc');
  const sortedRows = sortTariffRows(rows, sortBy, sortDir);

  return {
    rows: sortedRows,
    summary: buildTariffSummary(db),
    filterOptions: {
      brands: [...brands].sort((a, b) => a.localeCompare(b, 'tr')),
      categories: [...categories].sort((a, b) => a.localeCompare(b, 'tr'))
    }
  };
}

export function setTariffSelection(db, barcode, tier, options = {}) {
  const item = db.commissionTariff?.byBarcode?.[String(barcode)];
  if (!item) {
    throw Object.assign(new Error('Tarife kaydı bulunamadı.'), { statusCode: 404 });
  }

  if (!tier) {
    item.selectedTier = null;
    item.selectedPrice = '';
    item.selectedApplyUntilEnd = false;
    item.selectionProfit = '';
    item.selectionProfitRate = '';
    return item;
  }

  const normalizedTier = Number(tier);
  if (![1, 2, 3, 4].includes(normalizedTier)) {
    throw Object.assign(new Error('Geçersiz kademe.'), { statusCode: 400 });
  }

  const cost = findByBarcode(db.costs, barcode) || {};
  const snapshot = latestByBarcodeMap(db.buyboxSnapshots || [])[String(barcode)];
  const tierContext = {
    buyboxPrice: toNumber(snapshot?.buyboxPrice),
    selectedPrice: item.selectedPrice
  };
  const analysis = analyzeTierProfit(item, normalizedTier, cost, tierContext);
  const profit = analysis.profit;

  if (!profit || profit.status === 'EKSIK_VERI') {
    throw Object.assign(new Error('Maliyet/desi eksik — kademe seçilemez.'), { statusCode: 400 });
  }

  item.selectedTier = normalizedTier;
  item.selectedPrice = analysis.price;
  item.selectedApplyUntilEnd = options.applyUntilEnd !== false;
  item.selectionProfit = profit.netProfit;
  item.selectionProfitRate = profit.profitRate;
  return item;
}

export function getTariffProfitBreakdown(db, barcode, options = {}) {
  const item = db.commissionTariff?.byBarcode?.[String(barcode)];
  if (!item) {
    throw Object.assign(new Error('Tarife kaydı bulunamadı.'), { statusCode: 404 });
  }

  const cost = findByBarcode(db.costs, barcode) || {};
  const product = findByBarcode(db.products, barcode) || {};
  const source = String(options.source || 'tier').trim();
  let price = toNumber(options.price);
  let tier = options.tier ? Number(options.tier) : null;
  let commissionRate = 0;
  let priceLabel = 'Satış fiyatı';

  if (source === 'tier' && tier) {
    const snapshot = latestByBarcodeMap(db.buyboxSnapshots || [])[String(barcode)];
    const tierContext = {
      buyboxPrice: toNumber(snapshot?.buyboxPrice),
      selectedPrice: item.selectedPrice
    };
    price = tierReferencePrice(item, tier, tierContext);
    commissionRate = tierCommissionRate(item, tier);
    priceLabel = tierContext.buyboxPrice && Math.abs(tierContext.buyboxPrice - price) < 0.005
      ? 'BuyBox fiyatı (kademe ' + tier + ')'
      : `${tier}. kademe referans fiyatı`;
  } else if (source === 'buybox') {
    const snapshot = latestByBarcodeMap(db.buyboxSnapshots || [])[String(barcode)];
    const livePrice = toNumber(snapshot?.buyboxPrice);
    if (!price) price = livePrice;
    if (!price) {
      const tsf = toNumber(item.currentTsf);
      if (tsf > 0) {
        price = tsf;
        priceLabel = 'TSF (BuyBox yok)';
      }
    } else {
      priceLabel = livePrice && price === livePrice ? 'BuyBox fiyatı' : 'Satış fiyatı';
    }
    const resolved = resolveCommissionTier(item, price);
    tier = resolved?.tier ?? null;
    commissionRate = resolved?.rate || toNumber(cost.commissionRate);
  } else {
    if (!price) {
      throw Object.assign(new Error('Fiyat gerekli.'), { statusCode: 400 });
    }
    const resolved = resolveCommissionTier(item, price);
    tier = resolved?.tier ?? null;
    commissionRate = resolved?.rate || 0;
    priceLabel = source === 'manual' ? 'Manuel fiyat' : 'Satış fiyatı';
  }

  if (!price) {
    throw Object.assign(new Error('Hesaplanacak fiyat bulunamadı.'), { statusCode: 400 });
  }

  const profit = calculateProfitBreakdown({
    buyboxPrice: price,
    commissionRate,
    commissionTier: tier,
    productCost: cost.productCost,
    desi: cost.desi,
    priceLabel
  });

  return {
    barcode: String(barcode),
    title: item.title || product.title || '',
    brand: item.brand || product.brand || '',
    source,
    tier,
    rate: commissionRate,
    price,
    priceLabel,
    ...profit
  };
}

export function calculateManualTariffProfit(db, barcode, price) {
  const item = db.commissionTariff?.byBarcode?.[String(barcode)];
  if (!item) {
    throw Object.assign(new Error('Tarife kaydı bulunamadı.'), { statusCode: 404 });
  }

  const amount = toNumber(price);
  if (!amount) {
    throw Object.assign(new Error('Geçerli fiyat girin.'), { statusCode: 400 });
  }

  const cost = findByBarcode(db.costs, barcode) || {};
  const resolved = resolveCommissionTier(item, amount);
  const rate = resolved?.rate || 0;

  const profit = calculateProfit({
    buyboxPrice: amount,
    commissionRate: rate,
    productCost: cost.productCost,
    desi: cost.desi
  });

  return {
    barcode,
    price: amount,
    tier: resolved?.tier ?? null,
    rate,
    profit
  };
}

export { tierReferencePrice };
