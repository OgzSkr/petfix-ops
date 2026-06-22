import { fetchTgoJson, resolveUberStoreId } from './tgo-market-api.js';

const PAGE_SIZE = 100;
const LIST_TYPES = ['ON_SALE', 'NOT_ON_SALE', 'OUT_OF_STOCK', 'ALL_PRODUCT'];

function snapshotSale(row) {
  return {
    onSale: Boolean(row.onSale),
    quantity: Number(row.quantity) || 0
  };
}

/** ON_SALE listesi, eski NOT_ON_SALE kaydına baskın gelir. */
export function resolveCatalogSaleState(product) {
  const snaps = product?.listTypeSnapshots || {};
  if (snaps.ON_SALE?.onSale) {
    return { onSale: true, quantity: snaps.ON_SALE.quantity };
  }
  if (snaps.ALL_PRODUCT) {
    return {
      onSale: Boolean(snaps.ALL_PRODUCT.onSale),
      quantity: snaps.ALL_PRODUCT.quantity
    };
  }
  if (snaps.NOT_ON_SALE) {
    return { onSale: false, quantity: snaps.NOT_ON_SALE.quantity };
  }
  if (snaps.OUT_OF_STOCK) {
    return { onSale: false, quantity: snaps.OUT_OF_STOCK.quantity };
  }
  return {
    onSale: Boolean(product?.onSale),
    quantity: Number(product?.quantity) || 0
  };
}

function mergeCatalogEntry(existing, incoming, listType, rowModified) {
  const merged = { ...existing };
  merged.catalogListTypes = [...new Set([...(existing.catalogListTypes || []), listType])];
  merged.listTypeSnapshots = {
    ...(existing.listTypeSnapshots || {}),
    [listType]: snapshotSale(incoming)
  };

  if (rowModified > (existing.catalogLastModified || 0)) {
    merged.uberProductId = incoming.uberProductId;
    merged.storeId = incoming.storeId;
    merged.title = incoming.title;
    merged.description = incoming.description;
    merged.sellingPrice = incoming.sellingPrice;
    merged.originalPrice = incoming.originalPrice;
    merged.stockCode = incoming.stockCode;
    merged.brandName = incoming.brandName;
    merged.categoryName = incoming.categoryName;
    merged.contentId = incoming.contentId;
    merged.catalogLastModified = incoming.catalogLastModified;
    merged.imageUrl = incoming.imageUrl;
  }

  const sale = resolveCatalogSaleState(merged);
  merged.onSale = sale.onSale;
  merged.quantity = sale.quantity;
  return merged;
}

function upsertCatalogRow(byBarcode, row, storeId, listType) {
  const barcode = String(row.barcode || '').trim();
  if (!barcode) return;

  const incoming = mapCatalogRow(row, storeId, listType);
  const existing = byBarcode.get(barcode);
  if (!existing) {
    byBarcode.set(barcode, {
      ...incoming,
      listTypeSnapshots: { [listType]: snapshotSale(incoming) }
    });
    return;
  }

  byBarcode.set(
    barcode,
    mergeCatalogEntry(existing, incoming, listType, Number(row.lastModifiedDate) || 0)
  );
}

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

  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;

  for (let typeIndex = 0; typeIndex < listTypes.length; typeIndex += 1) {
    const type = listTypes[typeIndex];
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
      const totalPages = Math.max(Number(data.totalPages) || 1, page + 1);

      for (const row of content) {
        upsertCatalogRow(byBarcode, row, storeId, type);
      }

      if (onProgress) {
        const slicePercent = Math.round(85 / listTypes.length);
        const basePercent = Math.round((typeIndex / listTypes.length) * 85);
        onProgress({
          phase: 'fetch',
          listType: type,
          page: page + 1,
          totalPages,
          fetchedProducts: byBarcode.size,
          basePercent,
          slicePercent,
          message: `TGO katalog — ${type} sayfa ${page + 1}/${totalPages} (${byBarcode.size} ürün)`
        });
      }

      page += 1;
      if (!content.length || (data.totalPages && page >= Number(data.totalPages))) {
        break;
      }
    }
  }

  return {
    storeId,
    products: [...byBarcode.values()].map((product) => {
      const sale = resolveCatalogSaleState(product);
      return { ...product, onSale: sale.onSale, quantity: sale.quantity };
    }),
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
