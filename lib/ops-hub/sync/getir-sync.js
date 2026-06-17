import { readEnvFile } from '../../env.js';
import { paths } from '../../config.js';
import { loginGetirApi, fetchGetirOrders, fetchGetirDeliveredOrders } from '../../channels/getir-api.js';
import { resolveGetirOpsConfig } from '../integrations/branch-config-resolver.js';
import { isGetirConfigComplete } from '../integrations/config-bridge.js';
import { normalizeGetirPollOrder } from '../channels/getir-normalize.js';
import { ingestOpsOrder } from '../ingest/ingest-service.js';

export async function syncGetirReadOnly(pool, options = {}) {
  const platformEnv = options.platformEnv || (await readEnvFile(paths.platformEnv));
  const branchId = options.branchId || null;
  const cfg = options.cfg || (await resolveGetirOpsConfig(pool, { branchId, platformEnv }));

  if (!isGetirConfigComplete(cfg)) {
    const error = new Error('Getir credential eksik — shopId, API URL, kullanıcı ve şifre gerekli.');
    error.statusCode = 400;
    throw error;
  }

  const session = await loginGetirApi(cfg);
  const unapproved = await fetchGetirOrders(cfg, 'unapproved', session);
  const cancelled = await fetchGetirOrders(cfg, 'cancelled', session);
  const rows = [
    ...unapproved.map((row) => ({ row, endpointKind: 'unapproved' })),
    ...cancelled.map((row) => ({ row, endpointKind: 'cancelled' }))
  ];

  const results = {
    fetched: rows.length,
    ingested: 0,
    duplicates: 0,
    failed: 0,
    errors: [],
    orders: []
  };

  for (const { row, endpointKind } of rows) {
    try {
      const normalized = await normalizeGetirPollOrder(row, {
        platformEnv,
        shopId: cfg.shopId,
        endpointKind,
        shadowMode: options.shadowMode ?? true
      });

      if (!normalized.ok) {
        results.failed += 1;
        results.errors.push({
          externalId: row?.id || row?.orderId,
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
        externalId: row?.id || row?.orderId,
        errors: [error.message]
      });
    }
  }

  return results;
}

/** Tamamlanan geçmiş siparişler — /v1/orders/delivered (tarih aralığı + sayfalama). */
export async function syncGetirDeliveredHistory(pool, options = {}) {
  const platformEnv = options.platformEnv || (await readEnvFile(paths.platformEnv));
  const branchId = options.branchId || null;
  const cfg = options.cfg || (await resolveGetirOpsConfig(pool, { branchId, platformEnv }));

  if (!isGetirConfigComplete(cfg)) {
    const error = new Error('Getir credential eksik — shopId, API URL, kullanıcı ve şifre gerekli.');
    error.statusCode = 400;
    throw error;
  }

  const days = Math.max(1, Math.min(Number(options.days) || 14, 365));
  const session = await loginGetirApi(cfg);
  const delivered = await fetchGetirDeliveredOrders(cfg, session, {
    days,
    maxPages: options.maxPages ?? 100,
    pageSize: options.pageSize ?? 50
  });

  const results = {
    days,
    fetched: delivered.length,
    ingested: 0,
    duplicates: 0,
    failed: 0,
    errors: [],
    orders: []
  };

  for (const row of delivered) {
    try {
      const normalized = await normalizeGetirPollOrder(row, {
        platformEnv,
        shopId: cfg.shopId,
        endpointKind: 'delivered',
        shadowMode: options.shadowMode ?? true,
        ingestSource: options.ingestSource
      });

      if (!normalized.ok) {
        results.failed += 1;
        results.errors.push({
          externalId: row?.id || row?.orderId,
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
        externalId: row?.id || row?.orderId,
        errors: [error.message]
      });
    }
  }

  return results;
}
