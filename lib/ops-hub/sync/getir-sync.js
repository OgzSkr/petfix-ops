import { readEnvFile } from '../../env.js';
import { paths } from '../../config.js';
import { loginGetirApi, fetchGetirOrders, fetchGetirDeliveredOrders, fetchGetirOrderById } from '../../channels/getir-api.js';
import { resolveGetirOpsConfig } from '../integrations/branch-config-resolver.js';
import { isGetirConfigComplete } from '../integrations/config-bridge.js';
import { normalizeGetirPollOrder, unwrapGetirOrderPayload, resolveGetirExternalId } from '../channels/getir-normalize.js';
import { readDb } from '../../db/store.js';
import { ingestOpsOrder } from '../ingest/ingest-service.js';
import { ORDER_SOURCES } from '../../production/constants.js';
import {
  patchOpsOrderRawPayload,
  replaceOpsOrderLines,
  updateOpsOrderStatusByExternalId,
  listOpsNonTerminalGetirOrders
} from '../db/repository.js';

import {
  floorOpsStatusAfterPickingComplete,
  mergeGetirChannelStatus,
  mergeOpsOrderStatus
} from '../domain/order-status-priority.js';

export async function refreshDuplicateGetirOrder(pool, normalized, ingest) {
  if (!ingest.duplicate || !ingest.orderId) return;

  const current = await pool.query(
    `SELECT status, channel_status, picking_completed_at
     FROM ops_orders
     WHERE id = $1
     LIMIT 1`,
    [ingest.orderId]
  );
  const row = current.rows[0];
  if (!row) return;

  let nextStatus = mergeOpsOrderStatus(row.status, normalized.order.status);
  nextStatus = floorOpsStatusAfterPickingComplete(nextStatus, row.picking_completed_at);
  const nextChannelStatus = mergeGetirChannelStatus(
    row.channel_status,
    normalized.order.channelStatus
  );

  const sameStatus =
    nextStatus === row.status &&
    String(nextChannelStatus ?? '') === String(row.channel_status ?? '');
  if (sameStatus) return;

  await updateOpsOrderStatusByExternalId(pool, {
    channel: 'getir',
    externalId: normalized.order.externalId,
    status: nextStatus,
    channelStatus: nextChannelStatus
  });
  await patchOpsOrderRawPayload(pool, ingest.orderId, normalized.order.rawPayload);
  const sourceLines = normalized.order.lines || [];
  if (!sourceLines.length) return;
  await replaceOpsOrderLines(
    pool,
    ingest.orderId,
    sourceLines.map((line, lineIndex) => ({
      lineIndex,
      channelProductId: line.channelProductId,
      barcode: line.barcode,
      title: line.title,
      quantity: line.quantity,
      unitPrice: line.unitPrice ?? line.unit_price,
      matchingStatus: line.matchingStatus || 'legacy',
      benimposSalesCode: null,
      reservedQty: 0
    }))
  );
}

async function ingestNormalizedGetirPollOrder(pool, normalized, options = {}) {
  const ingest = await ingestOpsOrder(pool, normalized.order, {
    shadowModeDefault: options.shadowMode ?? true,
    branchSlug: options.branchSlug || 'main'
  });

  if (ingest.duplicate) {
    await refreshDuplicateGetirOrder(pool, normalized, ingest);
  }

  return ingest;
}

