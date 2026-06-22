import {
  ORDER_PAGE_SIZE,
  resolveRealUtcOrderDateRange,
  isGenericOrderLineProductName,
  normalizeOrderTimestamp
} from '../order-profitability.js';
import { consolidateOrderLines } from './consolidate-order-lines.js';
import { fetchUberEatsCatalogProducts } from './uber-eats-catalog.js';
import { fetchWithTimeout } from '../http/fetch-timeout.js';
import { enrichUberPackagesWithTgoCustomers } from './uber-eats-customer-enrich.js';
import { fetchTgoGroceryOrderPackages } from './tgo-order-packages.js';
import { dedupeOrderPackages } from './dedupe-order-packages.js';
import {
  computeUberPortalFinancials,
  applyPortalFinancialsToPackage,
  applyPortalFinancialsToPackages
} from './uber-eats-portal-financials.js';

const FINANCE_PAGE_SIZE = 500;
const FINANCE_MAX_RANGE_MS = 14 * 24 * 60 * 60 * 1000;
const INTEGRATOR_NAME = 'SelfIntegration';

function buildRequestHeaders(supplierId, authToken) {
  return {
    Authorization: `Basic ${authToken}`,
    'User-Agent': `${supplierId} - ${INTEGRATOR_NAME}`,
    Accept: 'application/json'
  };
}

function apiBaseUrl(environment, resource) {
  const host = environment === 'STAGE'
    ? 'https://stageapigw.trendyol.com'
    : 'https://apigw.trendyol.com';
  return `${host}/integration/${resource}`;
}

function isOrderAccessDenied(status, body = '') {
  if (status === 401 || status === 403) return true;
  return /UnauthorizedAccessException|TrendyolAuthorizationException|ClientApiAuthenticationException/i.test(body);
}

/**
 * Uber Eats Trendyol Go — read-only sipariş paketi çekme.
 * TGO paket API ürün detayı verir; komisyon/provizyon cari ekstre (settlements) kaynağındadır.
 * Her iki kaynak birleştirilir — settlement yalnızca Order API reddedildiğinde değil, her zaman çekilir.
 */
export async function fetchUberEatsOrders(cfg, options = {}) {
  const supplierId = String(cfg.supplierId || '').trim();
  const authToken = String(cfg.authToken || '').trim();

  if (!supplierId || !authToken) {
    throw new Error('Uber Eats API bilgileri eksik. .env dosyasına UBER_EATS_* değerlerini ekleyin.');
  }

  const { startDate, endDate } = resolveRealUtcOrderDateRange(options);
  const headers = buildRequestHeaders(supplierId, authToken);
  const financeParams = {
    supplierId,
    headers,
    startDate,
    endDate,
    environment: cfg.environment,
    cfg
  };

  const [tgoPackages, settlementPackages, orderResult] = await Promise.all([
    fetchTgoGroceryOrderPackages(cfg, options).catch(() => []),
    fetchFinanceOrderPackages(financeParams).catch(() => []),
    fetchOrderPackages({
      supplierId,
      headers,
      startDate,
      endDate,
      environment: cfg.environment
    })
      .then((packages) => ({ ok: true, packages }))
      .catch((error) => ({ ok: false, error }))
  ]);

  if (!orderResult.ok && !orderResult.error?.orderAccessDenied) {
    // Order API ağ/geçici hatası — TGO + settlement ile devam et.
  }

  const orderPackages = orderResult.ok ? orderResult.packages : [];
  return dedupeOrderPackages([...tgoPackages, ...orderPackages, ...settlementPackages]);
}

function resolveFinanceDateRange(options = {}) {
  const anchorMs = normalizeOrderTimestamp(options.orderDateMs || options.orderDate);
  if (anchorMs) {
    const padMs = 7 * 24 * 60 * 60 * 1000;
    return { startDate: anchorMs - padMs, endDate: anchorMs + padMs };
  }
  return resolveRealUtcOrderDateRange(options);
}

