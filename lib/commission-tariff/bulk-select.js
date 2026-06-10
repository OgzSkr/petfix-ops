import { findByBarcode, toNumber } from '../utils.js';
import { calculateProfit, latestByBarcodeMap } from '../platform/services/profitability.js';

const DEFAULT_TIERS = [4, 3, 2];

function tierBounds(item, tier) {
  if (!item) return null;
  if (tier === 1) return { lower: toNumber(item.tier1Lower), upper: Infinity };
  if (tier === 2) return { lower: toNumber(item.tier2Lower), upper: toNumber(item.tier2Upper) };
  if (tier === 3) return { lower: toNumber(item.tier3Lower), upper: toNumber(item.tier3Upper) };
  if (tier === 4) return { lower: 0, upper: toNumber(item.tier4Upper) };
  return null;
}

export function priceInTier(item, tier, price) {
  const amount = toNumber(price);
  const bounds = tierBounds(item, tier);
  if (!bounds || !amount) return false;
  if (tier === 1) return bounds.lower > 0 && amount >= bounds.lower;
  if (tier === 4) return bounds.upper > 0 && amount <= bounds.upper;
  return bounds.lower > 0 && bounds.upper > 0 && amount >= bounds.lower && amount <= bounds.upper;
}

/** Kademe kârı için referans fiyat — BuyBox/seçili fiyat öncelikli, TSF ile şişirme yok. */
export function tierReferencePrice(item, tier, context = {}) {
  if (!item) return 0;

  const buybox = toNumber(context.buyboxPrice);
  const selected = toNumber(context.selectedPrice);

  for (const candidate of [buybox, selected]) {
    if (candidate > 0 && priceInTier(item, tier, candidate)) {
      return candidate;
    }
  }

  if (tier === 4) return toNumber(item.tier4Upper);
  if (tier === 3) return toNumber(item.tier3Upper);
  if (tier === 2) return toNumber(item.tier2Upper);
  if (tier === 1) return toNumber(item.tier1Lower);
  return 0;
}

export function tierReferencePriceBasis(item, tier, context = {}) {
  const price = tierReferencePrice(item, tier, context);
  if (!price) return { price: 0, basis: 'none' };

  const buybox = toNumber(context.buyboxPrice);
  const selected = toNumber(context.selectedPrice);
  if (buybox > 0 && Math.abs(buybox - price) < 0.005) return { price, basis: 'buybox' };
  if (selected > 0 && Math.abs(selected - price) < 0.005) return { price, basis: 'selected' };
  return { price, basis: 'tier-bound' };
}

export function tierCommissionRate(item, tier) {
  if (!item) return 0;
  return toNumber(item[`commission${tier}`]);
}

function resetSelections(byBarcode) {
  for (const item of Object.values(byBarcode || {})) {
    item.selectedTier = null;
    item.selectedPrice = '';
    item.selectedApplyUntilEnd = false;
    item.selectionProfit = '';
    item.selectionProfitRate = '';
  }
}

export function clearAllTariffSelections(db) {
  const tariff = db.commissionTariff;
  if (!tariff?.byBarcode) {
    throw Object.assign(new Error('Komisyon tarifesi yüklenmemiş.'), { statusCode: 400 });
  }
  resetSelections(tariff.byBarcode);
  return { cleared: true };
}

export function analyzeTierProfit(item, tier, cost, context = {}) {
  const { price, basis } = tierReferencePriceBasis(item, tier, context);
  const rate = tierCommissionRate(item, tier);
  if (!price || !rate) {
    return { tier, price, basis, rate, profit: null };
  }

  return {
    tier,
    price,
    basis,
    rate,
    profit: calculateProfit({
      buyboxPrice: price,
      commissionRate: rate,
      productCost: cost?.productCost,
      desi: cost?.desi
    })
  };
}

