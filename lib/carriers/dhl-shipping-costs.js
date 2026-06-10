import { createDhlEcommerceClient, isDhlConfigured, readDhlConfig } from './dhl-ecommerce-client.js';

const DEFAULT_MAX_LOOKUPS = 30;
const CACHE_FRESH_MS = 24 * 60 * 60 * 1000;

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function roundMoney(value) {
  return Math.round(toNumber(value) * 100) / 100;
}

export function ensureDhlShippingCosts(db) {
  if (!db.dhlShippingCosts || typeof db.dhlShippingCosts !== 'object') {
    db.dhlShippingCosts = {
      byTracking: {},
      byOrderKey: {},
      lastSyncAt: null,
      lastSyncSummary: null
    };
  }
  if (!db.dhlShippingCosts.byTracking) db.dhlShippingCosts.byTracking = {};
  if (!db.dhlShippingCosts.byOrderKey) db.dhlShippingCosts.byOrderKey = {};
  return db.dhlShippingCosts;
}

export function trendyolOrderKey(orderPackage) {
  return `${orderPackage.orderNumber || ''}|${orderPackage.shipmentPackageId || orderPackage.id || ''}`;
}

export function extractTrendyolTrackingId(orderPackage) {
  return String(
    orderPackage.cargoTrackingNumber
    || orderPackage.cargoSenderNumber
    || orderPackage.shipmentNumber
    || ''
  ).trim();
}

function isFreshEntry(entry, now = Date.now()) {
  if (!entry?.syncedAt) return false;
  const syncedAt = Date.parse(entry.syncedAt);
  if (!Number.isFinite(syncedAt)) return false;
  if (entry.amount > 0 && entry.source === 'invoiced') return true;
  return now - syncedAt < CACHE_FRESH_MS;
}

function aggregateOrderEntry(store, orderKey) {
  const entries = Object.values(store.byTracking).filter((row) => row.orderKey === orderKey);
  let outbound = 0;
  let returnTotal = 0;

  for (const row of entries) {
    const amount = toNumber(row.amount);
    if (amount <= 0) continue;
    if (row.direction === 'return') {
      returnTotal += amount;
    } else {
      outbound += amount;
    }
  }

  if (!outbound && !returnTotal) {
    delete store.byOrderKey[orderKey];
    return null;
  }

  const bestSource = entries
    .filter((row) => toNumber(row.amount) > 0)
    .sort((a, b) => sourcePriority(a.source) - sourcePriority(b.source))[0]?.source || 'dhl';

  const summary = {
    outbound: roundMoney(outbound),
    returnTotal: roundMoney(returnTotal),
    total: roundMoney(outbound + returnTotal),
    source: bestSource,
    syncedAt: new Date().toISOString()
  };
  store.byOrderKey[orderKey] = summary;
  return summary;
}

function sourcePriority(source) {
  if (source === 'invoiced') return 0;
  if (source === 'calculated') return 1;
  if (source === 'info') return 2;
  return 3;
}

export function buildShippingCostIndex(db) {
  const store = ensureDhlShippingCosts(db);
  const index = {};

  for (const [orderKey, row] of Object.entries(store.byOrderKey || {})) {
    if (toNumber(row.total) > 0) {
      index[orderKey] = row;
    }
  }

  return index;
}

function shouldLookup(trackingId, store, now = Date.now()) {
  const cached = store.byTracking[trackingId];
  if (!cached) return true;
  if (cached.pending && isFreshEntry(cached, now)) return false;
  if (cached.amount > 0 && cached.source === 'invoiced') return false;
  return !isFreshEntry(cached, now);
}

export async function syncDhlCostsForPackages(packages, env, db, options = {}) {
  const store = ensureDhlShippingCosts(db);
  const maxLookups = toNumber(options.maxLookups) || DEFAULT_MAX_LOOKUPS;

  if (!isDhlConfigured(env)) {
    return {
      configured: false,
      index: buildShippingCostIndex(db),
      summary: { queried: 0, resolved: 0, pending: 0, skipped: packages.length }
    };
  }

  const client = createDhlEcommerceClient(readDhlConfig(env));
  const candidates = [];

  for (const orderPackage of packages) {
    const trackingId = extractTrendyolTrackingId(orderPackage);
    if (!trackingId) continue;
    const orderKey = trendyolOrderKey(orderPackage);
    if (!shouldLookup(trackingId, store)) continue;
    candidates.push({ orderPackage, trackingId, orderKey });
  }

  let queried = 0;
  let resolved = 0;
  let pending = 0;

  for (const item of candidates.slice(0, maxLookups)) {
    queried += 1;
    const nowIso = new Date().toISOString();

    try {
      const result = await client.resolveShipmentCost(item.trackingId);
      if (result.ok && result.amount > 0) {
        store.byTracking[item.trackingId] = {
          trackingNumber: item.trackingId,
          orderNumber: item.orderPackage.orderNumber || '',
          shipmentPackageId: String(item.orderPackage.shipmentPackageId || item.orderPackage.id || ''),
          orderKey: item.orderKey,
          direction: result.direction || 'outbound',
          amount: roundMoney(result.amount),
          desi: toNumber(result.desi),
          source: result.source || 'dhl',
          pending: false,
          syncedAt: nowIso
        };
        aggregateOrderEntry(store, item.orderKey);
        resolved += 1;
      } else {
        store.byTracking[item.trackingId] = {
          trackingNumber: item.trackingId,
          orderNumber: item.orderPackage.orderNumber || '',
          shipmentPackageId: String(item.orderPackage.shipmentPackageId || item.orderPackage.id || ''),
          orderKey: item.orderKey,
          direction: 'outbound',
          amount: 0,
          desi: 0,
          source: 'pending',
          pending: true,
          reason: result.reason || 'not_invoiced_yet',
          syncedAt: nowIso
        };
        pending += 1;
      }
    } catch (error) {
      store.byTracking[item.trackingId] = {
        trackingNumber: item.trackingId,
        orderNumber: item.orderPackage.orderNumber || '',
        shipmentPackageId: String(item.orderPackage.shipmentPackageId || item.orderPackage.id || ''),
        orderKey: item.orderKey,
        direction: 'outbound',
        amount: 0,
        desi: 0,
        source: 'error',
        pending: true,
        reason: error.message || 'lookup_failed',
        syncedAt: nowIso
      };
      pending += 1;
    }
  }

  const summary = {
    queried,
    resolved,
    pending,
    skipped: Math.max(0, candidates.length - queried),
    candidateCount: candidates.length
  };

  store.lastSyncAt = new Date().toISOString();
  store.lastSyncSummary = summary;

  return {
    configured: true,
    index: buildShippingCostIndex(db),
    summary
  };
}

export function resolvePackageShippingMeta(orderPackage, settings) {
  const orderKey = trendyolOrderKey(orderPackage);
  const dhlEntry = settings.shippingCostByOrderKey?.[orderKey];

  if (dhlEntry && toNumber(dhlEntry.total) > 0) {
    return {
      shippingCost: roundMoney(dhlEntry.total),
      outboundShippingCost: roundMoney(dhlEntry.outbound),
      returnShippingCost: roundMoney(dhlEntry.returnTotal),
      shippingCostSource: 'dhl',
      shippingCostEstimated: dhlEntry.source !== 'invoiced'
    };
  }

  return null;
}
