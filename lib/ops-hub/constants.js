export const OPS_CHANNELS = Object.freeze(['trendyol_go', 'yemeksepeti', 'getir']);

export const CHANNEL_INTEGRATION_MODES = Object.freeze(['direct', 'integrator']);

export const OPS_ORDER_STATUSES = Object.freeze([
  'received',
  'picking',
  'picked',
  'ready',
  'dispatched',
  'completed',
  'cancelled',
  'failed'
]);

export const OPS_LINE_MATCHING_STATUSES = Object.freeze([
  'unmapped',
  'matched',
  'blocked',
  'legacy'
]);

export const OUTBOX_STATUSES = Object.freeze(['pending', 'processing', 'done', 'failed']);

export const OUTBOX_MESSAGE_TYPES = Object.freeze([
  'channel_status',
  'benimpos_sale',
  'benimpos_cancel',
  'stock_push'
]);

export const DELIVERY_MODES = Object.freeze([
  'platform_courier',
  'own_courier',
  'pickup',
  'unknown'
]);

export const OPS_FEATURE_FLAGS = Object.freeze([
  'FF_CHANNEL_STATUS_WRITE',
  'FF_BENIMPOS_SALE_WRITE',
  'FF_STOCK_PUSH',
  'FF_STAFF_AUTH'
]);

export function isOpsChannel(value) {
  return OPS_CHANNELS.includes(String(value || '').trim());
}

export function isOpsOrderStatus(value) {
  return OPS_ORDER_STATUSES.includes(String(value || '').trim());
}
