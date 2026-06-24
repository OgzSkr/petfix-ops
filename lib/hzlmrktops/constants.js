/**
 * HzlMrktOps — hızlı market operasyon hattı (Getir, YS, TGO/Uber, BenimPOS).
 * Trendyol Pazaryeri bu ürün hattının dışındadır.
 */

export const PRODUCT_LINE = Object.freeze({
  HZLMRKTOPS: 'hzlmrktops',
  MARKETPLACE: 'marketplace'
});

/** Buybox/registry kanal kimlikleri — eşleştirme ve sipariş kârlılığı */
export const HZLMRKTOPS_BUYBOX_CHANNEL_IDS = Object.freeze([
  'uber-eats',
  'yemeksepeti',
  'getir'
]);

/** Ops Hub kanal kimlikleri (Postgres sipariş ingest) */
export const HZLMRKTOPS_OPS_CHANNEL_IDS = Object.freeze([
  'trendyol_go',
  'yemeksepeti',
  'getir'
]);

export const MARKETPLACE_CHANNEL_IDS = Object.freeze(['trendyol-marketplace']);

export const HZLMRKTOPS_BASE = '/hzlmrktops';
export const HZLMRKTOPS_ORDERS = `${HZLMRKTOPS_BASE}/siparisler`;
export const HZLMRKTOPS_PRODUCTS = `${HZLMRKTOPS_BASE}/urunler`;
export const HZLMRKTOPS_ORDER_PROFIT_REPORT = `${HZLMRKTOPS_BASE}/raporlar/siparis-karliligi`;

const hzlmrktopsBuyboxSet = new Set(HZLMRKTOPS_BUYBOX_CHANNEL_IDS);
const marketplaceSet = new Set(MARKETPLACE_CHANNEL_IDS);

export function isHzlmrktopsBuyboxChannel(channelId) {
  return hzlmrktopsBuyboxSet.has(String(channelId || '').trim());
}

export function isHzlmrktopsOpsChannel(channelId) {
  return HZLMRKTOPS_OPS_CHANNEL_IDS.includes(String(channelId || '').trim());
}

export function isMarketplaceChannel(channelId) {
  return marketplaceSet.has(String(channelId || '').trim());
}

export function isExcludedFromHzlmrktops(channelId) {
  return isMarketplaceChannel(String(channelId || '').trim());
}

export function filterHzlmrktopsBuyboxChannels(channelIds = []) {
  return channelIds.filter((id) => isHzlmrktopsBuyboxChannel(id));
}
