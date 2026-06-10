import { channelProductIdFor } from '../constants.js';
import { normalizeBarcode } from '../normalize.js';

/**
 * Trendyol Pazaryeri ürün kataloğunu panel db.products kayıtlarından eşleştirme havuzuna aktarır.
 */
export function ingestTrendyolCatalogProducts(db) {
  const products = db.products || [];
  const now = new Date().toISOString();
  const channelProducts = [];

  for (const product of products) {
    const barcode = normalizeBarcode(product.barcode);
    if (!barcode) continue;

    const title = String(product.title || product.brand || barcode).trim() || barcode;
    channelProducts.push({
      id: channelProductIdFor('trendyol-marketplace', barcode),
      channelId: 'trendyol-marketplace',
      channelProductId: barcode,
      channelBarcode: barcode,
      channelName: title,
      ingestSource: 'trendyol_catalog',
      ingestedAt: now
    });
  }

  return {
    channelProducts,
    summary: {
      source: 'trendyol_catalog',
      scanned: products.length,
      prepared: channelProducts.length,
      importedAt: now
    }
  };
}
