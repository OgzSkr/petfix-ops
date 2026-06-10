const WC_PAGE_SIZE = 100;

function buildAuthHeader(key, secret) {
  return `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`;
}

function mapCatalogProduct(product) {
  const sku = String(product.sku || '').trim();
  const ean = String(product.global_unique_id || '').trim();
  const name = String(product.name || '').trim();
  const price = Number(product.price || product.regular_price || 0);

  return {
    wcProductId: Number(product.id) || null,
    wcParentId: Number(product.parent_id) || null,
    sku,
    ean,
    name,
    price: Number.isFinite(price) ? price : 0,
    status: product.status || '',
    type: product.type || '',
    permalink: product.permalink || '',
    stockQuantity: product.stock_quantity
  };
}

async function fetchJsonPage(url, headers) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`WooCommerce products HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
  }

  const rows = await response.json();
  return {
    rows: Array.isArray(rows) ? rows : [],
    totalPages: Math.max(1, Number(response.headers.get('x-wp-totalpages') || 1)),
    total: Number(response.headers.get('x-wp-total') || 0)
  };
}

async function fetchVariations(cfg, productId, headers) {
  const baseUrl = String(cfg.baseUrl || '').replace(/\/$/, '');
  const variations = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const url = new URL(`${baseUrl}/wp-json/wc/v3/products/${productId}/variations`);
    url.searchParams.set('per_page', String(WC_PAGE_SIZE));
    url.searchParams.set('page', String(page));
    url.searchParams.set('status', 'publish');

    const result = await fetchJsonPage(url, headers);
    totalPages = result.totalPages;
    variations.push(...result.rows);
    if (!result.rows.length) break;
    page += 1;
  }

  return variations;
}

/**
 * WooCommerce REST API v3 — yayındaki ürün kataloğu (read-only, sayfalı).
 */
export async function fetchWooCommerceCatalogProducts(cfg, options = {}) {
  const baseUrl = String(cfg.baseUrl || '').replace(/\/$/, '');
  if (!baseUrl || !cfg.key || !cfg.secret) {
    throw new Error('WooCommerce REST bilgileri eksik.');
  }

  const headers = {
    Authorization: buildAuthHeader(cfg.key, cfg.secret),
    Accept: 'application/json'
  };

  const byKey = new Map();
  let page = 1;
  let totalPages = 1;
  let totalReported = 0;
  let pagesFetched = 0;
  let variableParents = 0;

  while (page <= totalPages) {
    const url = new URL(`${baseUrl}/wp-json/wc/v3/products`);
    url.searchParams.set('per_page', String(WC_PAGE_SIZE));
    url.searchParams.set('page', String(page));
    url.searchParams.set('status', 'publish');
    url.searchParams.set('orderby', 'id');
    url.searchParams.set('order', 'asc');

    const result = await fetchJsonPage(url, headers);
    totalPages = result.totalPages;
    totalReported = Math.max(totalReported, result.total);
    pagesFetched += 1;

    for (const product of result.rows) {
      const type = String(product.type || '');

      if (type === 'variable') {
        variableParents += 1;
        const variations = await fetchVariations(cfg, product.id, headers);
        for (const variation of variations) {
          const mapped = mapCatalogProduct(variation);
          if (!mapped.sku) continue;
          byKey.set(mapped.sku, mapped);
        }
        continue;
      }

      const mapped = mapCatalogProduct(product);
      if (!mapped.sku) continue;
      byKey.set(mapped.sku, mapped);
    }

    if (!result.rows.length) break;
    page += 1;

    if (options.maxPages && pagesFetched >= options.maxPages) break;
  }

  return {
    products: [...byKey.values()],
    summary: {
      source: 'woocommerce_catalog',
      totalReported,
      pagesFetched,
      variableParents,
      distinctProducts: byKey.size,
      importedAt: new Date().toISOString()
    }
  };
}
