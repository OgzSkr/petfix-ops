import { costsForScope, normalizeCostScope } from './cost-scopes.js';
import { trendyolProductUrlFromProduct } from './product-thumb.js';

function toNum(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function text(value) {
  return String(value ?? '').trim();
}

export function mergeProductRow(product, cost = {}) {
  const barcode = String(product.barcode || '');
  const productCost = cost.productCost ?? '';
  const hasCost = productCost !== '' && productCost !== null && toNum(productCost) !== 0;

  return {
    barcode,
    variantLabel: product.variantId ? 'Çoklu Varyant' : 'Tek Varyantlı Ürün',
    title: text(product.title),
    category: text(product.category),
    size: text(cost.size) || '—',
    productUrl: trendyolProductUrlFromProduct(product) || text(product.productUrl),
    imageUrl: product.imageUrl || '',
    productCost,
    costVatRate: cost.costVatRate ?? 20,
    desi: cost.desi ?? '',
    commissionRate: cost.commissionRate ?? product.commissionRate ?? '',
    brand: text(product.brand),
    modelCode: text(cost.modelCode) || text(product.productMainId) || text(product.sku) || '—',
    color: text(cost.color) || '—',
    stock: product.stock ?? '',
    returnRate: cost.returnRate ?? 0,
    returnRateLabel: cost.returnRateLabel || `Varsayılan: ${cost.returnRate ?? 0}`,
    deliveryType: text(cost.deliveryType) || 'Bugün Kargoda',
    extraExpense: cost.extraExpense ?? 0,
    salePrice: product.salePrice ?? '',
    status: text(product.status),
    hasCost
  };
}

export function buildProductCatalog(db, filters = {}, options = {}) {
  const costScope = normalizeCostScope(options.costScope);
  const costSource = costsForScope(db, costScope);
  const costByBarcode = new Map(
    costSource.map((item) => [String(item.barcode), item])
  );
  const rows = [];
  const seenBarcodes = new Set();

  for (const product of db.products || []) {
    const barcode = String(product.barcode || '');
    seenBarcodes.add(barcode);
    const cost = costByBarcode.get(barcode) || {};
    const row = mergeProductRow(product, cost);
    if (matchesProductFilter(row, filters)) {
      rows.push(row);
    }
  }

  for (const cost of costSource) {
    const barcode = String(cost.barcode || '');
    if (!barcode || seenBarcodes.has(barcode)) continue;
    const row = mergeProductRow({ barcode, title: cost.title || barcode }, cost);
    if (matchesProductFilter(row, filters)) {
      rows.push(row);
    }
  }

  rows.sort((a, b) => a.title.localeCompare(b.title, 'tr-TR'));
  return rows;
}

export function matchesProductFilter(row, filters) {
  const title = text(filters.title).toLocaleLowerCase('tr-TR');
  if (title && !row.title.toLocaleLowerCase('tr-TR').includes(title)) return false;

  const barcode = text(filters.barcode);
  if (barcode && !String(row.barcode).includes(barcode)) return false;

  const brand = text(filters.brand).toLocaleLowerCase('tr-TR');
  if (brand && !row.brand.toLocaleLowerCase('tr-TR').includes(brand)) return false;

  const modelCode = text(filters.modelCode).toLocaleLowerCase('tr-TR');
  if (modelCode && !String(row.modelCode).toLocaleLowerCase('tr-TR').includes(modelCode)) return false;

  const color = text(filters.color).toLocaleLowerCase('tr-TR');
  if (color && color !== '—' && !String(row.color).toLocaleLowerCase('tr-TR').includes(color)) return false;

  const size = text(filters.size).toLocaleLowerCase('tr-TR');
  if (size && size !== '—' && !String(row.size).toLocaleLowerCase('tr-TR').includes(size)) return false;

  const costVatRate = text(filters.costVatRate);
  if (costVatRate && String(row.costVatRate) !== costVatRate) return false;

  if (filters.emptyCostOnly && row.hasCost) return false;

  const stock = toNum(row.stock);
  const stockMin = toNum(filters.stockMin);
  const stockMax = toNum(filters.stockMax);
  if (stockMin !== null && (stock === null || stock < stockMin)) return false;
  if (stockMax !== null && (stock === null || stock > stockMax)) return false;

  const cost = toNum(row.productCost);
  const costMin = toNum(filters.costMin);
  const costMax = toNum(filters.costMax);
  if (costMin !== null && (cost === null || cost < costMin)) return false;
  if (costMax !== null && (cost === null || cost > costMax)) return false;

  const desi = toNum(row.desi);
  const desiMin = toNum(filters.desiMin);
  const desiMax = toNum(filters.desiMax);
  if (desiMin !== null && (desi === null || desi < desiMin)) return false;
  if (desiMax !== null && (desi === null || desi > desiMax)) return false;

  const returnRate = toNum(row.returnRate);
  const returnMin = toNum(filters.returnMin);
  const returnMax = toNum(filters.returnMax);
  if (returnMin !== null && (returnRate === null || returnRate < returnMin)) return false;
  if (returnMax !== null && (returnRate === null || returnRate > returnMax)) return false;

  return true;
}

export function parseProductFilters(searchParams) {
  return {
    title: searchParams.get('title') || '',
    barcode: searchParams.get('barcode') || '',
    costVatRate: searchParams.get('costVatRate') || '',
    brand: searchParams.get('brand') || '',
    modelCode: searchParams.get('modelCode') || '',
    color: searchParams.get('color') || '',
    size: searchParams.get('size') || '',
    stockMin: searchParams.get('stockMin') || '',
    stockMax: searchParams.get('stockMax') || '',
    emptyCostOnly: searchParams.get('emptyCostOnly') === '1',
    costMin: searchParams.get('costMin') || '',
    costMax: searchParams.get('costMax') || '',
    desiMin: searchParams.get('desiMin') || '',
    desiMax: searchParams.get('desiMax') || '',
    returnMin: searchParams.get('returnMin') || '',
    returnMax: searchParams.get('returnMax') || ''
  };
}

export const DEFAULT_LIST_PAGE_SIZE = 10;
export const MAX_LIST_PAGE_SIZE = 100;

export function parseListPagination(searchParams, options = {}) {
  const defaultLimit = options.defaultLimit ?? DEFAULT_LIST_PAGE_SIZE;
  const maxLimit = options.maxLimit ?? MAX_LIST_PAGE_SIZE;

  let page = Number.parseInt(String(searchParams.get?.('page') ?? searchParams.page ?? '1'), 10);
  if (!Number.isFinite(page) || page < 1) page = 1;

  const limitRaw = searchParams.get?.('limit') ?? searchParams.limit;
  if (limitRaw === null || limitRaw === undefined || limitRaw === '') {
    return { page, limit: defaultLimit, returnAll: false };
  }

  const limit = Number.parseInt(String(limitRaw), 10);
  if (!Number.isFinite(limit) || limit === 0) {
    return { page: 1, limit: 0, returnAll: true };
  }

  return {
    page,
    limit: Math.min(Math.max(limit, 1), maxLimit),
    returnAll: false
  };
}

export function paginateRows(rows, { page = 1, limit = DEFAULT_LIST_PAGE_SIZE, returnAll = false } = {}) {
  const total = rows.length;
  if (returnAll || !limit) {
    return { rows, total, page: 1, limit: total, totalPages: 1 };
  }

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const start = (safePage - 1) * limit;

  return {
    rows: rows.slice(start, start + limit),
    total,
    page: safePage,
    limit,
    totalPages
  };
}

export function filtersToQuery(filters) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (key === 'emptyCostOnly') {
      if (value) params.set(key, '1');
      continue;
    }
    if (value !== '' && value !== false && value !== null && value !== undefined) {
      params.set(key, String(value));
    }
  }
  return params.toString();
}

export function productRowToCsv(rows) {
  const headers = [
    'Barkod',
    'Ürün Adı',
    'Marka',
    'Kategori',
    'Maliyet (KDV Dahil)',
    'Maliyet KDV %',
    'Desi',
    'Model Kodu',
    'Renk',
    'Beden',
    'Stok',
    'İade Oranı',
    'Teslimat',
    'Ekstra Gider'
  ];
  const lines = [headers.join(';')];

  for (const row of rows) {
    lines.push([
      row.barcode,
      row.title,
      row.brand,
      row.category,
      row.productCost,
      row.costVatRate,
      row.desi,
      row.modelCode,
      row.color,
      row.size,
      row.stock,
      row.returnRate,
      row.deliveryType,
      row.extraExpense
    ].map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(';'));
  }

  return `\uFEFF${lines.join('\n')}`;
}
