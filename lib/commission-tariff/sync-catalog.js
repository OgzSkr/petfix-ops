import { findByBarcode } from '../utils.js';

function enrichProduct(product, item) {
  if (!product.title && item.title) product.title = item.title;
  if (!product.brand && item.brand) product.brand = item.brand;
  if (!product.category && item.category) product.category = item.category;
  if ((product.stock === '' || product.stock === undefined || product.stock === null) && item.stock !== '') {
    product.stock = item.stock;
  }
  product.updatedAt = new Date().toISOString();
}

function enrichCost(cost, item) {
  if (!cost.commissionRate && item.currentCommission !== '') cost.commissionRate = item.currentCommission;
  if (!cost.modelCode && item.modelCode) cost.modelCode = item.modelCode;
  if (!cost.size && item.size) cost.size = item.size;
  cost.updatedAt = new Date().toISOString();
}

export function syncTariffToCatalog(db, items = []) {
  db.products = db.products || [];
  db.costs = db.costs || [];

  let productsAdded = 0;
  let costsAdded = 0;
  let productsUpdated = 0;
  let costsUpdated = 0;

  for (const item of items) {
    const barcode = String(item.barcode || '').trim();
    if (!barcode) continue;

    let product = findByBarcode(db.products, barcode);
    if (!product) {
      db.products.push({
        barcode,
        title: item.title || '',
        brand: item.brand || '',
        category: item.category || '',
        stock: item.stock ?? '',
        status: 'active',
        updatedAt: new Date().toISOString()
      });
      productsAdded += 1;
    } else {
      const before = JSON.stringify(product);
      enrichProduct(product, item);
      if (JSON.stringify(product) !== before) productsUpdated += 1;
    }

    let cost = findByBarcode(db.costs, barcode);
    if (!cost) {
      db.costs.push({
        barcode,
        productCost: '',
        desi: '',
        commissionRate: item.currentCommission ?? '',
        modelCode: item.modelCode || '',
        size: item.size || '',
        costVatRate: 20,
        returnRate: 0,
        deliveryType: 'Bugün Kargoda',
        extraExpense: 0,
        updatedAt: new Date().toISOString()
      });
      costsAdded += 1;
    } else {
      const before = JSON.stringify(cost);
      enrichCost(cost, item);
      if (JSON.stringify(cost) !== before) costsUpdated += 1;
    }
  }

  return { productsAdded, costsAdded, productsUpdated, costsUpdated };
}

export function preserveTariffSelections(nextByBarcode, previousByBarcode = {}) {
  for (const [barcode, item] of Object.entries(nextByBarcode)) {
    const previous = previousByBarcode[barcode];
    if (!previous?.selectedTier) continue;

    item.selectedTier = previous.selectedTier;
    item.selectedPrice = previous.selectedPrice ?? '';
    item.selectedApplyUntilEnd = previous.selectedApplyUntilEnd ?? false;
    item.selectionProfit = previous.selectionProfit ?? '';
    item.selectionProfitRate = previous.selectionProfitRate ?? '';
  }
}