export function bulkSelectTariffOffers(db, options = {}) {
  const tariff = db.commissionTariff;
  if (!tariff?.byBarcode) {
    throw Object.assign(new Error('Komisyon tarifesi yüklenmemiş.'), { statusCode: 400 });
  }

  const minNetProfit = toNumber(options.minNetProfit ?? 0);
  const minProfitRate = toNumber(options.minProfitRate ?? 0);
  const tiers = Array.isArray(options.tiers) && options.tiers.length
    ? options.tiers.map(Number).filter((tier) => [1, 2, 3, 4].includes(tier))
    : DEFAULT_TIERS;
  const applyUntilEnd = options.applyUntilEnd !== false;

  resetSelections(tariff.byBarcode);
  const latestBuybox = latestByBarcodeMap(db.buyboxSnapshots || []);

  const selectedBarcodes = new Set();
  const summary = {
    total: 0,
    skippedMissingData: 0,
    byTier: Object.fromEntries(tiers.map((tier) => [tier, 0]))
  };

  for (const tier of tiers) {
    for (const item of Object.values(tariff.byBarcode)) {
      if (selectedBarcodes.has(item.barcode)) continue;

      const cost = findByBarcode(db.costs || [], item.barcode) || {};
      const snapshot = latestBuybox[item.barcode];
      const tierContext = {
        buyboxPrice: toNumber(snapshot?.buyboxPrice),
        selectedPrice: item.selectedPrice
      };
      const analysis = analyzeTierProfit(item, tier, cost, tierContext);
      const profit = analysis.profit;

      if (!profit || profit.status === 'EKSIK_VERI') {
        summary.skippedMissingData += 1;
        continue;
      }

      const netProfit = toNumber(profit.netProfit);
      const profitRate = toNumber(profit.profitRate);

      if (netProfit >= minNetProfit && profitRate >= minProfitRate) {
        item.selectedTier = tier;
        item.selectedPrice = analysis.price;
        item.selectedApplyUntilEnd = applyUntilEnd;
        item.selectionProfit = profit.netProfit;
        item.selectionProfitRate = profit.profitRate;
        selectedBarcodes.add(item.barcode);
        summary.byTier[tier] = (summary.byTier[tier] || 0) + 1;
        summary.total += 1;
      }
    }
  }

  return summary;
}

export function buildSelectionPreview(db, limit = 25) {
  const tariff = db.commissionTariff;
  if (!tariff?.byBarcode) return { rows: [], summary: { selected: 0, total: 0 } };

  const latestBuybox = latestByBarcodeMap(db.buyboxSnapshots || []);
  const rows = Object.values(tariff.byBarcode)
    .filter((item) => item.selectedTier)
    .slice(0, limit)
    .map((item) => {
      const snapshot = latestBuybox[item.barcode];
      return {
        barcode: item.barcode,
        title: item.title,
        brand: item.brand,
        selectedTier: item.selectedTier,
        selectedPrice: item.selectedPrice,
        selectionProfit: item.selectionProfit,
        selectionProfitRate: item.selectionProfitRate,
        buyboxPrice: snapshot?.buyboxPrice ?? '',
        currentTsf: item.currentTsf
      };
    });

  const selected = Object.values(tariff.byBarcode).filter((item) => item.selectedTier).length;
  const byTier = Object.values(tariff.byBarcode).reduce((acc, item) => {
    if (!item.selectedTier) return acc;
    acc[item.selectedTier] = (acc[item.selectedTier] || 0) + 1;
    return acc;
  }, {});

  return {
    rows,
    summary: {
      selected,
      total: Object.keys(tariff.byBarcode).length,
      byTier
    }
  };
}

const EXPORT_COL = {
  NEW_TSF: 21,
  APPLY_UNTIL_END: 23
};

function findHeaderRowIndex(rows) {
  return rows.findIndex((row) => row.some((cell) => String(cell || '').trim().toUpperCase() === 'BARKOD'));
}

