import { getMatchingChannelsList } from './constants.js';

export function createEmptyProductMatching() {
  return {
    channels: getMatchingChannelsList().map((c) => ({ ...c })),
    masterProducts: [],
    channelProducts: [],
    mappings: [],
    conflicts: [],
    mappingLogs: [],
    orderMappingLogs: [],
    meta: {
      masterSyncedAt: null,
      masterProductCount: 0,
      channelIngest: {}
    }
  };
}

export function ensureProductMatching(db) {
  if (!db.productMatching || typeof db.productMatching !== 'object') {
    db.productMatching = createEmptyProductMatching();
    return db.productMatching;
  }

  const pm = db.productMatching;
  pm.channels = getMatchingChannelsList().map((registryChannel) => {
    const existing = Array.isArray(pm.channels)
      ? pm.channels.find((channel) => channel.id === registryChannel.id)
      : null;
    return existing ? { ...existing, ...registryChannel } : { ...registryChannel };
  });
  pm.masterProducts = Array.isArray(pm.masterProducts) ? pm.masterProducts : [];
  pm.channelProducts = Array.isArray(pm.channelProducts) ? pm.channelProducts : [];
  pm.mappings = Array.isArray(pm.mappings) ? pm.mappings : [];
  pm.conflicts = Array.isArray(pm.conflicts) ? pm.conflicts : [];
  pm.mappingLogs = Array.isArray(pm.mappingLogs) ? pm.mappingLogs : [];
  pm.orderMappingLogs = Array.isArray(pm.orderMappingLogs) ? pm.orderMappingLogs : [];
  pm.meta = pm.meta && typeof pm.meta === 'object' ? pm.meta : {};
  pm.meta.channelIngest = pm.meta.channelIngest && typeof pm.meta.channelIngest === 'object'
    ? pm.meta.channelIngest
    : {};

  return pm;
}
