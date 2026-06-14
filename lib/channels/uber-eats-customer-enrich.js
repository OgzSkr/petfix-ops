import { fetchTgoGroceryPackages } from '../ops-hub/channels/tgo-grocery-fetch.js';
import { extractTgoCustomerFields } from './tgo-customer.js';

const TGO_CUSTOMER_STATUSES = ['Created', 'Picking', 'Invoiced', 'Shipped', 'Delivered'];

export async function fetchTgoPackagesByOrderNumber(cfg, options = {}) {
  const packages = await fetchTgoGroceryPackages(cfg, {
    pageSize: options.pageSize || 50,
    maxPages: options.maxPages || 20,
    packageStatus: options.packageStatus || TGO_CUSTOMER_STATUSES,
    storeId: options.storeId || cfg.storeId || undefined
  });

  const byOrderNumber = new Map();
  for (const pkg of packages) {
    const orderNumber = String(pkg.orderNumber || '').trim();
    if (!orderNumber) continue;
    if (!byOrderNumber.has(orderNumber)) {
      byOrderNumber.set(orderNumber, pkg);
    }
  }
  return byOrderNumber;
}

function mergeCustomerFields(target, source) {
  if (!source) return target;
  const merged = { ...target };
  for (const field of [
    'customerName',
    'customerPhone',
    'customerAddress',
    'customerIdentityNumber',
    'customerNote',
    'customerLocationMasked',
    'tgoPackageId',
    'shipmentPackageId',
    'deliveryMethod'
  ]) {
    if (source[field] != null && source[field] !== '') {
      merged[field] = source[field];
    }
  }
  if (!merged.deliveryMethod && source.deliveryModel === 'GO') {
    merged.deliveryMethod = 'Trendyol Kuryesi';
  }
  return merged;
}

/**
 * Settlement tabanlı Uber siparişlerine Trendyol Go paket API müşteri bilgisi ekler.
 */
export async function enrichUberPackagesWithTgoCustomers(cfg, packages, options = {}) {
  if (!Array.isArray(packages) || !packages.length || !cfg?.supplierId) {
    return packages;
  }

  let byOrderNumber;
  try {
    byOrderNumber = await fetchTgoPackagesByOrderNumber(cfg, options);
  } catch {
    return packages;
  }

  if (!byOrderNumber.size) return packages;

  const cityIds = new Set();
  for (const pkg of byOrderNumber.values()) {
    const cityId = Number(pkg.shipmentAddress?.cityId || pkg.invoiceAddress?.cityId || 0);
    if (cityId > 0) cityIds.add(cityId);
  }

  for (const orderPackage of packages) {
    const orderNumber = String(orderPackage.orderNumber || '').trim();
    const tgoPackage = byOrderNumber.get(orderNumber);
    if (!tgoPackage) continue;

    const customerFields = await extractTgoCustomerFields(tgoPackage, cfg);
    Object.assign(orderPackage, mergeCustomerFields(orderPackage, {
      ...customerFields,
      shipmentPackageId: orderPackage.shipmentPackageId || tgoPackage.id,
      deliveryMethod: orderPackage.deliveryMethod || (tgoPackage.deliveryModel === 'GO' ? 'Trendyol Kuryesi' : null)
    }));
  }

  return packages;
}
