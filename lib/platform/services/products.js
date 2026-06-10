import {
  buildProductCatalog,
  parseProductFilters,
  productRowToCsv
} from '../../product-catalog.js';
import { COST_SCOPE, normalizeCostScope, costCollectionKey, costsForScope } from '../../cost-scopes.js';
import { readDb, writeDb } from '../../db/store.js';
import { findByBarcode } from '../../utils.js';
import { mergeProductImport } from '../../product-import/merge-import.js';
import { parseProductsXlsxBuffer } from '../../product-import/parse-products-xlsx.js';

export function createProductsService() {
  function resolveCostScope(searchParamsOrPayload) {
    return normalizeCostScope(searchParamsOrPayload?.costScope || searchParamsOrPayload?.get?.('costScope'));
  }

  async function upsertProductSettings(payload) {
    if (!payload || !payload.barcode) {
      throw new Error('barcode zorunludur.');
    }

    const db = await readDb();
    const barcode = String(payload.barcode);
    const costScope = resolveCostScope(payload);
    const collectionKey = costCollectionKey(costScope);
    const costs = costsForScope(db, costScope);
    const existing = findByBarcode(costs, barcode);
    const product = findByBarcode(db.products, barcode) || {};

    const next = {
      barcode,
      productCost: payload.productCost ?? existing?.productCost ?? '',
      desi: payload.desi ?? existing?.desi ?? '',
      commissionRate: payload.commissionRate ?? existing?.commissionRate ?? product.commissionRate ?? '',
      costVatRate: payload.costVatRate ?? existing?.costVatRate ?? 20,
      modelCode: payload.modelCode ?? existing?.modelCode ?? '',
      color: payload.color ?? existing?.color ?? '',
      size: payload.size ?? existing?.size ?? '',
      returnRate: payload.returnRate ?? existing?.returnRate ?? 0,
      returnRateLabel: payload.returnRateLabel ?? existing?.returnRateLabel ?? '',
      deliveryType: payload.deliveryType ?? existing?.deliveryType ?? 'Bugün Kargoda',
      extraExpense: payload.extraExpense ?? existing?.extraExpense ?? 0,
      note: existing?.note ?? '',
      updatedAt: new Date().toISOString()
    };

    if (existing) {
      Object.assign(existing, next);
    } else {
      if (!Array.isArray(db[collectionKey])) {
        db[collectionKey] = [];
      }
      db[collectionKey].push(next);
    }

    if (costScope === COST_SCOPE.TRENDYOL_MARKETPLACE) {
      db.profitSnapshots = (db.profitSnapshots || []).filter((snapshot) => String(snapshot.barcode) !== barcode);
    }

    db.meta.updatedAt = new Date().toISOString();
    await writeDb(db);
    return { ok: true, cost: next, costScope };
  }

    async function listProducts(searchParams) {
    const db = await readDb();
    const costScope = resolveCostScope(searchParams);
    const filters = parseProductFilters(searchParams);
    const rows = buildProductCatalog(db, filters, { costScope });
    const costs = costsForScope(db, costScope);
    const emptyCostCount = costs.filter((row) => {
      const value = row?.productCost;
      return value === '' || value === null || value === undefined;
    }).length;

    return {
      updatedAt: new Date().toISOString(),
      costScope,
      total: (db.products || []).length,
      filtered: rows.length,
      summary: {
        listed: costs.length,
        emptyCost: emptyCostCount,
        withCost: Math.max(0, costs.length - emptyCostCount)
      },
      rows
    };
  }

  async function sendCsvExport(response, searchParams) {
    const db = await readDb();
    const costScope = resolveCostScope(searchParams);
    const filters = parseProductFilters(searchParams);
    const rows = buildProductCatalog(db, filters, { costScope });
    const csv = productRowToCsv(rows);
    const fileLabel = costScope === COST_SCOPE.OTHER_CHANNELS ? 'diger-kanal-maliyetleri' : 'urun-ayarlari';

    response.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileLabel}.csv"`
    });
    response.end(csv);
  }

  async function importExcel(payload = {}) {
    const { contentBase64, filename = '' } = payload;
    if (!contentBase64) {
      throw Object.assign(new Error('Excel dosyası gerekli.'), { statusCode: 400 });
    }

    const buffer = Buffer.from(contentBase64, 'base64');
    const parsed = parseProductsXlsxBuffer(buffer);
    const db = await readDb();
    const summary = mergeProductImport(db, parsed);
    await writeDb(db);

    return {
      ok: true,
      filename,
      message: `${summary.productsAdded} yeni ürün, ${summary.costsAdded} yeni maliyet` +
        (summary.snapshotsImported ? `, ${summary.snapshotsImported} BuyBox snapshot` : '') +
        ' eklendi.',
      summary
    };
  }

  return { upsertProductSettings, listProducts, sendCsvExport, importExcel };
}