function orderPackageHasSettlementFinancials(orderPackage) {
  if (!orderPackage) return false;
  if (orderPackage.portalFinancials?.loaded) return true;
  if (Number(orderPackage.packagePortalCommissionAmount) > 0) return true;
  if (Number(orderPackage.packageCommissionAmount) > 0) return true;
  if (Number(orderPackage.packageSellerRevenue) > 0) return true;
  return (orderPackage.lines || []).some(
    (line) => Number(line.commissionAmount) > 0 || Number(line.sellerRevenue) > 0
  );
}
/**
 * BenimPOS ön izleme / tek sipariş — TGO detayı + cari ekstre finans birleştirmesi.
 */
export async function fetchUberEatsOrderPackageByNumber(cfg, orderNumber, options = {}) {
  const orderRef = String(orderNumber || '').trim();
  if (!orderRef) {
    throw new Error('orderNumber zorunlu.');
  }

  const supplierId = String(cfg.supplierId || '').trim();
  const authToken = String(cfg.authToken || '').trim();
  if (!supplierId || !authToken) {
    throw new Error('Uber Eats API bilgileri eksik. .env dosyasına UBER_EATS_* değerlerini ekleyin.');
  }

  const headers = buildRequestHeaders(supplierId, authToken);
  const tgoPackages = await fetchTgoGroceryOrderPackages(cfg, {
    ...options,
    maxPages: options.maxPages || 15
  }).catch(() => []);
  const tgoMatches = tgoPackages.filter((p) => String(p.orderNumber || '').trim() === orderRef);

  const financeBase = {
    supplierId,
    headers,
    environment: cfg.environment
  };

  const narrowRange = resolveFinanceDateRange({
    ...options,
    orderDateMs: options.orderDateMs || tgoMatches[0]?.orderDate || tgoMatches[0]?.orderDateMs
  });

  let settlementPackage = await fetchSettlementPackageForOrder({
    ...financeBase,
    ...narrowRange,
    orderNumber: orderRef
  }).catch(() => null);

  if (!orderPackageHasSettlementFinancials(settlementPackage)) {
    const wideRange = resolveRealUtcOrderDateRange(options);
    settlementPackage = await fetchSettlementPackageForOrder({
      ...financeBase,
      ...wideRange,
      orderNumber: orderRef
    }).catch(() => settlementPackage);
  }

  const settlementPackages = settlementPackage ? [settlementPackage] : [];
  let hit = dedupeOrderPackages([...tgoMatches, ...settlementPackages])
    .find((p) => settlementOrderRef(p.orderNumber) === orderRef);

  if (!hit && tgoMatches.length) {
    hit = tgoMatches[0];
  }

  if (!hit) {
    throw new Error(`Sipariş bulunamadı: ${orderRef} (son ${options.days || 14} gün)`);
  }

  return hit;
}

async function fetchOrderPackages({ supplierId, headers, startDate, endDate, environment }) {
  const baseUrl = apiBaseUrl(environment, 'order/sellers');
  const packages = [];
  let page = 0;

  while (true) {
    const query = new URLSearchParams({
      supplierId,
      startDate: String(startDate),
      endDate: String(endDate),
      page: String(page),
      size: String(ORDER_PAGE_SIZE),
      orderByField: 'PackageLastModifiedDate',
      orderByDirection: 'DESC'
    });

    const response = await fetchWithTimeout(`${baseUrl}/${encodeURIComponent(supplierId)}/orders?${query}`, {
      headers
    });

    const text = await response.text();
    if (!response.ok) {
      const error = new Error(`Uber Eats sipariş hatası: HTTP ${response.status} - ${text.slice(0, 300)}`);
      error.orderAccessDenied = isOrderAccessDenied(response.status, text);
      throw error;
    }

    const data = text ? JSON.parse(text) : {};
    const content = data.content || [];
    packages.push(...content);
    page += 1;

    if (!content.length || (data.totalPages && page >= Number(data.totalPages))) {
      break;
    }
  }

  return packages;
}

function settlementOrderRef(value) {
  return String(value ?? '').trim();
}

function settlementRowsForOrder(rows, orderNumber) {
  const wanted = settlementOrderRef(orderNumber);
  return (rows || []).filter((row) => settlementOrderRef(row.orderNumber) === wanted);
}

