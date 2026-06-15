import { ingestSnapshots } from '../snapshot-ingest.js';
import { findByBarcode } from '../utils.js';

function assignIfEmpty(target, key, value) {
  if (value === '' || value === null || value === undefined) return;
  if (target[key] === '' || target[key] === null || target[key] === undefined) {
    target[key] = value;
  }
}

function mergeProductRecord(existing, incoming) {
  for (const key of [
    'sku', 'title', 'brand', 'category', 'salePrice', 'listPrice', 'stock',
    'status', 'productUrl', 'contentId', 'productMainId', 'variantId', 'commissionRate'
  ]) {
    assignIfEmpty(existing, key, incoming[key]);
  }
  existing.updatedAt = incoming.updatedAt || new Date().toISOString();
}

function mergeCostRecord(existing, incoming) {
  for (const key of ['productCost', 'desi']) {
    const value = incoming[key];
    if (value !== '' && value !== null && value !== undefined) {
      existing[key] = value;
    }
  }
  for (const key of ['commissionRate', 'note', 'modelCode', 'color', 'size']) {
    assignIfEmpty(existing, key, incoming[key]);
  }
  existing.updatedAt = incoming.updatedAt || new Date().toISOString();
}

export function mergeProductImport(db, payload = {}) {
  const products = payload.products || [];
  const costs = payload.costs || [];
  const buyboxSnapshots = payload.buyboxSnapshots || [];

  db.products = db.products || [];
  db.costs = db.costs || [];

  let productsAdded = 0;
  let productsUpdated = 0;
  let costsAdded = 0;
  let costsUpdated = 0;

  for (const incoming of products) {
    const barcode = String(incoming.barcode || '').trim();
    if (!barcode) continue;

    const existing = findByBarcode(db.products, barcode);
    if (!existing) {
      db.products.push({ ...incoming, barcode });
      productsAdded += 1;
    } else {
      mergeProductRecord(existing, incoming);
      productsUpdated += 1;
    }
  }

  for (const incoming of costs) {
    const barcode = String(incoming.barcode || '').trim();
    if (!barcode) continue;

    const existing = findByBarcode(db.costs, barcode);
    if (!existing) {
      db.costs.push({
        barcode,
        productCost: incoming.productCost ?? '',
        desi: incoming.desi ?? '',
        commissionRate: incoming.commissionRate ?? '',
        note: incoming.note ?? '',
        costVatRate: 20,
        returnRate: 0,
        deliveryType: 'Bugün Kargoda',
        extraExpense: 0,
        updatedAt: incoming.updatedAt || new Date().toISOString()
      });
      costsAdded += 1;
    } else {
      mergeCostRecord(existing, incoming);
      costsUpdated += 1;
    }
  }

  let snapshotsImported = 0;
  if (buyboxSnapshots.length) {
    const result = ingestSnapshots(db, buyboxSnapshots, {
      updatedAt: new Date().toISOString()
    });
    snapshotsImported = result.imported;
  }

  db.meta = db.meta || {};
  db.meta.updatedAt = new Date().toISOString();

  return {
    productsAdded,
    productsUpdated,
    costsAdded,
    costsUpdated,
    snapshotsImported,
    totalProducts: db.products.length,
    totalCosts: db.costs.length
  };
}
