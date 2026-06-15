/** Sipariş yaşam döngüsü — aktif vs tamamlanmış (terminal) ayrımı. */
export const TERMINAL_ORDER_STATUS_KEYS = Object.freeze([
  // Trendyol / TGO API
  'DELIVERED',
  'COMPLETED',
  'FINISHED',
  'CANCELLED',
  'CANCELED',
  'RETURNED',
  'UNDELIVERED',
  'FAILED',
  'PICKED_UP',
  // TGO profit pipeline (Türkçe etiketler)
  'TESLIM EDILDI',
  'TAMAMLANDI',
  'IPTAL',
  'TESLIM EDILEMEDI',
  'IADE',
  'BASARISIZ',
  // Ops hub normalize
  'FAILED'
]);

const TERMINAL_ORDER_STATUSES = new Set(TERMINAL_ORDER_STATUS_KEYS);

export function normalizeOrderStatusKey(status) {
  const turkishFold = {
    'ı': 'i',
    'İ': 'i',
    'ş': 's',
    'Ş': 's',
    'ğ': 'g',
    'Ğ': 'g',
    'ü': 'u',
    'Ü': 'u',
    'ö': 'o',
    'Ö': 'o',
    'ç': 'c',
    'Ç': 'c'
  };

  const folded = [...String(status || '').trim()].map((ch) => turkishFold[ch] ?? ch).join('');
  return folded.toUpperCase().replace(/\s+/g, ' ');
}

export function isTerminalOrderStatus(status) {
  const key = normalizeOrderStatusKey(status);
  return key ? TERMINAL_ORDER_STATUSES.has(key) : false;
}
