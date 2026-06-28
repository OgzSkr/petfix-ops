import { createBenimposClient, mapProductToCostItem, readBenimposConfig } from '../benimpos/client.js';
import { masterProductIdForBarcode } from './constants.js';
import { detectVariantKey, normalizeBarcode, parseWeightGrams } from './normalize.js';

export function mapBenimposProductToMaster(product, syncedAt) {
  const barcode = normalizeBarcode(product?.barcode);
  const name = String(product?.name || '').trim();
  const categoryName = String(product?.categoryName || '').trim();

  return {
    id: masterProductIdForBarcode(barcode),
    benimposBarcode: barcode,
    name,
    brand: categoryName || '',
    categoryName,
    stock: Number(product?.quantity) || 0,
    buyingPrice: Number(product?.buyingPrice) || 0,
    salePrice1: Number(product?.salePrice1) || 0,
    salePrice2: Number(product?.salePrice2) || 0,
    taxRate: Number(product?.taxRate) || 20,
    stockCode: String(product?.stockCode || '').trim(),
    unitValue: String(product?.unitValue || '').trim(),
    isOnline: Boolean(product?.isOnline),
    normalizedWeightG: parseWeightGrams(name),
    variantKey: detectVariantKey(name),
    autoStockSync: true,
    syncedAt
  };
}

/**
 * BenimPOS → masterProducts (read-only kaynak).
 * Master sync sonrası channelCosts hizalanır (master-cost-sync).
 */
export async function syncMasterProductsFromBenimpos(options = {}) {
  const cfg = await readBenimposConfig();
  const client = createBenimposClient(cfg);
  const syncedAt = new Date().toISOString();

  const { products, totalProductsCount } = await client.listAllProducts(
    {},
    options.onPage ? { onPage: options.onPage } : {}
  );

  const masterProducts = products
    .map((product) => mapBenimposProductToMaster(product, syncedAt))
    .filter((row) => row.benimposBarcode);

  const withCost = masterProducts.filter((row) => row.buyingPrice > 0).length;
  const withStock = masterProducts.filter((row) => row.stock > 0).length;

  return {
    masterProducts,
    summary: {
      syncedAt,
      totalProductsCount: totalProductsCount || masterProducts.length,
      imported: masterProducts.length,
      withCost,
      withStock,
      source: 'benimpos-api'
    }
  };
}

export function indexMasterProductsByBarcode(masterProducts = []) {
  const map = new Map();
  for (const row of masterProducts) {
    const barcode = normalizeBarcode(row.benimposBarcode);
    if (barcode) map.set(barcode, row);
  }
  return map;
}

/** Maliyet özeti — mapProductToCostItem ile uyumlu */
export function masterProductAsCostItem(master) {
  const item = mapProductToCostItem({
    barcode: master.benimposBarcode,
    buyingPrice: master.buyingPrice,
    taxRate: master.taxRate,
    name: master.name
  });
  return item.productCost > 0 ? item : null;
}
