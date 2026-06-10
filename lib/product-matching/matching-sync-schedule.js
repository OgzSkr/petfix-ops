import { envValue } from '../env.js';

export const DEFAULT_MATCHING_SYNC_CHANNELS = [
  'uber-eats',
  'trendyol-marketplace',
  'woocommerce',
  'yemeksepeti'
];

/** Zamanlanmış sync'te YS katalog tam çekim saatler sürer — sayfa limiti ile parça parça ilerler. */
export const YEMEKSEPETI_SCHEDULED_CATALOG_MAX_PAGES = 120;

const ALLOWED_SYNC_CHANNELS = new Set(DEFAULT_MATCHING_SYNC_CHANNELS);

export function defaultMatchingSyncSettings() {
  return {
    enabled: false,
    intervalMinutes: 1440,
    channels: [...DEFAULT_MATCHING_SYNC_CHANNELS],
    uberIncludeOrders: false,
    lastRunAt: null,
    lastRunOk: null,
    lastRunSummary: null,
    lastError: null
  };
}

export function normalizeMatchingSyncSettings(input = {}, platformEnv = {}) {
  const base = defaultMatchingSyncSettings();
  const envEnabled = String(
    envValue(process.env, platformEnv, 'MATCHING_SYNC_ENABLED', 'false')
  ).toLowerCase();
  const envInterval = Number(envValue(process.env, platformEnv, 'MATCHING_SYNC_INTERVAL_MINUTES', '1440'));

  let channels = Array.isArray(input.channels) && input.channels.length
    ? input.channels.map((id) => String(id).trim()).filter(Boolean)
    : base.channels;

  channels = channels.filter((channelId) => ALLOWED_SYNC_CHANNELS.has(channelId));

  if (!channels.length) {
    channels = [...DEFAULT_MATCHING_SYNC_CHANNELS];
  }

  const enabled = input.enabled != null
    ? Boolean(input.enabled)
    : (envEnabled === 'true' || envEnabled === '1');

  return {
    enabled,
    intervalMinutes: Math.min(
      Math.max(Number(input.intervalMinutes ?? envInterval) || base.intervalMinutes, 30),
      10080
    ),
    channels,
    uberIncludeOrders: Boolean(input.uberIncludeOrders),
    lastRunAt: input.lastRunAt || null,
    lastRunOk: input.lastRunOk ?? null,
    lastRunSummary: input.lastRunSummary || null,
    lastError: input.lastError || null
  };
}

export function ensureMatchingSyncState(db, platformEnv = {}) {
  if (!db.matchingSyncSchedule || typeof db.matchingSyncSchedule !== 'object') {
    db.matchingSyncSchedule = normalizeMatchingSyncSettings({}, platformEnv);
  } else {
    db.matchingSyncSchedule = normalizeMatchingSyncSettings(db.matchingSyncSchedule, platformEnv);
  }
  return db.matchingSyncSchedule;
}

export function catalogStepsForChannel(channelId, { uberIncludeOrders = false } = {}) {
  if (channelId === 'uber-eats') {
    return uberIncludeOrders
      ? ['master', 'catalog', 'orders', 'auto-match']
      : ['master', 'catalog', 'auto-match'];
  }
  return ['master', 'catalog', 'auto-match'];
}