/** Onay sonrası hazırlık/yolda siparişler — Uber/TGO aktif poll benzeri statü yenileme. */
export async function syncGetirActiveInFlight(pool, options = {}) {
  const platformEnv = options.platformEnv || (await readEnvFile(paths.platformEnv));
  const cfg = options.cfg || (await resolveGetirOpsConfig(pool, {
    branchId: options.branchId,
    platformEnv
  }));

  if (!isGetirConfigComplete(cfg)) {
    return { fetched: 0, refreshed: 0, ingested: 0, duplicates: 0, failed: 0, errors: [], skipped: true };
  }

  const candidates = await listOpsNonTerminalGetirOrders(pool, {
    maxAgeHours: options.maxAgeHours ?? 48,
    limit: options.limit ?? 50
  });

  if (!candidates.length) {
    return { fetched: 0, refreshed: 0, ingested: 0, duplicates: 0, failed: 0, errors: [] };
  }

  const session = options.session || (await loginGetirApi(cfg));
  const db = options.db || (await readDb());
  const results = {
    fetched: candidates.length,
    refreshed: 0,
    ingested: 0,
    duplicates: 0,
    failed: 0,
    errors: []
  };

  for (const row of candidates) {
    try {
      const remote = await fetchGetirOrderById(cfg, session, row.external_id);
      if (!remote) continue;

      const normalized = await normalizeGetirPollOrder(remote, {
        db,
        platformEnv,
        shopId: cfg.shopId,
        shadowMode: options.shadowMode ?? true
      });

      if (!normalized.ok) {
        results.failed += 1;
        results.errors.push({
          externalId: row.external_id,
          errors: normalized.errors
        });
        continue;
      }

      const ingest = await ingestNormalizedGetirPollOrder(pool, normalized, options);
      if (ingest.duplicate) {
        results.duplicates += 1;
        if (
          ingest.existingStatus !== normalized.order.status ||
          (ingest.existingChannelStatus ?? null) !== (normalized.order.channelStatus ?? null)
        ) {
          results.refreshed += 1;
        }
      } else {
        results.ingested += 1;
        results.refreshed += 1;
      }
    } catch (error) {
      results.failed += 1;
      results.errors.push({
        externalId: row.external_id,
        errors: [error.message]
      });
    }
  }

  return results;
}

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

  // db.json'u döngü başına bir kez oku; aksi halde her sipariş için tüm dosya parse edilir.
  const db = options.db || (await readDb());

  const results = {
    fetched: rows.length,
    ingested: 0,
    duplicates: 0,
    failed: 0,
    errors: [],
    orders: []
  };

  for (const { row: rawRow, endpointKind } of rows) {
    const row = unwrapGetirOrderPayload(rawRow);
    try {
      const normalized = await normalizeGetirPollOrder(row, {
        db,
        platformEnv,
        shopId: cfg.shopId,
        endpointKind,
        shadowMode: options.shadowMode ?? true,
        ingestSource: endpointKind === 'unapproved' ? ORDER_SOURCES.WEBHOOK : ORDER_SOURCES.PARTNER_API
      });

      if (!normalized.ok) {
        results.failed += 1;
        results.errors.push({
          externalId: resolveGetirExternalId(row) || null,
          errors: normalized.errors,
          payloadKeys: row && typeof row === 'object' ? Object.keys(row).slice(0, 16) : []
        });
        continue;
      }

      const ingest = await ingestNormalizedGetirPollOrder(pool, normalized, options);

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
        externalId: resolveGetirExternalId(row) || null,
        errors: [error.message]
      });
    }
  }

  try {
    results.active = await syncGetirActiveInFlight(pool, {
      ...options,
      cfg,
      session,
      db,
      platformEnv
    });
  } catch (error) {
    results.active = { error: error.message };
    results.errors.push({ externalId: null, errors: [`Aktif yenileme: ${error.message}`] });
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
    maxPages: options.maxPages ?? 25,
    pageSize: options.pageSize ?? 50
  });

  // db.json'u döngü başına bir kez oku; aksi halde her sipariş için tüm dosya parse edilir.
  const db = options.db || (await readDb());

  const results = {
    days,
    fetched: delivered.length,
    ingested: 0,
    duplicates: 0,
    failed: 0,
    errors: [],
    orders: []
  };

  for (const rawRow of delivered) {
    const row = unwrapGetirOrderPayload(rawRow);
    try {
      const normalized = await normalizeGetirPollOrder(row, {
        db,
        platformEnv,
        shopId: cfg.shopId,
        endpointKind: 'delivered',
        shadowMode: options.shadowMode ?? true,
        ingestSource: options.ingestSource
      });

      if (!normalized.ok) {
        results.failed += 1;
        results.errors.push({
          externalId: resolveGetirExternalId(row) || null,
          errors: normalized.errors,
          payloadKeys: row && typeof row === 'object' ? Object.keys(row).slice(0, 16) : []
        });
        continue;
      }

      const ingest = await ingestOpsOrder(pool, normalized.order, {
        shadowModeDefault: options.shadowMode ?? true,
        branchSlug: options.branchSlug || 'main'
      });

      if (ingest.duplicate) {
        results.duplicates += 1;
        await refreshDuplicateGetirOrder(pool, normalized, ingest);
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
        externalId: resolveGetirExternalId(row) || null,
        errors: [error.message]
      });
    }
  }

  return results;
}

export function summarizeGetirSyncReport(report = {}) {
  const messages = [];
  if (!report.apiReady) {
    messages.push(
      report.apiMessage ||
        'Getir API bilgileri eksik — Integrations veya GETIR_* env alanlarını doldurun.'
    );
  }
  for (const phase of ['live', 'delivered']) {
    const chunk = report[phase];
    if (!chunk) continue;
    if (chunk.error) {
      messages.push(`${phase}: ${chunk.error}`);
      continue;
    }
    if (chunk.failed > 0) {
      const sample = (chunk.errors || [])
        .slice(0, 2)
        .map((row) => (row.errors || []).join(', '))
        .filter(Boolean)
        .join('; ');
      messages.push(
        `${phase}: ${chunk.failed} sipariş yazılamadı` + (sample ? ` (${sample})` : '')
      );
    }
  }
  const active = report.live?.active;
  if (active?.error) {
    messages.push(`aktif: ${active.error}`);
  } else if (Number(active?.refreshed) > 0) {
    messages.push(`${active.refreshed} aktif Getir siparişi güncellendi`);
  }
  if (report.errors?.length) {
    messages.push(...report.errors);
  }

  const delivered = report.delivered || {};
  const live = report.live || {};
  const ingested = (delivered.ingested || 0) + (live.ingested || 0);
  const fetched = (delivered.fetched || 0) + (live.fetched || 0);

  return {
    apiReady: Boolean(report.apiReady),
    ingested,
    fetched,
    duplicates: (delivered.duplicates || 0) + (live.duplicates || 0),
    failed: (delivered.failed || 0) + (live.failed || 0),
    messages,
    ok: messages.length === 0 && (report.apiReady ? ingested > 0 || fetched > 0 || report.force !== true : true)
  };
}
