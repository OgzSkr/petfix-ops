import { fetchTgoJson } from '../../channels/tgo-market-api.js';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGES = 40;

export async function fetchTgoGroceryPackages(cfg, options = {}) {
  const supplierId = String(cfg.supplierId || '').trim();
  if (!supplierId) {
    throw new Error('TGO supplierId eksik');
  }

  const pageSize = Number(options.pageSize || DEFAULT_PAGE_SIZE);
  const maxPages = Number(options.maxPages || MAX_PAGES);
  const statuses = normalizeStatusFilter(options.packageStatus || options.statuses);

  const packages = [];
  let page = 0;

  while (page < maxPages) {
    const query = new URLSearchParams({
      page: String(page),
      size: String(pageSize)
    });

    if (options.storeId) {
      query.set('storeId', String(options.storeId));
    }

    const data = await fetchTgoJson(
      cfg,
      `/integrator/order/grocery/suppliers/${encodeURIComponent(supplierId)}/packages?${query}`
    );

    const content = Array.isArray(data.content) ? data.content : [];
    const filtered = statuses.length
      ? content.filter((pkg) => statuses.includes(String(pkg.packageStatus || '')))
      : content;

    packages.push(...filtered);
    page += 1;

    if (!content.length) {
      break;
    }
    if (data.totalPages != null && page >= Number(data.totalPages)) {
      break;
    }
    if (options.limit && packages.length >= options.limit) {
      break;
    }
  }

  if (options.limit) {
    return packages.slice(0, options.limit);
  }

  return packages;
}

function normalizeStatusFilter(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function probeTgoGroceryPackages(cfg) {
  try {
    const data = await fetchTgoJson(
      cfg,
      `/integrator/order/grocery/suppliers/${encodeURIComponent(cfg.supplierId)}/packages?page=0&size=1`
    );
    const total = Number(data.totalElements) || 0;
    const sample = data.content?.[0] || null;
    return {
      ok: true,
      source: 'tgoapis-grocery-packages',
      totalElements: total,
      storeId: sample?.storeId ?? null,
      message: `Grocery packages OK · ${total} kayıt`
    };
  } catch (error) {
    return {
      ok: false,
      source: 'tgoapis-grocery-packages',
      totalElements: 0,
      storeId: null,
      message: error.message
    };
  }
}
