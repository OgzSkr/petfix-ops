/**
 * HzlMrktOps — hızlı market operasyon hattı (Getir, YS, TGO/Uber, BenimPOS).
 * Trendyol Pazaryeri ve WooCommerce bu ürün hattının dışındadır.
 */

export const PRODUCT_LINE = Object.freeze({
  HZLMRKTOPS: 'hzlmrktops',
  MARKETPLACE: 'marketplace',
  ECOMMERCE: 'ecommerce'
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
export const ECOMMERCE_CHANNEL_IDS = Object.freeze(['woocommerce']);

export const HZLMRKTOPS_BASE = '/hzlmrktops';
export const HZLMRKTOPS_ORDERS = `${HZLMRKTOPS_BASE}/siparisler`;
export const HZLMRKTOPS_PRODUCTS = `${HZLMRKTOPS_BASE}/urunler`;

/** @deprecated use HZLMRKTOPS_* */
export const MARKETNEXT_BUYBOX_CHANNEL_IDS = HZLMRKTOPS_BUYBOX_CHANNEL_IDS;
/** @deprecated use HZLMRKTOPS_* */
export const MARKETNEXT_OPS_CHANNEL_IDS = HZLMRKTOPS_OPS_CHANNEL_IDS;
/** @deprecated use HZLMRKTOPS_BASE */
export const MARKETNEXT_BASE = HZLMRKTOPS_BASE;
/** @deprecated use HZLMRKTOPS_ORDERS */
export const MARKETNEXT_ORDERS = HZLMRKTOPS_ORDERS;
/** @deprecated use HZLMRKTOPS_PRODUCTS */
export const MARKETNEXT_PRODUCTS = HZLMRKTOPS_PRODUCTS;
/** @deprecated use HZLMRKTOPS_PRODUCTS */
export const MARKETNEXT_MATCHING = HZLMRKTOPS_PRODUCTS;
/** @deprecated workbench kaldırıldı — ürünler sayfasına yönlendirilir */
export const MARKETNEXT_INBOX = `${HZLMRKTOPS_PRODUCTS}`;

const hzlmrktopsBuyboxSet = new Set(HZLMRKTOPS_BUYBOX_CHANNEL_IDS);
const marketplaceSet = new Set(MARKETPLACE_CHANNEL_IDS);
const ecommerceSet = new Set(ECOMMERCE_CHANNEL_IDS);

export function isHzlmrktopsBuyboxChannel(channelId) {
  return hzlmrktopsBuyboxSet.has(String(channelId || '').trim());
}

/** @deprecated use isHzlmrktopsBuyboxChannel */
export const isHzlMrktOpsBuyboxChannel = isHzlmrktopsBuyboxChannel;
/** @deprecated use isHzlmrktopsBuyboxChannel */
export const isMarketNextBuyboxChannel = isHzlmrktopsBuyboxChannel;

export function isHzlmrktopsOpsChannel(channelId) {
  return HZLMRKTOPS_OPS_CHANNEL_IDS.includes(String(channelId || '').trim());
}

/** @deprecated use isHzlmrktopsOpsChannel */
export const isHzlMrktOpsOpsChannel = isHzlmrktopsOpsChannel;
/** @deprecated use isHzlmrktopsOpsChannel */
export const isMarketNextOpsChannel = isHzlmrktopsOpsChannel;

export function isMarketplaceChannel(channelId) {
  return marketplaceSet.has(String(channelId || '').trim());
}

export function isEcommerceChannel(channelId) {
  return ecommerceSet.has(String(channelId || '').trim());
}

export function isExcludedFromHzlmrktops(channelId) {
  const id = String(channelId || '').trim();
  return isMarketplaceChannel(id) || isEcommerceChannel(id);
}

/** @deprecated use isExcludedFromHzlmrktops */
export const isExcludedFromHzlMrktOps = isExcludedFromHzlmrktops;
/** @deprecated use isExcludedFromHzlmrktops */
export const isExcludedFromMarketNext = isExcludedFromHzlmrktops;

export function filterHzlmrktopsBuyboxChannels(channelIds = []) {
  return channelIds.filter((id) => isHzlmrktopsBuyboxChannel(id));
}

/** @deprecated use filterHzlmrktopsBuyboxChannels */
export const filterHzlMrktOpsBuyboxChannels = filterHzlmrktopsBuyboxChannels;
/** @deprecated use filterHzlmrktopsBuyboxChannels */
export const filterMarketNextBuyboxChannels = filterHzlmrktopsBuyboxChannels;
