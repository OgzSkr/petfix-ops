import { readEnvFile } from '../../env.js';
import { paths } from '../../config.js';
import { normalizeYemeksepetiPortalSummaryOrder } from '../channels/yemeksepeti-normalize.js';
import { ingestOpsOrder } from '../ingest/ingest-service.js';
import { ORDER_SOURCES } from '../../production/constants.js';

export async function syncYemeksepetiPortalSummaries(pool, summaries = [], options = {}) {
  const platformEnv = options.platformEnv || (await readEnvFile(paths.platformEnv));
  const results = {
    fetched: summaries.length,
    ingested: 0,
    duplicates: 0,
    failed: 0,
    errors: [],
    orders: []
  };

  for (const summary of summaries) {
    try {
      const normalized = await normalizeYemeksepetiPortalSummaryOrder(summary, {
        platformEnv,
        shadowMode: options.shadowMode ?? true,
        ingestSource: ORDER_SOURCES.PORTAL
      });

      if (!normalized.ok) {
        results.failed += 1;
        results.errors.push({
          externalId: summary?.orderId || null,
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
        externalId: summary?.orderId || null,
        errors: [error.message]
      });
    }
  }

  return results;
}
