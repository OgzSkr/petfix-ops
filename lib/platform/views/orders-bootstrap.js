import { getChannel, channelHasFeature } from '../../channels/registry.js';
import { orderDateTimezoneForChannel } from '../../order-profitability.js';
import { CHANNEL_SCOPE } from '../brand.js';

/**
 * Trendyol (/siparisler) ve kanal sipariş sayfaları (/uber-eats) için ortak bootstrap.
 */
export function buildOrdersPageBootstrap({ channelId, auth, productMatchingMode = 'legacy' }) {
  const channel = getChannel(channelId);
  if (!channel) {
    throw new Error(`Bilinmeyen kanal: ${channelId}`);
  }

  const isTrendyol = channel.scope === CHANNEL_SCOPE.FULL;

  return {
    authRequired: Boolean(auth.isEnabled()),
    channelId,
    channelLabel: channel.label,
    productMatchingMode,
    productsPath: isTrendyol ? '/marketplace/products' : '/hzlmrktops/urunler',
    matchingPath: '/hzlmrktops/urunler',
    orderDateTimezone: orderDateTimezoneForChannel(channelId),
    apiPath: isTrendyol ? '/api/orders' : `/api/channels/${channelId}/orders`,
    exportPath: isTrendyol ? '/api/orders/export' : `/api/channels/${channelId}/orders/export`,
    benimposSaleEnabled: channelHasFeature(channelId, 'benimpos-sale'),
    channelHealthEnabled: true
  };
}
