import { readEnvFile } from '../../env.js';
import { paths } from '../../config.js';
import { fetchYemeksepetiOrders } from '../../channels/yemeksepeti-orders.js';
import { resolveYemeksepetiOpsConfig } from '../integrations/branch-config-resolver.js';
import { isYsConfigComplete } from '../integrations/config-bridge.js';
import { normalizeYemeksepetiPollOrder } from '../channels/yemeksepeti-normalize.js';
import { ingestOpsOrder } from '../ingest/ingest-service.js';

export async function syncYemeksepetiReadOnly(pool, options = {}) {
  const platformEnv = options.platformEnv || (await readEnvFile(paths.platformEnv));
  const branchId = options.branchId || null;
  const cfg = options.cfg || (await resolveYemeksepetiOpsConfig(pool, { branchId, platformEnv }));

  if (!isYsConfigComplete(cfg)) {
    const error = new Error('YS credential eksik — entegrasyon panelinden veya .env üzerinden yapılandırın.');
    error.statusCode = 400;
    throw error;
  }

  const days = Number(options.days || options.lookbackDays || 14);
  const orders = await fetchYemeksepetiOrders(cfg, {
    days,
    startDate: options.startDate,
    endDate: options.endDate,
    platformEnv,
    pool,
    orderIds: options.orderIds
  });
  const results = {
    fetched: orders.length,
    ingested: 0,
    duplicates: 0,
    failed: 0,
    errors: [],
    orders: []
  };

  for (const row of orders) {
    try {
      const normalized = await normalizeYemeksepetiPollOrder(row, {
        platformEnv,
        shadowMode: options.shadowMode ?? true
      });

      if (!normalized.ok) {
        results.failed += 1;
        results.errors.push({
          externalId: row.shipmentPackageId || row.orderNumber,
          errors: normalized.errors
        });
        continue;
      }

      const ingest = await ingestOpsOrder(pool, normalized.order, {
        shadowModeDefault: options.shadowMode ?? true,
        branchSlug: options.branchSlug || 'main'
      });

      if (ingest.duplicate) {
        results.duplicates += 1;
      } else {
        results.ingested += 1;
      }

      results.orders.push({
        externalId: normalized.order.externalId,
        orderId: ingest.orderId,
        duplicate: ingest.duplicate,
        displayId: normalized.order.displayId,
        status: normalized.order.status
      });
    } catch (error) {
      results.failed += 1;
      results.errors.push({
        externalId: row.shipmentPackageId || row.orderNumber,
        errors: [error.message]
      });
    }
  }

  return results;
}
