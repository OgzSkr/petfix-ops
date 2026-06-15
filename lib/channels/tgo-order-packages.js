import { fetchTgoGroceryPackages } from '../ops-hub/channels/tgo-grocery-fetch.js';
import { TGO_PACKAGE_FETCH_STATUSES } from './tgo-package-statuses.js';
import { resolveRealUtcOrderDateRange } from '../order-profitability.js';
import { ORDER_SOURCES } from '../production/constants.js';
import { consolidateOrderLines } from './consolidate-order-lines.js';
import { extractTgoCustomerFields } from './tgo-customer.js';

const TGO_FETCH_STATUSES = TGO_PACKAGE_FETCH_STATUSES;

const TGO_STATUS_TO_PROFIT = Object.freeze({
  Created: 'Yeni',
  Picking: 'Hazırlanıyor',
  Invoiced: 'Faturalandı',
  Shipped: 'Yolda',
  Delivered: 'Teslim edildi',
  Cancelled: 'İptal',
  UnDelivered: 'Teslim edilemedi',
  Returned: 'İade'
});

function sumTgoLineQuantity(line) {
  const items = Array.isArray(line?.items) ? line.items : [];
  const active = items.filter((item) => !item.isCancelled);
  if (active.length) return active.length;
  return Number(line?.quantity) || 1;
}

function mapTgoLineToProfitLine(line) {
  const barcode = String(line?.barcode || '').trim();
  const quantity = sumTgoLineQuantity(line);
  const gross = Number(line?.amount ?? line?.price) || 0;
  const unitPrice = quantity > 0 ? gross / quantity : gross;

  return {
    barcode,
    quantity,
    productName: String(
      line?.product?.productSaleName || line?.product?.name || line?.productName || ''
    ).trim() || barcode,
    lineUnitPrice: unitPrice,
    lineGrossAmount: gross,
    brandName: line?.product?.brandName || ''
  };
}

export function mapTgoPackageStatus(packageStatus) {
  return TGO_STATUS_TO_PROFIT[String(packageStatus || '').trim()] || String(packageStatus || '');
}

export async function tgoGroceryPackageToProfitPackage(pkg, cfg) {
  const lines = consolidateOrderLines((pkg.lines || []).map(mapTgoLineToProfitLine));
  const customerFields = await extractTgoCustomerFields(pkg, cfg);

  return {
    orderNumber: String(pkg.orderNumber || '').trim(),
    shipmentPackageId: String(pkg.id || '').trim(),
    orderDate: pkg.orderDate || pkg.lastModifiedDate,
    status: mapTgoPackageStatus(pkg.packageStatus),
    packageGrossAmount: Number(pkg.grossAmount) || 0,
    packageTotalDiscount: Number(pkg.totalDiscount) || 0,
    lines,
    deliveryMethod: pkg.deliveryModel === 'GO' ? 'Trendyol Kuryesi' : null,
    paymentMethod: 'Online',
    ingestSource: ORDER_SOURCES.PARTNER_API,
    tgoPackageStatus: pkg.packageStatus || null,
    ...customerFields
  };
}

export async function tgoGroceryPackagesToProfitPackages(packages, cfg) {
  const out = [];
  for (const pkg of packages || []) {
    if (!String(pkg.orderNumber || '').trim()) continue;
    out.push(await tgoGroceryPackageToProfitPackage(pkg, cfg));
  }
  return out;
}

/**
 * Trendyol Go grocery packages API — aktif + son dönem siparişleri.
 * Settlement API yalnızca teslim edilmiş siparişleri döndürür; aktif siparişler buradan gelir.
 */
export async function fetchTgoGroceryOrderPackages(cfg, options = {}) {
  if (!cfg?.supplierId) return [];

  const packages = await fetchTgoGroceryPackages(cfg, {
    pageSize: options.pageSize || 50,
    maxPages: options.maxPages || 20,
    packageStatus: options.packageStatus || TGO_FETCH_STATUSES,
    storeId: options.storeId || cfg.storeId || undefined
  });

  const { startDate, endDate } = resolveRealUtcOrderDateRange(options);
  const filtered = packages.filter((pkg) => {
    const ms = Number(pkg.orderDate || pkg.lastModifiedDate || 0);
    if (!ms) return true;
    if (startDate && ms < startDate) return false;
    if (endDate && ms > endDate) return false;
    return true;
  });

  return tgoGroceryPackagesToProfitPackages(filtered, cfg);
}
