/**
 * Ürün bazlı otomatik stok gönderimi — varsayılan dahil (true).
 * autoStockSync === false olan ürünler otomatik senkron dışında kalır.
 */
export function isMasterAutoStockEnabled(master) {
  return master?.autoStockSync !== false;
}

export function normalizeMasterAutoStockFlag(value) {
  return value !== false;
}
