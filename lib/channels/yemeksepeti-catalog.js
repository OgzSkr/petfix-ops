import { getYemeksepetiAccessToken } from './yemeksepeti-auth.js';

const API_BASE = 'https://yemeksepeti.partner.deliveryhero.io/v2';
const DEFAULT_PAGE_SIZE = 100;

function firstBarcode(value) {
  if (Array.isArray(value)) {
    return String(value[0] || '').trim();
  }
  return String(value || '').trim();
}

function pickTitle(product) {
  const translations = product.translations || {};
  return String(translations.tr_TR || translations.en_TR || product.title || '').trim();
}

/**
 * Yemeksepeti Assortment / Katalog API — read-only ürün listesi.
 * GET /v2/chains/{chainId}/vendors/{vendorId}/catalog
 */
export async function fetchYemeksepetiCatalogProducts(cfg, options = {}) {
  const chainId = String(cfg.chainId || '').trim();
  const vendorId = String(cfg.vendorId || '').trim();

  if (!chainId || !vendorId) {
    throw new Error('Yemeksepeti CHAIN_ID ve VENDOR_ID zorunludur.');
  }

  const pageSize = Math.min(200, Math.max(25, Number(options.pageSize) || DEFAULT_PAGE_SIZE));
  const maxPages = options.maxPages != null
    ? Math.max(1, Number(options.maxPages) || 1)
    : null;
  const startPage = Math.max(1, Number(options.startPage) || 1);
  const onPage = typeof options.onPage === 'function' ? options.onPage : null;

  const accessToken = await getYemeksepetiAccessToken(cfg);
  const products = [];
  let page = startPage;
  let totalPages = 1;
  let pagesFetched = 0;

  while (page <= totalPages) {
    if (maxPages != null && pagesFetched >= maxPages) break;

    const query = new URLSearchParams({
      page: String(page),
      page_size: String(pageSize)
    });

    const response = await fetch(
      `${API_BASE}/chains/${encodeURIComponent(chainId)}/vendors/${encodeURIComponent(vendorId)}/catalog?${query}`,
      {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`
        }
      }
    );

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Yemeksepeti katalog hatası: HTTP ${response.status} - ${text.slice(0, 300)}`);
    }

    const data = text ? JSON.parse(text) : {};
    totalPages = Math.max(Number(data.total_pages) || 1, 1);
    if (pagesFetched === 0 && page > totalPages) {
      page = 1;
    }

    const rows = (data.products || []).map((row) => ({
      remoteProductId: String(row.remote_product_id || '').trim(),
      sku: String(row.sku || '').trim(),
      barcode: firstBarcode(row.barcodes),
      title: pickTitle(row),
      price: row.price != null ? Number(row.price) : null,
      active: row.active !== false,
      categories: row.categories || [],
      imageUrl: Array.isArray(row.images) ? String(row.images[0] || '').trim() : ''
    }));

    products.push(...rows);
    totalPages = Math.max(Number(data.total_pages) || totalPages, 1);

    if (onPage) {
      await onPage(rows, { page, totalPages, pageSize });
    }

    page += 1;
    pagesFetched += 1;
    if (!rows.length) break;
  }

  const lastFetchedPage = pagesFetched > 0 ? page - 1 : startPage - 1;
  const truncated = maxPages != null && lastFetchedPage < totalPages;

  return {
    products,
    summary: {
      source: 'yemeksepeti_catalog',
      pageSize,
      startPage,
      fetchedPages: pagesFetched,
      lastFetchedPage,
      totalPages,
      truncated,
      nextPage: truncated ? (lastFetchedPage >= totalPages ? 1 : lastFetchedPage + 1) : 1
    }
  };
}
