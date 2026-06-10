import { normalizeYemeksepetiOrder } from './yemeksepeti-orders.js';
import { resolveRealUtcOrderDateRange } from '../order-profitability.js';
import { ORDER_SOURCES } from '../production/constants.js';

function dedupePackages(packages) {
  const seen = new Set();
  const out = [];
  for (const pkg of packages) {
    const key = String(pkg.shipmentPackageId || pkg.orderNumber || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(pkg);
  }
  return out;
}

/**
 * Webhook ile Ops DB'ye düşen YS siparişlerini kârlılık formatına çevirir.
 * Partner API geçmişi boşken (yaygın) webhook kaynağı devreye girer.
 */
export async function fetchYemeksepetiOrdersFromOps(options = {}) {
  let pool;
  try {
    const { getOpsHubPool } = await import('../ops-hub/bootstrap.js');
    pool = getOpsHubPool();
  } catch {
    return [];
  }

  const { startDate, endDate } = resolveRealUtcOrderDateRange(options);
  const result = await pool.query(
    `SELECT external_id, ordered_at, ingest_source, raw_payload
     FROM ops_orders
     WHERE channel = 'yemeksepeti'
     ORDER BY ordered_at DESC
     LIMIT 500`
  );

  const packages = [];
  for (const row of result.rows) {
    const orderedMs = row.ordered_at ? new Date(row.ordered_at).getTime() : 0;
    if (orderedMs && startDate && orderedMs < startDate) continue;
    if (orderedMs && endDate && orderedMs > endDate) continue;

    const raw = row.raw_payload || {};
    const order = raw.yemeksepetiOrder || raw.order;
    if (!order || typeof order !== 'object') continue;

    packages.push({
      ...normalizeYemeksepetiOrder(order),
      ingestSource: row.ingest_source || ORDER_SOURCES.WEBHOOK
    });
  }

  return dedupePackages(packages);
}

export async function mergeYemeksepetiOrderSources(apiPackages, options = {}) {
  const taggedApi = (apiPackages || []).map((pkg) => ({
    ...pkg,
    ingestSource: pkg.ingestSource || ORDER_SOURCES.PARTNER_API
  }));
  const opsPackages = await fetchYemeksepetiOrdersFromOps(options);
  return dedupePackages([...taggedApi, ...opsPackages]);
}
