/** Ops iç durum sırası — poll ile geriye düşmeyi engellemek için. */
const OPS_STATUS_PRIORITY = Object.freeze({
  completed: 100,
  cancelled: 90,
  failed: 85,
  dispatched: 60,
  ready: 55,
  picked: 50,
  picking: 25,
  received: 20
});

const TGO_CHANNEL_STATUS_PRIORITY = Object.freeze({
  delivered: 100,
  cancelled: 90,
  returned: 90,
  undelivered: 85,
  shipped: 60,
  picked: 55,
  invoiced: 50,
  picking: 25,
  created: 20
});

const GETIR_CHANNEL_STATUS_PRIORITY = Object.freeze({
  900: 100,
  1500: 100,
  1600: 90,
  800: 60,
  700: 55,
  600: 50,
  550: 45,
  500: 40,
  400: 20
});

export function opsOrderStatusPriority(status) {
  const key = String(status || '').trim().toLowerCase();
  return OPS_STATUS_PRIORITY[key] ?? 0;
}

export function tgoChannelStatusPriority(channelStatus) {
  const key = String(channelStatus || '').trim().toLowerCase();
  return TGO_CHANNEL_STATUS_PRIORITY[key] ?? 0;
}

export function getirChannelStatusPriority(channelStatus) {
  const key = String(channelStatus ?? '').trim();
  const numeric = Number(key);
  if (Number.isFinite(numeric) && GETIR_CHANNEL_STATUS_PRIORITY[numeric] != null) {
    return GETIR_CHANNEL_STATUS_PRIORITY[numeric];
  }
  return 0;
}

/** Poll/webhook güncellemesinde mevcut durumu koru — yalnızca ileri geçiş. */
export function mergeOpsOrderStatus(existingStatus, incomingStatus) {
  const existing = opsOrderStatusPriority(existingStatus);
  const incoming = opsOrderStatusPriority(incomingStatus);
  return incoming > existing ? incomingStatus : existingStatus;
}

export function mergeTgoChannelStatus(existingStatus, incomingStatus) {
  const existing = tgoChannelStatusPriority(existingStatus);
  const incoming = tgoChannelStatusPriority(incomingStatus);
  return incoming > existing ? incomingStatus : existingStatus;
}

export function mergeGetirChannelStatus(existingStatus, incomingStatus) {
  const existing = getirChannelStatusPriority(existingStatus);
  const incoming = getirChannelStatusPriority(incomingStatus);
  return incoming > existing ? incomingStatus : existingStatus;
}

/** Toplama bitmiş sipariş poll ile tekrar picking'e düşmesin. */
export function floorOpsStatusAfterPickingComplete(existingStatus, pickingCompletedAt) {
  if (!pickingCompletedAt) return existingStatus;
  const floor = opsOrderStatusPriority('picked');
  if (opsOrderStatusPriority(existingStatus) >= floor) return existingStatus;
  return 'picked';
}
