import { HZLMRKTOPS_PRODUCTS } from '../hzlmrktops/constants.js';

const PRODUCTS_PATH = HZLMRKTOPS_PRODUCTS;

export function buildProductPoolUrl(_channelId = 'uber-eats', options = {}) {
  const params = new URLSearchParams();
  const query = String(options.q || options.barcode || '').trim();
  if (query) params.set('q', query);
  const qs = params.toString();
  return qs ? `${PRODUCTS_PATH}?${qs}` : PRODUCTS_PATH;
}

export function productPoolUrlForMappingStatus(_channelId, channelBarcode) {
  return buildProductPoolUrl('', { barcode: channelBarcode });
}