async function fetchFinanceSettlementPage({
  baseUrl,
  supplierId,
  headers,
  startDate,
  endDate,
  page,
  transactionType,
  transactionTypes
}) {
  const query = new URLSearchParams({
    supplierId,
    startDate: String(startDate),
    endDate: String(endDate),
    page: String(page),
    size: String(FINANCE_PAGE_SIZE)
  });
  if (transactionTypes) {
    query.set('transactionTypes', transactionTypes);
  } else {
    query.set('transactionType', transactionType);
  }

  const response = await fetchWithTimeout(`${baseUrl}/${encodeURIComponent(supplierId)}/settlements?${query}`, {
    headers
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Uber Eats cari ekstre hatası (${transactionTypes || transactionType}): HTTP ${response.status} - ${text.slice(0, 300)}`);
  }

  const data = text ? JSON.parse(text) : {};
  return data.content || [];
}

async function paginateSettlementRowsForOrder(params, orderNumber, maxPages = 50) {
  const orderRef = settlementOrderRef(orderNumber);
  const collected = [];
  let page = 0;
  let found = false;

  while (page < maxPages) {
    let content;
    try {
      content = await fetchFinanceSettlementPage({ ...params, page });
    } catch {
      break;
    }
    if (!content.length) break;

    const hits = settlementRowsForOrder(content, orderRef);
    if (hits.length) {
      collected.push(...hits);
      found = true;
    } else if (found) {
      break;
    }

    if (content.length < FINANCE_PAGE_SIZE) break;
    page += 1;
  }

  return collected;
}

function buildSettlementPackageForOrder({
  sales = [],
  discounts = [],
  returns = [],
  provisionNegative = [],
  provisionPositive = []
}, orderNumber) {
  const orderRef = settlementOrderRef(orderNumber);
  if (!orderRef || !sales.length) return null;

  const settlement = { sales, discounts, returns, provisionNegative, provisionPositive };
  const packages = settlementsToOrderPackages(sales, discounts);
  const pkg = packages.find((row) => settlementOrderRef(row.orderNumber) === orderRef) || null;
  if (!pkg) return null;

  const portalFinancials = computeUberPortalFinancials(settlement, orderRef);
  return applyPortalFinancialsToPackage(pkg, portalFinancials);
}

async function fetchSettlementRowsForOrder(base, orderNumber) {
  const [sales, discounts, returns, provisionNegative, provisionPositive] = await Promise.all([
    paginateSettlementRowsForOrder({ ...base, transactionType: 'Sale' }, orderNumber),
    paginateSettlementRowsForOrder({ ...base, transactionType: 'Discount' }, orderNumber),
    paginateSettlementRowsForOrder({ ...base, transactionType: 'Return' }, orderNumber),
    paginateSettlementRowsForOrder({ ...base, transactionType: 'ProvisionNegative' }, orderNumber),
    paginateSettlementRowsForOrder({ ...base, transactionType: 'ProvisionPositive' }, orderNumber)
  ]);

  return { sales, discounts, returns, provisionNegative, provisionPositive };
}

async function fetchSettlementPackageForOrder({ supplierId, headers, startDate, endDate, environment, orderNumber }) {
  const baseUrl = apiBaseUrl(environment, 'finance/che/sellers');
  const base = { baseUrl, supplierId, headers, startDate, endDate };
  const settlement = await fetchSettlementRowsForOrder(base, orderNumber);

  return buildSettlementPackageForOrder(settlement, orderNumber);
}

async function fetchFinanceOrderPackages({
  supplierId,
  headers,
  startDate,
  endDate,
  environment,
  cfg,
  lightweight = false,
  filterOrderNumber = null,
  maxSettlementPages = Infinity
}) {
  const chunks = chunkDateRange(startDate, endDate, FINANCE_MAX_RANGE_MS);
  const sales = [];
  const discounts = [];
  const returns = [];
  const provisionNegative = [];
  const provisionPositive = [];
  const settlementBase = {
    baseUrl: apiBaseUrl(environment, 'finance/che/sellers'),
    supplierId,
    headers,
    maxPages: maxSettlementPages
  };

  for (const chunk of chunks) {
    const chunkParams = {
      ...settlementBase,
      startDate: chunk.startDate,
      endDate: chunk.endDate
    };
    const [
      chunkSales,
      chunkDiscounts,
      chunkReturns,
      chunkProvisionNegative,
      chunkProvisionPositive
    ] = await Promise.all([
      fetchFinanceSettlementsSafe({ ...chunkParams, transactionType: 'Sale' }),
      fetchFinanceSettlementsSafe({ ...chunkParams, transactionType: 'Discount' }),
      fetchFinanceSettlementsSafe({ ...chunkParams, transactionType: 'Return' }),
      fetchFinanceSettlementsSafe({ ...chunkParams, transactionType: 'ProvisionNegative' }),
      fetchFinanceSettlementsSafe({ ...chunkParams, transactionType: 'ProvisionPositive' })
    ]);
    sales.push(...chunkSales);
    discounts.push(...chunkDiscounts);
    returns.push(...chunkReturns);
    provisionNegative.push(...chunkProvisionNegative);
    provisionPositive.push(...chunkProvisionPositive);
  }

  const settlement = { sales, discounts, returns, provisionNegative, provisionPositive };
  let packages = applyPortalFinancialsToPackages(
    settlementsToOrderPackages(sales, discounts),
    settlement
  );

  if (filterOrderNumber) {
    const wanted = String(filterOrderNumber).trim();
    packages = packages.filter((pkg) => String(pkg.orderNumber || '').trim() === wanted);
  }

  if (lightweight || !packages.length) {
    return packages;
  }

  const withCatalog = await enrichSettlementPackagesFromCatalog(cfg, packages);
  return enrichUberPackagesWithTgoCustomers(cfg, withCatalog, {
    pageSize: 50,
    maxPages: 20
  });
}

async function enrichSettlementPackagesFromCatalog(cfg, packages) {
  if (!Array.isArray(packages) || !packages.length) return packages;

  let catalogByBarcode;
  try {
    const { products } = await fetchUberEatsCatalogProducts(cfg, { listType: 'ALL_PRODUCT' });
    catalogByBarcode = new Map(
      (products || [])
        .map((row) => [String(row.barcode || '').trim(), row])
        .filter(([barcode]) => barcode)
    );
  } catch {
    return packages;
  }

  if (!catalogByBarcode.size) return packages;

  for (const pkg of packages) {
    for (const line of pkg.lines || []) {
      if (!isGenericOrderLineProductName(line.productName)) continue;
      const catalog = catalogByBarcode.get(String(line.barcode || '').trim());
      if (!catalog) continue;
      if (catalog.title) line.productName = catalog.title;
      if (catalog.brandName && !line.brandName) line.brandName = catalog.brandName;
      if (catalog.imageUrl && !line.imageUrl) line.imageUrl = catalog.imageUrl;
    }
  }

  return packages;
}

function chunkDateRange(startDate, endDate, maxRangeMs) {
  const chunks = [];
  let cursor = Number(startDate);
  const end = Number(endDate);
  while (cursor <= end) {
    const chunkEnd = Math.min(cursor + maxRangeMs - 1, end);
    chunks.push({ startDate: cursor, endDate: chunkEnd });
    cursor = chunkEnd + 1;
  }
  return chunks;
}

async function fetchFinanceSettlementsSafe(params) {
  try {
    return await fetchFinanceSettlements(params);
  } catch {
    return [];
  }
}

async function fetchFinanceSettlements({
  baseUrl,
  supplierId,
  headers,
  startDate,
  endDate,
  transactionType,
  transactionTypes,
  maxPages = Infinity
}) {
  const settlements = [];
  let page = 0;

  while (true) {
    const query = new URLSearchParams({
      supplierId,
      startDate: String(startDate),
      endDate: String(endDate),
      page: String(page),
      size: String(FINANCE_PAGE_SIZE)
    });
    if (transactionTypes) {
      query.set('transactionTypes', transactionTypes);
    } else {
      query.set('transactionType', transactionType);
    }

    const response = await fetchWithTimeout(`${baseUrl}/${encodeURIComponent(supplierId)}/settlements?${query}`, {
      headers
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Uber Eats cari ekstre hatası (${transactionTypes || transactionType}): HTTP ${response.status} - ${text.slice(0, 300)}`);
    }

    const data = text ? JSON.parse(text) : {};
    const content = data.content || [];
    settlements.push(...content);
    page += 1;

    if (!content.length || (data.totalPages && page >= Number(data.totalPages))) {
      break;
    }
    if (page >= maxPages) {
      break;
    }
  }

  return settlements;
}

