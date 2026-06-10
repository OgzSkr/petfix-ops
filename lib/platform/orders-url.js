import { getChannel } from '../channels/registry.js';

/**
 * Kanal sipariş sayfasına derin link — ?order= ile detay modalı açılır.
 */
export function orderDetailPageUrl(channelId, orderNumber, options = {}) {
  const order = String(orderNumber || '').trim();
  if (!order) return '';

  const channel = getChannel(channelId);
  const base = channel?.ordersRoute || channel?.route || '/siparisler';
  const params = new URLSearchParams();
  params.set('order', order);

  const days = options.days;
  if (days != null && days !== '') {
    params.set('days', String(days));
  }

  if (options.profit) {
    params.set('profit', String(options.profit));
  }

  return `${base}?${params.toString()}`;
}
