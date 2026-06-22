import { readDb, writeDb } from '../db/store.js';
import { mergeBenimposEmptyCosts } from '../product-import/benimpos-empty-costs.js';
import { createBenimposClient, mapProductToCostItem, readBenimposConfig } from './client.js';

/**
 * BenimPOS'tan yalnızca okur; paneldeki boş maliyet alanlarını doldurur.
 * BenimPOS tarafında hiçbir değişiklik yapılmaz.
 */
export async function syncEmptyCostsFromBenimposApi(options = {}) {
  const cfg = await readBenimposConfig();
  const client = createBenimposClient(cfg);

  const { products, totalProductsCount } = await client.listAllProducts(
    options.includeBranches ? { includeBranches: true } : {},
    options.onPage ? { onPage: options.onPage } : {}
  );

  const items = products
    .map(mapProductToCostItem)
    .filter((item) => item.barcode && item.productCost > 0);

  const db = await readDb();
  const summary = mergeBenimposEmptyCosts(db, items, {
    sourceName: 'BenimPOS API'
  });

  db.meta = db.meta || {};
  db.meta.benimposApiSync = {
    syncedAt: new Date().toISOString(),
    totalProductsCount,
    mappedWithCost: items.length,
    ...summary
  };

  await writeDb(db);

  return {
    ok: true,
    totalProductsCount,
    mappedWithCost: items.length,
    ...summary
  };
}
