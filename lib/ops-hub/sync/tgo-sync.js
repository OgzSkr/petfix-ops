import { readEnvFile } from '../../env.js';
import { paths } from '../../config.js';
import { fetchTgoGroceryPackages, probeTgoGroceryPackages } from '../channels/tgo-grocery-fetch.js';
import {
  isTgoOpsConfigured,
  normalizeTgoGroceryPackage,
  ACTIVE_PACKAGE_STATUSES
} from '../channels/tgo-normalize.js';
import { resolveTgoOpsConfig } from '../integrations/branch-config-resolver.js';
import { ingestOpsOrder } from '../ingest/ingest-service.js';
import {
  patchOpsOrderCustomerSnapshot,
  patchOpsOrderRawPayload,
  replaceOpsOrderLines,
  updateOpsOrderStatusByExternalId
} from '../db/repository.js';
import {
  floorOpsStatusAfterPickingComplete,
  mergeOpsOrderStatus,
  mergeTgoChannelStatus
} from '../domain/order-status-priority.js';
import { maskCustomerPayload } from '../domain/pii.js';
import { probeUberEatsApis } from '../../channels/uber-eats-health.js';

export async function refreshDuplicateTgoOrder(pool, normalized, ingest) {
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
  const nextChannelStatus = mergeTgoChannelStatus(
    row.channel_status,
    normalized.order.channelStatus
  );

  if (normalized.order.rawPayload) {
    await patchOpsOrderRawPayload(pool, ingest.orderId, normalized.order.rawPayload);
  }

  const sourceLines = normalized.order.lines || [];
  if (sourceLines.length) {
    await replaceOpsOrderLines(
      pool,
      ingest.orderId,
      sourceLines.map((line, lineIndex) => ({
        lineIndex: line.lineIndex ?? lineIndex,
        channelProductId: line.channelProductId,
        barcode: line.barcode,
        title: line.title,
        quantity: line.quantity,
        unitPrice: line.unitPrice ?? line.unit_price,
        matchingStatus: line.matchingStatus || 'legacy',
        benimposSalesCode: null,
        reservedQty: line.reservedQty ?? 0
      }))
    );
  }

  const sameStatus =
    nextStatus === row.status &&
    String(nextChannelStatus ?? '') === String(row.channel_status ?? '');
  if (sameStatus) return;

  if (nextStatus === 'completed') {
    await pool.query(
      `UPDATE ops_orders
       SET status = $3,
           channel_status = $4,
           completed_at = COALESCE(completed_at, NOW()),
           updated_at = NOW()
       WHERE channel = $1 AND external_id = $2`,
      ['trendyol_go', normalized.order.externalId, nextStatus, nextChannelStatus]
    );
  } else {
    await updateOpsOrderStatusByExternalId(pool, {
      channel: 'trendyol_go',
      externalId: normalized.order.externalId,
      status: nextStatus,
      channelStatus: nextChannelStatus
    });
  }
}

export async function syncTgoReadOnly(pool, options = {}) {
  const cfg = options.cfg || (await resolveTgoOpsConfig(pool, {
    branchId: options.branchId,
    platformEnv: options.platformEnv
  }));
  if (!isTgoOpsConfigured(cfg)) {
    const error = new Error('TGO credential eksik — UBER_EATS_* .env değerlerini kontrol edin.');
    error.statusCode = 400;
    throw error;
  }

  const fetchOptions = {
    pageSize: options.pageSize || 50,
    maxPages: options.maxPages || 5,
    storeId: options.storeId || cfg.storeId || undefined,
    limit: options.limit || 100,
    packageStatus: options.packageStatus || options.activeOnly ? ACTIVE_PACKAGE_STATUSES : undefined
  };

  const packages = await fetchTgoGroceryPackages(cfg, fetchOptions);
  const results = {
    fetched: packages.length,
    ingested: 0,
    duplicates: 0,
    failed: 0,
    errors: [],
    orders: []
  };

  for (const pkg of packages) {
    try {
      const normalized = await normalizeTgoGroceryPackage(pkg, {
        shadowMode: options.shadowMode ?? true,
        platformEnv: options.platformEnv,
        tgoCfg: cfg
      });

      if (!normalized.ok) {
        results.failed += 1;
        results.errors.push({
          externalId: String(pkg.id),
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
        await refreshDuplicateTgoOrder(pool, normalized, ingest);
        if (ingest.orderId && normalized.order.customer) {
          await patchOpsOrderCustomerSnapshot(pool, ingest.orderId, {
            customerMasked: maskCustomerPayload(normalized.order.customer),
            rawPayloadMerge: { customer: normalized.order.customer }
          });
        }
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
        externalId: String(pkg.id),
        errors: [error.message]
      });
    }
  }

  return results;
}

export async function buildIntegrationsHealth(platformEnv = null) {
  const env = platformEnv || (await readEnvFile(paths.platformEnv));
  const cfg = await resolveTgoOpsConfig(null, { platformEnv: env });
  const configured = isTgoOpsConfigured(cfg);

  const trendyolGo = {
    channel: 'trendyol_go',
    gate: 'G1',
    result: 'PARTIAL',
    configured,
    readOnly: true,
    writeEnabled: false,
    statusWrite: {
      accept: 'PUT .../packages/{id}/accept',
      picked: 'PUT .../packages/{id}/picked',
      probed: true
    },
    packages: { ok: false, message: 'Denenmedi' },
    catalog: { ok: false, message: 'Denenmedi' }
  };

  if (configured) {
    trendyolGo.packages = await probeTgoGroceryPackages(cfg);
    const probe = await probeUberEatsApis(cfg);
    trendyolGo.catalog = probe.catalog;
    trendyolGo.ordersApi = probe.orders;
    trendyolGo.result = trendyolGo.packages.ok ? 'PARTIAL' : 'FAIL';
  } else {
    trendyolGo.packages.message = 'UBER_EATS_* credential eksik';
  }

  return {
    generatedAt: new Date().toISOString(),
    channels: {
      trendyol_go: trendyolGo,
      yemeksepeti: {
        channel: 'yemeksepeti',
        gate: 'G4',
        result: 'PARTIAL',
        configured: Boolean(env.YEMEKSEPETI_CLIENT_ID || process.env.YEMEKSEPETI_CLIENT_ID),
        readOnly: true,
        writeEnabled: false,
        message: 'Webhook deploy sonrası ingest açılacak (PR sonrası)'
      },
      getir: {
        channel: 'getir',
        gate: 'G3',
        result: 'FAIL',
        configured: false,
        readOnly: false,
        writeEnabled: false,
        message: 'GETIR credential yok'
      }
    }
  };
}