function reconstructRowFromItem(item) {
  return [
    item.title || '',
    item.barcode || '',
    item.sellerStockCode || '',
    item.size || '',
    item.modelCode || '',
    item.category || '',
    item.brand || '',
    item.stock ?? '',
    item.tier1Lower ?? '',
    item.tier2Upper ?? '',
    item.tier2Lower ?? '',
    item.tier3Upper ?? '',
    item.tier3Lower ?? '',
    item.tier4Upper ?? '',
    item.commission1 ?? '',
    item.commission2 ?? '',
    item.commission3 ?? '',
    item.commission4 ?? '',
    item.commissionBasePrice ?? '',
    item.currentCommission ?? '',
    item.currentTsf ?? '',
    '',
    item.calculatedCommission ?? '',
    item.applyUntilEnd ? 'Evet' : 'Hayır',
    item.externalId || '',
    item.tariffGroup || ''
  ];
}

const TARIFF_EXPORT_HEADER = [
  'ÜRÜN İSMİ', 'BARKOD', 'SATICI STOK KODU', 'BEDEN', 'MODEL KODU', 'KATEGORİ', 'MARKA', 'STOK',
  '1.Fiyat Alt Limit', '2.Fiyat Üst Limiti', '2.Fiyat Alt Limit', '3.Fiyat Üst Limiti', '3.Fiyat Alt Limit', '4.Fiyat Üst Limiti',
  '1.KOMİSYON', '2.KOMİSYON', '3.KOMİSYON', '4.KOMİSYON',
  'KOMİSYONA ESAS FİYAT', 'GÜNCEL KOMİSYON', 'GÜNCEL TSF', 'YENİ TSF (FİYAT GÜNCELLE)',
  'Hesaplanan Komisyon', 'Tarife Sonuna Kadar Uygula', 'EXTERNAL ID', 'TARİFE GRUBU'
];

/** Orijinal Excel yoksa byBarcode verisinden sourceRows üretir (export için). */
export function buildSourceRowsFromTariff(tariff) {
  if (!tariff?.byBarcode || !Object.keys(tariff.byBarcode).length) {
    return null;
  }
  return [
    TARIFF_EXPORT_HEADER,
    ...Object.values(tariff.byBarcode).map(reconstructRowFromItem)
  ];
}

export function backfillTariffSourceRows(db) {
  const tariff = db.commissionTariff;
  if (!tariff?.byBarcode || tariff.sourceRows?.length) {
    return { skipped: true, reason: tariff?.sourceRows?.length ? 'sourceRows zaten mevcut' : 'Aktif tarife yok' };
  }

  tariff.sourceRows = buildSourceRowsFromTariff(tariff);
  db.meta = db.meta || {};
  db.meta.updatedAt = new Date().toISOString();
  db.meta.tariffSourceRowsBackfill = new Date().toISOString();

  return {
    ok: true,
    rowCount: tariff.sourceRows.length,
    itemCount: Object.keys(tariff.byBarcode).length
  };
}

export function buildExportRows(tariff) {
  if (!tariff?.byBarcode) {
    throw Object.assign(new Error('Komisyon tarifesi yüklenmemiş.'), { statusCode: 400 });
  }

  let rows = tariff.sourceRows?.length
    ? tariff.sourceRows.map((row) => [...row])
    : null;

  if (!rows) {
    rows = buildSourceRowsFromTariff(tariff);
    if (!rows) {
      throw Object.assign(new Error('Komisyon tarifesi yüklenmemiş.'), { statusCode: 400 });
    }
  }

  const headerIndex = findHeaderRowIndex(rows);
  if (headerIndex < 0) {
    throw Object.assign(new Error('Excel başlık satırı bulunamadı.'), { statusCode: 400 });
  }

  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const row = rows[index];
    while (row.length < 26) row.push('');
    const barcode = String(row[1] || '').trim();
    const item = tariff.byBarcode[barcode];
    if (!item?.selectedTier) {
      row[EXPORT_COL.NEW_TSF] = '';
      row[EXPORT_COL.APPLY_UNTIL_END] = 'Hayır';
      continue;
    }
    row[EXPORT_COL.NEW_TSF] = item.selectedPrice ?? '';
    row[EXPORT_COL.APPLY_UNTIL_END] = item.selectedApplyUntilEnd ? 'Evet' : 'Hayır';
  }

  return rows;
}