function settlementLineKey(orderNumber, barcode) {
  return `${orderNumber}|${barcode}`;
}

function buildDiscountIndex(discounts) {
  const index = new Map();

  for (const row of discounts) {
    const orderNumber = String(row.orderNumber || '').trim();
    const barcode = String(row.barcode || '').trim();
    if (!orderNumber || !barcode) continue;

    const key = settlementLineKey(orderNumber, barcode);
    const current = index.get(key) || { debt: 0, commissionAmount: 0, sellerRevenue: 0, lineCount: 0 };
    current.debt += Number(row.debt) || 0;
    current.commissionAmount += Number(row.commissionAmount) || 0;
    current.sellerRevenue += Number(row.sellerRevenue) || 0;
    current.lineCount += 1;
    index.set(key, current);
  }

  return index;
}

function buildDiscountSellerRevenueByOrder(discounts) {
  const index = new Map();
  for (const row of discounts) {
    const orderNumber = String(row.orderNumber || '').trim();
    if (!orderNumber) continue;
    index.set(
      orderNumber,
      (index.get(orderNumber) || 0) + (Number(row.sellerRevenue) || 0)
    );
  }
  return index;
}

function perLineDiscountShare(discount) {
  if (!discount?.lineCount) {
    return { debt: 0, commissionAmount: 0, sellerRevenue: 0 };
  }

  return {
    debt: (Number(discount.debt) || 0) / discount.lineCount,
    commissionAmount: (Number(discount.commissionAmount) || 0) / discount.lineCount,
    sellerRevenue: (Number(discount.sellerRevenue) || 0) / discount.lineCount
  };
}

