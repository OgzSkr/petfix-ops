import { trimBuyboxSnapshots } from './snapshots.js';

export function snapshotKey(item) {
  return [
    item.barcode,
    item.buyboxPrice,
    item.buyboxOrder,
    item.secondBuyboxPrice,
    item.thirdBuyboxPrice,
    item.sellerId,
    item.sellerName,
    item.updatedAt
  ].join('|');
}

export function normalizeBuyboxSnapshot(item, updatedAt) {
  return {
    barcode: String(item.barcode || ''),
    buyboxOrder: item.buyboxOrder ?? '',
    buyboxPrice: item.buyboxPrice ?? '',
    secondBuyboxPrice: item.secondBuyboxPrice ?? '',
    thirdBuyboxPrice: item.thirdBuyboxPrice ?? '',
    hasMultipleSeller: item.hasMultipleSeller ?? '',
    sellerId: item.sellerId ?? item.merchantId ?? item.supplierId ?? '',
    sellerName: item.sellerName ?? item.merchantName ?? item.supplierName ?? item.seller ?? '',
    buyboxSource: item.source || item.buyboxSource || 'api',
    updatedAt
  };
}

export function ingestSnapshots(db, items, { updatedAt = new Date().toISOString(), trimLimit } = {}) {
  const existingKeys = new Set((db.buyboxSnapshots || []).map((item) => snapshotKey(item)));
  let imported = 0;

  for (const item of items || []) {
    const snapshot = normalizeBuyboxSnapshot(item, item.updatedAt || updatedAt);
    if (!snapshot.barcode) continue;

    const key = snapshotKey(snapshot);
    if (existingKeys.has(key)) continue;

    db.buyboxSnapshots.push(snapshot);
    existingKeys.add(key);
    imported += 1;
  }

  db.meta = db.meta || {};
  db.meta.updatedAt = new Date().toISOString();
  db.buyboxSnapshots = trimLimit
    ? trimBuyboxSnapshots(db.buyboxSnapshots, trimLimit)
    : trimBuyboxSnapshots(db.buyboxSnapshots);

  return {
    ok: true,
    imported,
    totalSnapshots: db.buyboxSnapshots.length
  };
}
