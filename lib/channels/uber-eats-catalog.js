import { fetchTgoJson, resolveUberStoreId } from './tgo-market-api.js';

const PAGE_SIZE = 100;
const LIST_TYPES = ['ON_SALE', 'NOT_ON_SALE', 'OUT_OF_STOCK', 'ALL_PRODUCT'];

/**
 * Uber Eats Trendyol Go Market — mağaza ürün kataloğu (api.tgoapis.com).
 * @see https://developers.tgoapps.com/docs/category/7-uber-eats-trendyol-go---market-entegrasyonu
 */
export async function fetchUberEatsCatalogProducts(cfg, options = {}) {
  const storeId = options.storeId || await resolveUberStoreId(cfg, options);
  const listType = options.listType || 'ALL_PRODUCT';
  const listTypes = options.allListTypes ? LIST_TYPES : [listType];

  const byBarcode = new Map();
  let totalElements = 0;
  let pagesFetched = 0;

  for (const type of listTypes) {
    let page = 0;
    while (true) {
      const query = new URLSearchParams({
        listType: type,
        page: String(page),
        size: String(PAGE_SIZE),
        orderBy: 'LAST_MODIFIED_DATE',
        order: 'DESC'
      });

      const data = await fetchTgoJson(
        cfg,
        `/integrator/product/grocery/suppliers/${encodeURIComponent(cfg.supplierId)}`
          + `/stores/${encodeURIComponent(storeId)}/products?${query}`
      );

      const content = data.content || [];
      pagesFetched += 1;
      totalElements = Math.max(totalElements, Number(data.totalElements) || 0);

      for (const row of content) {
        const barcode = String(row.barcode || '').trim();
        if (!barcode) continue;

        const existing = byBarcode.get(barcode);
        if (existing) {
          existing.catalogListTypes = [...new Set([...(existing.catalogListTypes || []), type])];
          if (row.lastModifiedDate > (existing.catalogLastModified || 0)) {
            Object.assign(existing, mapCatalogRow(row, storeId, type));
          }
          continue;
        }

        byBarcode.set(barcode, mapCatalogRow(row, storeId, type));
      }

      page += 1;
      if (!content.length || (data.totalPages && page >= Number(data.totalPages))) {
        break;
      }
    }
  }

  return {
    storeId,
    products: [...byBarcode.values()],
    summary: {
      storeId,
      listType: options.allListTypes ? 'ALL_TYPES' : listType,
      distinctProducts: byBarcode.size,
      totalElementsReported: totalElements,
      pagesFetched
    }
  };
}

function mapCatalogRow(row, storeId, listType) {
  return {
    uberProductId: row.id || null,
    storeId: Number(row.storeId || storeId),
    barcode: String(row.barcode || '').trim(),
    title: String(row.title || '').trim(),
    description: String(row.description || '').trim(),
    sellingPrice: Number(row.sellingPrice) || 0,
    originalPrice: row.originalPrice != null ? Number(row.originalPrice) : null,
    quantity: Number(row.quantity) || 0,
    onSale: Boolean(row.onSale),
    stockCode: String(row.stockCode || '').trim(),
    brandName: row.brand?.name || '',
    categoryName: row.category?.name || '',
    contentId: row.contentId || null,
    catalogLastModified: Number(row.lastModifiedDate) || 0,
    catalogListTypes: [listType],
    imageUrl: row.images?.[0]?.url || null
  };
}
