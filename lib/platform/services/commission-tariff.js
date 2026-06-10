import { readDb, writeDb } from '../../db/store.js';
import { parseXlsxBuffer } from '../../commission-tariff/xlsx-reader.js';
import { indexTariffItems, parseTrendyolTariffRows } from '../../commission-tariff/parse-tariff.js';
import { resolveCommissionTier, tierSummary } from '../../commission-tariff/resolve.js';
import {
  bulkSelectTariffOffers,
  buildExportRows,
  buildSelectionPreview,
  clearAllTariffSelections
} from '../../commission-tariff/bulk-select.js';
import {
  buildTariffAnalysis,
  setTariffSelection,
  calculateManualTariffProfit,
  getTariffProfitBreakdown
} from '../../commission-tariff/analysis.js';
import { preserveTariffSelections, syncTariffToCatalog } from '../../commission-tariff/sync-catalog.js';
import { writeXlsxBuffer } from '../../commission-tariff/xlsx-writer.js';
import {
  buildTariffPricePushPlan,
  pushTariffPricesToTrendyol
} from '../../commission-tariff/push-prices.js';

function emptyTariffMeta() {
  return {
    active: false,
    validFrom: '',
    validTo: '',
    importedAt: '',
    sourceFilename: '',
    itemCount: 0
  };
}

export function getCommissionTariffMeta(db) {
  const tariff = db.commissionTariff;
  if (!tariff?.byBarcode || !Object.keys(tariff.byBarcode).length) {
    return emptyTariffMeta();
  }

  const selectedCount = Object.values(tariff.byBarcode).filter((item) => item.selectedTier).length;

  return {
    active: true,
    validFrom: tariff.validFrom || '',
    validTo: tariff.validTo || '',
    importedAt: tariff.importedAt || '',
    sourceFilename: tariff.sourceFilename || '',
    itemCount: tariff.itemCount || Object.keys(tariff.byBarcode).length,
    selectedCount,
    hasSourceRows: Boolean(tariff.sourceRows?.length)
  };
}

export function getTariffItem(db, barcode) {
  return db.commissionTariff?.byBarcode?.[String(barcode)] || null;
}

export function resolveProductCommission(db, barcode, price) {
  const item = getTariffItem(db, barcode);
  if (!item) return null;
  return resolveCommissionTier(item, price);
}

