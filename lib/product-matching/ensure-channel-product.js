import { channelProductIdFor } from './constants.js';
import { normalizeBarcode } from './normalize.js';
import { getProductMatching } from './store.js';
import { isPlaceholderChannelName } from './channel-ingest/uber-eats.js';
import {
  resolveOrderLineLookupKeys,
  resolveOrderLineChannelProductId,
  slugChannelProductId
} from './sale-preview.js';

/**
 * Sipariş satırından kanal ürünü kaydı oluşturur veya günceller.
 * Eşleştirme onayı öncesinde kanal kataloğunda olmayan ürünler için kullanılır.
 */
export function ensureChannelProduct(db, {
  channelId,
  channelProductId,
  channelBarcode,
  channelName,
  source = 'order_line'
} = {}) {
  const pm = getProductMatching(db);
  const productId = String(channelProductId || channelBarcode || '').trim();
  if (!productId) {
    throw new Error('channelProductId zorunlu.');
  }

  const barcode = normalizeBarcode(channelBarcode || productId);
  const name = String(channelName || barcode || productId).trim() || barcode;
  const now = new Date().toISOString();

  let channelProduct = pm.channelProducts.find(
    (row) => row.channelId === channelId && row.channelProductId === productId
  );

  if (!channelProduct) {
    channelProduct = {
      id: channelProductIdFor(channelId, productId),
      channelId,
      channelProductId: productId,
      channelBarcode: barcode,
      channelName: name,
      ingestSource: source,
      ingestedAt: now,
      orderLineCount: 1
    };
    pm.channelProducts.push(channelProduct);
    return { channelProduct, created: true };
  }

  if (name && isPlaceholderChannelName(channelProduct.channelName)) {
    channelProduct.channelName = name;
  }
  if (!channelProduct.channelBarcode && barcode) {
    channelProduct.channelBarcode = barcode;
  }
  channelProduct.orderLineCount = Number(channelProduct.orderLineCount || 0) + 1;
  channelProduct.updatedAt = now;

  return { channelProduct, created: false };
}

/**
 * Sipariş satırlarından kanal kataloğunda olmayan ürünleri kuyruğa ekler.
 * Kanal eşleştirmeleri yalnızca channelProducts kayıtlarını listeler.
 */
export function syncChannelProductsFromOrderPackages(db, packages = [], channelId) {
  const id = String(channelId || '').trim();
  if (!id) return { created: 0 };

  const pm = getProductMatching(db);
  const existingKeys = new Set();
  for (const cp of pm.channelProducts) {
    if (cp.channelId !== id) continue;
    if (cp.channelProductId) existingKeys.add(String(cp.channelProductId).trim());
    if (cp.channelBarcode) existingKeys.add(String(cp.channelBarcode).trim());
    if (Array.isArray(cp.channelBarcodes)) {
      for (const code of cp.channelBarcodes) {
        const text = String(code || '').trim();
        if (text) existingKeys.add(text);
      }
    }
  }

  let created = 0;
  for (const orderPackage of packages) {
    for (const line of orderPackage.lines || []) {
      const keys = resolveOrderLineLookupKeys(line);
      if (keys.some((key) => existingKeys.has(key))) continue;

      const orderLineName = String(line.productName || line.name || line.title || '').trim();
      const channelProductId = resolveOrderLineChannelProductId(line)
        || slugChannelProductId(orderLineName)
        || String(line.barcode || '').trim();
      if (!channelProductId) continue;

      const { created: isNew } = ensureChannelProduct(db, {
        channelId: id,
        channelProductId,
        channelBarcode: String(line.barcode || '').trim(),
        channelName: orderLineName || channelProductId,
        source: 'order_line'
      });
      if (isNew) {
        created += 1;
        existingKeys.add(channelProductId);
        for (const key of keys) existingKeys.add(key);
      }
    }
  }

  return { created };
}
