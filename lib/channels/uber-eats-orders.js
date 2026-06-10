import {
  ORDER_PAGE_SIZE,
  resolveRealUtcOrderDateRange
} from '../order-profitability.js';

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
 * Önce Order Integration API denenir; Go Market hesaplarında sipariş yetkisi
 * olmayabilir — bu durumda finance/che settlements fallback devreye girer.
 */
export async function fetchUberEatsOrders(cfg, options = {}) {
  const supplierId = String(cfg.supplierId || '').trim();
  const authToken = String(cfg.authToken || '').trim();

  if (!supplierId || !authToken) {
    throw new Error('Uber Eats API bilgileri eksik. .env dosyasına UBER_EATS_* değerlerini ekleyin.');
  }

  const { startDate, endDate } = resolveRealUtcOrderDateRange(options);
  const headers = buildRequestHeaders(supplierId, authToken);

  try {
    return await fetchOrderPackages({
      supplierId,
      headers,
      startDate,
      endDate,
      environment: cfg.environment
    });
  } catch (error) {
    if (!error.orderAccessDenied) {
      throw error;
    }

    return fetchFinanceOrderPackages({
      supplierId,
      headers,
      startDate,
      endDate,
      environment: cfg.environment
    });
  }
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

    const response = await fetch(`${baseUrl}/${encodeURIComponent(supplierId)}/orders?${query}`, {
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

async function fetchFinanceOrderPackages({ supplierId, headers, startDate, endDate, environment }) {
  const chunks = chunkDateRange(startDate, endDate, FINANCE_MAX_RANGE_MS);
  const sales = [];
  const discounts = [];

  for (const chunk of chunks) {
    const [chunkSales, chunkDiscounts] = await Promise.all([
      fetchFinanceSettlements({ baseUrl: apiBaseUrl(environment, 'finance/che/sellers'), supplierId, headers, startDate: chunk.startDate, endDate: chunk.endDate, transactionType: 'Sale' }),
      fetchFinanceSettlements({ baseUrl: apiBaseUrl(environment, 'finance/che/sellers'), supplierId, headers, startDate: chunk.startDate, endDate: chunk.endDate, transactionType: 'Discount' })
    ]);
    sales.push(...chunkSales);
    discounts.push(...chunkDiscounts);
  }

  return settlementsToOrderPackages(sales, discounts);
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

async function fetchFinanceSettlements({ baseUrl, supplierId, headers, startDate, endDate, transactionType }) {
  const settlements = [];
  let page = 0;

  while (true) {
    const query = new URLSearchParams({
      supplierId,
      startDate: String(startDate),
      endDate: String(endDate),
      transactionType,
      page: String(page),
      size: String(FINANCE_PAGE_SIZE)
    });

    const response = await fetch(`${baseUrl}/${encodeURIComponent(supplierId)}/settlements?${query}`, {
      headers
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Uber Eats cari ekstre hatası (${transactionType}): HTTP ${response.status} - ${text.slice(0, 300)}`);
    }

    const data = text ? JSON.parse(text) : {};
    const content = data.content || [];
    settlements.push(...content);
    page += 1;

    if (!content.length || (data.totalPages && page >= Number(data.totalPages))) {
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
    const current = index.get(key) || { debt: 0, commissionAmount: 0, lineCount: 0 };
    current.debt += Number(row.debt) || 0;
    current.commissionAmount += Number(row.commissionAmount) || 0;
    current.lineCount += 1;
    index.set(key, current);
  }

  return index;
}

function perLineDiscountShare(discount) {
  if (!discount?.lineCount) {
    return { debt: 0, commissionAmount: 0 };
  }

  return {
    debt: (Number(discount.debt) || 0) / discount.lineCount,
    commissionAmount: (Number(discount.commissionAmount) || 0) / discount.lineCount
  };
}

function settlementsToOrderPackages(sales, discounts = []) {
  const discountByLine = buildDiscountIndex(discounts);
  const byOrder = new Map();

  for (const row of sales) {
    const orderNumber = String(row.orderNumber || '').trim();
    if (!orderNumber) continue;

    const barcode = String(row.barcode || '').trim();
    const discount = discountByLine.get(settlementLineKey(orderNumber, barcode)) || {
      debt: 0,
      commissionAmount: 0,
      lineCount: 0
    };
    const perLineDiscount = perLineDiscountShare(discount);
    const grossCredit = Number(row.credit) || 0;
    const lineSellerDiscount = perLineDiscount.debt;
    const netSales = Math.max(0, grossCredit - lineSellerDiscount);
    const commissionAmount = (Number(row.commissionAmount) || 0) + perLineDiscount.commissionAmount;

    if (!byOrder.has(orderNumber)) {
      byOrder.set(orderNumber, {
        orderNumber,
        orderDate: row.orderDate || row.transactionDate,
        status: 'Delivered',
        storeName: row.storeName || '',
        shipmentPackageId: row.shipmentPackageId || '',
        packageGrossAmount: 0,
        packageTotalDiscount: 0,
        lines: []
      });
    }

    const pkg = byOrder.get(orderNumber);
    pkg.packageGrossAmount += grossCredit;
    pkg.packageTotalDiscount += lineSellerDiscount;
    pkg.lines.push({
      barcode,
      quantity: 1,
      commission: Number(row.commissionRate) || 0,
      commissionAmount,
      lineGrossAmount: grossCredit || netSales,
      lineUnitPrice: grossCredit || netSales,
      lineSellerDiscount: lineSellerDiscount,
      productName: row.description || 'Satış'
    });
  }

  return [...byOrder.values()];
}

/** Test ve doğrulama için dışa aktarım. */
export { settlementsToOrderPackages, buildDiscountIndex, perLineDiscountShare };