export function createCommissionTariffService() {
  async function getStatus() {
    const db = await readDb();
    return getCommissionTariffMeta(db);
  }

  async function importTariff(payload = {}) {
    const { contentBase64, filename = '', validFrom = '', validTo = '' } = payload;

    if (!contentBase64) {
      throw Object.assign(new Error('Excel dosyası gerekli.'), { statusCode: 400 });
    }

    if (!validFrom || !validTo) {
      throw Object.assign(new Error('Tarife başlangıç ve bitiş tarihi gerekli.'), { statusCode: 400 });
    }

    const buffer = Buffer.from(contentBase64, 'base64');
    const rows = parseXlsxBuffer(buffer);
    const items = parseTrendyolTariffRows(rows);
    const byBarcode = indexTariffItems(items);

    const db = await readDb();
    const previousByBarcode = db.commissionTariff?.byBarcode || {};
    preserveTariffSelections(byBarcode, previousByBarcode);

    db.commissionTariff = {
      validFrom,
      validTo,
      importedAt: new Date().toISOString(),
      sourceFilename: filename,
      itemCount: items.length,
      sourceRows: rows,
      byBarcode
    };

    const catalogSync = syncTariffToCatalog(db, items);
    db.meta = db.meta || {};
    db.meta.updatedAt = new Date().toISOString();
    await writeDb(db);

    const catalogNote = catalogSync.productsAdded || catalogSync.costsAdded
      ? ` · ${catalogSync.productsAdded} yeni ürün, ${catalogSync.costsAdded} yeni maliyet kaydı`
      : '';

    return {
      ok: true,
      message: `${items.length} ürün komisyon tarifesi yüklendi${catalogNote}.`,
      catalogSync,
      ...getCommissionTariffMeta(db)
    };
  }

  async function syncCatalog() {
    const db = await readDb();
    const items = Object.values(db.commissionTariff?.byBarcode || {});
    if (!items.length) {
      throw Object.assign(new Error('Önce komisyon tarifesi yükleyin.'), { statusCode: 400 });
    }

    const catalogSync = syncTariffToCatalog(db, items);
    db.meta = db.meta || {};
    db.meta.updatedAt = new Date().toISOString();
    await writeDb(db);

    return {
      ok: true,
      message: `${catalogSync.productsAdded} ürün, ${catalogSync.costsAdded} maliyet kaydı eklendi.`,
      catalogSync,
      ...getCommissionTariffMeta(db)
    };
  }

  async function previewBarcode(barcode) {
    const db = await readDb();
    const item = getTariffItem(db, barcode);
    if (!item) {
      return { barcode, found: false };
    }

    return {
      barcode,
      found: true,
      title: item.title,
      brand: item.brand,
      currentTsf: item.currentTsf,
      currentCommission: item.currentCommission,
      tiers: tierSummary(item)
    };
  }

  async function bulkSelect(payload = {}) {
    const db = await readDb();
    const summary = bulkSelectTariffOffers(db, payload);
    db.meta = db.meta || {};
    db.meta.updatedAt = new Date().toISOString();
    await writeDb(db);

    const preview = buildSelectionPreview(db, 50);
    return {
      ok: true,
      summary,
      preview,
      ...getCommissionTariffMeta(db)
    };
  }

  async function getSelectionPreview() {
    const db = await readDb();
    return buildSelectionPreview(db, 50);
  }

  async function getAnalysis(searchParams) {
    const db = await readDb();
    const filters = {
      title: searchParams.get('title') || '',
      barcode: searchParams.get('barcode') || '',
      modelCode: searchParams.get('modelCode') || '',
      category: searchParams.get('category') || '',
      brand: searchParams.get('brand') || '',
      minStock: searchParams.get('minStock') ?? '',
      maxStock: searchParams.get('maxStock') ?? '',
      selectedOnly: searchParams.get('selectedOnly') === '1',
      missingBuybox: searchParams.get('missingBuybox') === '1',
      withBuybox: searchParams.get('withBuybox') === '1',
      fetchableMissing: searchParams.get('fetchableMissing') === '1',
      missingUrl: searchParams.get('missingUrl') === '1',
      missingCost: searchParams.get('missingCost') === '1',
      lossRisk: searchParams.get('lossRisk') === '1',
      buyboxRank: searchParams.get('buyboxRank') || '',
      profitFilter: searchParams.get('profit') || 'all',
      sortBy: searchParams.get('sortBy') || 'title',
      sortDir: searchParams.get('sortDir') || 'asc'
    };
    const analysis = buildTariffAnalysis(db, filters);
    return {
      meta: getCommissionTariffMeta(db),
      ...analysis
    };
  }

  async function selectTier(payload = {}) {
    const { barcode, tier, applyUntilEnd = true } = payload;
    if (!barcode) {
      throw Object.assign(new Error('Barkod gerekli.'), { statusCode: 400 });
    }

    const db = await readDb();
    setTariffSelection(db, barcode, tier ? Number(tier) : null, { applyUntilEnd });
    db.meta = db.meta || {};
    db.meta.updatedAt = new Date().toISOString();
    await writeDb(db);

    return {
      ok: true,
      ...getCommissionTariffMeta(db)
    };
  }

  async function manualCalculate(payload = {}) {
    const db = await readDb();
    return calculateManualTariffProfit(db, payload.barcode, payload.price);
  }

  async function clearSelections() {
    const db = await readDb();
    clearAllTariffSelections(db);
    db.meta = db.meta || {};
    db.meta.updatedAt = new Date().toISOString();
    await writeDb(db);
    return { ok: true, ...getCommissionTariffMeta(db) };
  }

  async function profitBreakdown(payload = {}) {
    const { barcode, price, tier, source } = payload;
    if (!barcode) {
      throw Object.assign(new Error('Barkod gerekli.'), { statusCode: 400 });
    }

    const db = await readDb();
    return getTariffProfitBreakdown(db, barcode, { price, tier, source });
  }

  async function previewPricePush(payload = {}) {
    const db = await readDb();
    return buildTariffPricePushPlan(db, {
      profitableOnly: payload.profitableOnly !== false,
      barcodes: payload.barcodes
    });
  }

  async function pushPrices(payload = {}) {
    const db = await readDb();
    const result = await pushTariffPricesToTrendyol(db, {
      profitableOnly: payload.profitableOnly !== false,
      barcodes: payload.barcodes,
      price: payload.price,
      dryRun: payload.dryRun === true,
      waitForBatch: payload.waitForBatch !== false
    });

    if (result.ok && !result.dryRun && (result.localUpdates?.tariffUpdated || result.localUpdates?.productsUpdated)) {
      db.meta = db.meta || {};
      db.meta.updatedAt = new Date().toISOString();
      await writeDb(db);
    }

    return {
      ...result,
      ...getCommissionTariffMeta(db)
    };
  }

  async function sendExport(response) {
    const db = await readDb();
    const rows = buildExportRows(db.commissionTariff);
    const buffer = writeXlsxBuffer(rows);
    const baseName = String(db.commissionTariff?.sourceFilename || 'komisyon-tarifesi')
      .replace(/\.xlsx$/i, '');
    const filename = `${baseName}-secim.xlsx`;

    response.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`
    });
    response.end(buffer);
  }

  return {
    getStatus,
    importTariff,
    previewBarcode,
    bulkSelect,
    getSelectionPreview,
    getAnalysis,
    selectTier,
    manualCalculate,
    clearSelections,
    profitBreakdown,
    previewPricePush,
    pushPrices,
    sendExport,
    syncCatalog,
    getCommissionTariffMeta,
    getTariffItem,
    resolveProductCommission
  };
}

export { resolveCommissionTier, tierSummary };
