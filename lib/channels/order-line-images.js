import {
  buildProductImageByBarcode,
  buildProductTitleByBarcode,
  buildChannelProductImageByBarcode,
  buildChannelProductTitleByBarcode,
  isGenericOrderLineProductName
} from '../order-profitability.js';

function isGenericLineProductName(name) {
  return isGenericOrderLineProductName(name);
}

function barcodeKeysForLine(line) {
  return [
    line.masterBarcode,
    line.costBarcode,
    line.saleBarcode,
    line.barcode
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

export function buildChannelBrandByBarcode(db, channelId = null) {
  const brands = {};
  const scopedChannelId = String(channelId || '').trim();
  for (const cp of db.productMatching?.channelProducts || []) {
    if (scopedChannelId && String(cp.channelId || '').trim() !== scopedChannelId) continue;
    const barcode = String(cp.channelBarcode || cp.channelProductId || '').trim();
    const brand = String(cp.uberBrand || cp.brandName || '').trim();
    if (barcode && brand) brands[barcode] = brand;
  }
  return brands;
}

/** Sipariş satırlarına görsel, marka ve kanal kaynaklı ürün adı ekler. */
export function enrichOrderRowsWithLineMeta(db, rows, indexes = null, channelId = null) {
  const scopedChannelId = String(channelId || indexes?.channelId || '').trim();
  const imageIndex = indexes?.images || (
    scopedChannelId
      ? buildChannelProductImageByBarcode(db, scopedChannelId)
      : buildProductImageByBarcode(db)
  );
  const brandIndex = indexes?.brands || buildChannelBrandByBarcode(db, scopedChannelId);
  const titleIndex = indexes?.titles || (
    scopedChannelId
      ? buildChannelProductTitleByBarcode(db, scopedChannelId)
      : buildProductTitleByBarcode(db)
  );
  if (!Array.isArray(rows)) return rows;

  for (const row of rows) {
    for (const line of row.lines || []) {
      if (!String(line.imageUrl || '').trim()) {
        for (const key of barcodeKeysForLine(line)) {
          const url = imageIndex[key];
          if (url) {
            line.imageUrl = url;
            break;
          }
        }
      }
      if (!String(line.brandName || '').trim()) {
        for (const key of barcodeKeysForLine(line)) {
          const brand = brandIndex[key];
          if (brand) {
            line.brandName = brand;
            break;
          }
        }
      }
      if (isGenericLineProductName(line.productName)) {
        for (const key of barcodeKeysForLine(line)) {
          const title = titleIndex[key];
          if (title) {
            line.productName = title;
            break;
          }
        }
      }
    }
  }
  return rows;
}

/** @deprecated use enrichOrderRowsWithLineMeta */
export function enrichOrderRowsWithImages(db, rows, imageIndex = null) {
  return enrichOrderRowsWithLineMeta(db, rows, imageIndex ? { images: imageIndex } : null);
}
