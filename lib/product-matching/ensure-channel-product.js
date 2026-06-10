import { channelProductIdFor } from './constants.js';
import { normalizeBarcode } from './normalize.js';
import { getProductMatching } from './store.js';
import { isPlaceholderChannelName } from './channel-ingest/uber-eats.js';

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
