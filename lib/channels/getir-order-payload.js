/**
 * Getir poll/webhook sipariş gövdesinden kimlik ve kök nesne çıkarımı.
 * getir-api ve getir-normalize tarafından paylaşılır.
 */

export function resolveGetirExternalId(order) {
  // Getir webhook: orderID (Mongo). confirmationId (p599) yalnızca ekran kodu — external_id olmamalı.
  return String(
    order?.id ||
    order?._id ||
    order?.orderId ||
    order?.orderID ||
    order?.order_id ||
    order?.uuid ||
    order?.orderUuid ||
    ''
  ).trim();
}

/** Poll/webhook gövdesinden sipariş kökünü çıkar — Getir bazen `{ order }` veya `{ data: { order } }` döner. */
export function unwrapGetirOrderPayload(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return input;
  }
  if (input.order && typeof input.order === 'object' && !Array.isArray(input.order)) {
    return input.order;
  }
  const data = input.data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    if (data.order && typeof data.order === 'object') return data.order;
    if (resolveGetirExternalId(data)) return data;
  }
  return input;
}