/**
 * ProvisionNegative (borç) satıcıdan düşer; ProvisionPositive (alacak) mahsup eder.
 */
function buildOrderProvisionIndex(provisionNegativeRows = [], provisionPositiveRows = []) {
  const index = new Map();

  for (const row of provisionNegativeRows) {
    const orderNumber = String(row.orderNumber || '').trim();
    if (!orderNumber) continue;
    index.set(orderNumber, (index.get(orderNumber) || 0) + (Number(row.debt) || 0));
  }

  for (const row of provisionPositiveRows) {
    const orderNumber = String(row.orderNumber || '').trim();
    if (!orderNumber) continue;
    index.set(orderNumber, (index.get(orderNumber) || 0) - (Number(row.credit) || 0));
  }

  return index;
}

function applyOrderProvisions(packages, provisionByOrder) {
  if (!provisionByOrder?.size) return packages;

  for (const pkg of packages) {
    const orderNumber = String(pkg.orderNumber || '').trim();
    const provisionNet = provisionByOrder.get(orderNumber);
    if (provisionNet == null || provisionNet === 0) continue;
    pkg.packageProvisionNet = Math.round(provisionNet * 100) / 100;
    pkg.packageProvisionAmount = Math.round(Math.abs(provisionNet) * 100) / 100;
  }

  return packages;
}

