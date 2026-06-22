import {
  channelShortLabel as registryShortLabel,
  getChannel,
  listMatchingSalesChannels,
  listHzlMrktOpsMatchingSalesChannels
} from '../channels/registry.js';
export {
  MAPPING_STATUS,
  MATCH_METHOD,
  PRODUCT_MATCHING_MODES,
  CHANNEL_PRODUCT_REVIEW,
  CHANNEL_PRODUCT_REVIEW_LABELS
} from './mapping-types.js';

/** @readonly */
export const BENIMPOS_MASTER = {
  id: 'benimpos',
  label: 'BenimPOS',
  role: 'master',
  status: 'active'
};

/** Registry'den türetilir — tek kaynak lib/channels/registry.js */
let matchingChannelsCache = null;
let matchingChannelsCacheScope = null;

export function getMatchingChannelsList(options = {}) {
  const scope = options.scope || 'hzlmrktops';
  const salesChannels = scope === 'all'
    ? listMatchingSalesChannels()
    : listHzlMrktOpsMatchingSalesChannels();

  if (!matchingChannelsCache || matchingChannelsCacheScope !== scope) {
    matchingChannelsCache = [
      BENIMPOS_MASTER,
      ...salesChannels.map((channel) => ({
        id: channel.id,
        label: channel.label,
        role: 'sales',
        status: channel.status,
        route: channel.ordersRoute || channel.route
      }))
    ];
    matchingChannelsCacheScope = scope;
  }
  return matchingChannelsCache;
}

/** @deprecated getMatchingChannelsList() kullanın */
export const MATCHING_CHANNELS = [];

/** @readonly @deprecated registry.channelShortLabel kullanın */
let channelShortLabelsCache = null;

function getChannelShortLabels() {
  if (!channelShortLabelsCache) {
    channelShortLabelsCache = Object.fromEntries(
      listMatchingSalesChannels().map((channel) => [channel.id, channel.shortLabel])
    );
  }
  return channelShortLabelsCache;
}

export const CHANNEL_SHORT_LABELS = new Proxy({}, {
  get(_target, prop) {
    if (prop === Symbol.toStringTag) return 'Object';
    return getChannelShortLabels()[prop];
  },
  ownKeys() {
    return Reflect.ownKeys(getChannelShortLabels());
  },
  getOwnPropertyDescriptor(_target, prop) {
    const value = getChannelShortLabels()[prop];
    if (value === undefined) return undefined;
    return { configurable: true, enumerable: true, value };
  }
});

export function listSalesMatchingChannels(options = {}) {
  return getMatchingChannelsList(options).filter((channel) => channel.role === 'sales');
}

export function listHzlMrktOpsSalesMatchingChannels() {
  return listSalesMatchingChannels({ scope: 'hzlmrktops' });
}

export function getSalesMatchingChannel(channelId) {
  return listSalesMatchingChannels().find((channel) => channel.id === channelId) || null;
}

export function channelShortLabel(channelId) {
  return registryShortLabel(channelId);
}

export function masterProductIdForBarcode(barcode) {
  const code = String(barcode || '').trim();
  return code ? `mp-${code}` : '';
}

export function channelProductIdFor(channelId, channelProductKey) {
  return `cp-${channelId}-${String(channelProductKey || '').trim()}`;
}

export function isActiveSalesChannel(channelId) {
  const channel = getChannel(channelId);
  return Boolean(channel && channel.matchingRole === 'sales' && channel.status === 'active');
}
