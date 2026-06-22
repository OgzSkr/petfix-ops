/**
 * Kanal yetenek matrisi — tek doğruluk kaynağı.
 *
 * Her kanal için standart entegrasyon yetenekleri tek yerde tanımlanır. Panel kontrol
 * ekranı, health çıktısı ve worker'lar bu matristen türetilir. Desteklenmeyen yetenekler
 * açıkça `false` ile işaretlenir (boşluklar gizlenmez).
 *
 * Değerler:
 *  - false           → desteklenmiyor
 *  - 'adapter'       → ChannelAdapter.fetchOrders gibi adapter metodu
 *  - 'poll'          → Ops Hub poll/sync hattı
 *  - 'webhook'       → Ops Hub webhook servisi
 *  - 'poll+webhook'  → hem poll hem webhook (adapter.fetchOrders bilinçli boş)
 *  - 'adapter+poll'  → adapter + Ops poll birleşimi
 *  - 'service'       → ops-hub/channels veya ingest servis modülü
 *  - 'api'           → kanal API çağrısı (lib/channels/*-api)
 */

export const CHANNEL_CAPABILITY_KEYS = [
  'fetchOrders',
  'syncProducts',
  'updateStock',
  'updatePrice',
  'updateOrderStatus',
  'handleWebhook'
];

export const CHANNEL_CAPABILITIES = {
  getir: {
    // adapter.fetchOrders bilinçli boş; sipariş akışı Ops poll + webhook üzerinden
    // mergeChannelOrderSources ile gelir (çift sayımı önlemek için).
    fetchOrders: 'poll+webhook',
    syncProducts: 'service',
    updateStock: 'service',
    updatePrice: 'api',
    updateOrderStatus: false,
    handleWebhook: 'service'
  },
  'uber-eats': {
    fetchOrders: 'adapter+poll',
    syncProducts: 'service',
    updateStock: 'service',
    updatePrice: false,
    updateOrderStatus: 'service',
    handleWebhook: false
  },
  yemeksepeti: {
    fetchOrders: 'adapter+poll',
    syncProducts: 'service',
    updateStock: 'service',
    updatePrice: false,
    updateOrderStatus: 'service',
    handleWebhook: 'service'
  }
};

export function getChannelCapabilities(channelId) {
  const caps = CHANNEL_CAPABILITIES[channelId];
  return caps ? { ...caps } : null;
}

export function channelSupports(channelId, capability) {
  const caps = CHANNEL_CAPABILITIES[channelId];
  return Boolean(caps && caps[capability]);
}

/** Desteklenmeyen (false) yeteneklerin listesi — panel/health boşluk göstergesi için. */
export function listChannelCapabilityGaps(channelId) {
  const caps = CHANNEL_CAPABILITIES[channelId];
  if (!caps) return [];
  return CHANNEL_CAPABILITY_KEYS.filter((key) => !caps[key]);
}