function settlementsToOrderPackages(sales, discounts = []) {
  const discountByLine = buildDiscountIndex(discounts);
  const discountSellerRevenueByOrder = buildDiscountSellerRevenueByOrder(discounts);
  const byOrder = new Map();

  for (const row of sales) {
    const orderNumber = String(row.orderNumber || '').trim();
    if (!orderNumber) continue;

    const barcode = String(row.barcode || '').trim();
    const discount = discountByLine.get(settlementLineKey(orderNumber, barcode)) || {
      debt: 0,
      commissionAmount: 0,
      sellerRevenue: 0,
      lineCount: 0
    };
    const perLineDiscount = perLineDiscountShare(discount);
    const grossCredit = Number(row.credit) || 0;
    const lineSellerDiscount = perLineDiscount.debt;
    const netSales = Math.max(0, grossCredit - lineSellerDiscount);
    const saleCommissionAmount = Number(row.commissionAmount) || 0;
    const discountCommissionAmount = perLineDiscount.commissionAmount;
    const portalCommissionAmount = Math.max(0, saleCommissionAmount - discountCommissionAmount);
    const commissionAmount = saleCommissionAmount + discountCommissionAmount;
    const sellerRevenue = Number(row.sellerRevenue) || 0;

    if (!byOrder.has(orderNumber)) {
      byOrder.set(orderNumber, {
        orderNumber,
        orderDate: row.orderDate || row.transactionDate,
        status: 'Delivered',
        storeName: row.storeName || '',
        shipmentPackageId: row.shipmentPackageId || '',
        packageGrossAmount: 0,
        packageTotalDiscount: 0,
        packageCommissionAmount: 0,
        packageSaleCommissionAmount: 0,
        packageDiscountCommissionAmount: 0,
        packagePortalCommissionAmount: 0,
        packageSellerRevenue: 0,
        packageDiscountSellerRevenue: 0,
        lines: []
      });
    }

    const pkg = byOrder.get(orderNumber);
    pkg.packageGrossAmount += grossCredit;
    pkg.packageTotalDiscount += lineSellerDiscount;
    pkg.packageCommissionAmount += commissionAmount;
    pkg.packageSaleCommissionAmount += saleCommissionAmount;
    pkg.packageDiscountCommissionAmount += discountCommissionAmount;
    pkg.packagePortalCommissionAmount += portalCommissionAmount;
    if (sellerRevenue > 0) {
      pkg.packageSellerRevenue += sellerRevenue;
    }
    pkg.lines.push({
      barcode,
      quantity: 1,
      commission: Number(row.commissionRate) || 0,
      saleCommissionAmount,
      discountCommissionAmount: discountCommissionAmount > 0 ? discountCommissionAmount : undefined,
      portalCommissionAmount: portalCommissionAmount > 0 ? portalCommissionAmount : undefined,
      commissionAmount,
      lineGrossAmount: grossCredit || netSales,
      lineUnitPrice: grossCredit || netSales,
      lineSellerDiscount: lineSellerDiscount,
      sellerRevenue: sellerRevenue > 0 ? sellerRevenue : undefined,
      productName: row.description || 'Satış'
    });
  }

  return [...byOrder.values()].map((pkg) => {
    const orderNumber = String(pkg.orderNumber || '').trim();
    const discountSellerRevenue = discountSellerRevenueByOrder.get(orderNumber) || 0;
    if (discountSellerRevenue > 0) {
      pkg.packageDiscountSellerRevenue = Math.round(discountSellerRevenue * 100) / 100;
    }
    return {
      ...pkg,
      packageCommissionAmount: Math.round((Number(pkg.packageCommissionAmount) || 0) * 100) / 100,
      packageSaleCommissionAmount: Math.round((Number(pkg.packageSaleCommissionAmount) || 0) * 100) / 100,
      packageDiscountCommissionAmount: Math.round((Number(pkg.packageDiscountCommissionAmount) || 0) * 100) / 100,
      packagePortalCommissionAmount: Math.round((Number(pkg.packagePortalCommissionAmount) || 0) * 100) / 100,
      packageSellerRevenue: Math.round((Number(pkg.packageSellerRevenue) || 0) * 100) / 100,
      lines: consolidateOrderLines(pkg.lines)
    };
  });
}

/** Test ve doğrulama için dışa aktarım. */
export {
  settlementsToOrderPackages,
  buildDiscountIndex,
  perLineDiscountShare,
  buildOrderProvisionIndex,
  applyOrderProvisions,
  resolveFinanceDateRange,
  orderPackageHasSettlementFinancials,
  buildSettlementPackageForOrder,
  settlementRowsForOrder
};
