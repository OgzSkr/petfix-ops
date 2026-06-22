#!/usr/bin/env node
/**
 * Portal sipariş detay JSON → ops DB (gerçek ürün satırları).
 *   node scripts/ys-portal-ingest-order-details-json.js data/ys-portal-order-details.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { readEnvFile } from '../lib/env.js';
import { paths } from '../lib/config.js';
import { resolveOpsHubConfig } from '../lib/ops-hub/config.js';
import { createOpsPool, closeOpsPool, applyOpsMigrations } from '../lib/ops-hub/db/migrate.js';
import {
  ensureDefaultBranch,
  findOpsOrderByChannelExternalId,
  patchOpsOrderRawPayload,
  replaceOpsOrderLines
} from '../lib/ops-hub/db/repository.js';
import { normalizeYemeksepetiWebhookOrder } from '../lib/ops-hub/channels/yemeksepeti-normalize.js';
import { ingestOpsOrder } from '../lib/ops-hub/ingest/ingest-service.js';
import { ORDER_SOURCES } from '../lib/production/constants.js';

async function main() {
  const filePath = path.resolve(process.argv[2] || path.join(paths.root, 'data', 'ys-portal-order-details.json'));
  if (!fs.existsSync(filePath)) {
    console.error(`Dosya yok: ${filePath}`);
    process.exit(1);
  }

  const rows = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const orders = Array.isArray(rows) ? rows : rows.orders || [];
  const platformEnv = await readEnvFile(paths.platformEnv);
  const config = resolveOpsHubConfig(platformEnv);
  if (!config.postgresEnabled) {
    console.error('OPS_POSTGRES_URL tanımlı değil.');
    process.exit(1);
  }

  const pool = await createOpsPool(config.postgresUrl);
  const result = { total: orders.length, ingested: 0, skipped: 0, failed: 0, errors: [] };

  try {
    await applyOpsMigrations(pool);
    await ensureDefaultBranch(pool);

    for (const row of orders) {
      const orderCode = String(row.orderCode || row.code || '').trim();
      const lines = Array.isArray(row.lines) ? row.lines : [];
      if (!orderCode || !lines.length) {
        result.skipped += 1;
        continue;
      }

      try {
        const normalized = await normalizeYemeksepetiWebhookOrder({
          order_id: orderCode,
          order_code: orderCode,
          status: row.status || 'PICKED_UP',
          delivery_type: row.deliveryType || 'vendor_delivery',
          sys: { created_at: row.placedAt || new Date().toISOString() },
          items: lines.map((line, index) => ({
            sku: line.sku || `portal-line-${index + 1}`,
            barcode: line.barcode ? [line.barcode] : [],
            name: line.name,
            pricing: {
              quantity: line.quantity || 1,
              unit_price: line.unitPrice || 0
            }
          }))
        }, { platformEnv, shadowMode: true });

        if (!normalized.ok) {
          result.failed += 1;
          result.errors.push({ orderCode, errors: normalized.errors });
          continue;
        }

        normalized.order.ingestSource = ORDER_SOURCES.PORTAL;
        const existingOrder = await findOpsOrderByChannelExternalId(pool, 'yemeksepeti', orderCode);
        const rawPayload = {
          source: 'portal_detail',
          orderId: orderCode,
          portalDetail: row,
          grossAmount: lines.reduce((sum, line) => sum + (line.lineTotal || line.unitPrice * line.quantity || 0), 0),
          yemeksepetiOrder: {
            order_id: orderCode,
            order_code: orderCode,
            items: normalized.order.lines.map((line) => ({
              sku: line.channelProductId,
              name: line.title,
              pricing: { quantity: line.quantity, unit_price: line.unitPrice }
            }))
          }
        };

        if (existingOrder) {
          await replaceOpsOrderLines(pool, existingOrder.id, normalized.order.lines);
          const prevPayload = existingOrder.raw_payload && typeof existingOrder.raw_payload === 'object'
            ? existingOrder.raw_payload
            : {};
          await patchOpsOrderRawPayload(pool, existingOrder.id, { ...prevPayload, ...rawPayload });
          result.ingested += 1;
          continue;
        }

        normalized.order.rawPayload = rawPayload;
        await ingestOpsOrder(pool, normalized.order, {
          shadowModeDefault: true,
          branchSlug: 'main',
          platformEnv
        });
        result.ingested += 1;
      } catch (error) {
        result.failed += 1;
        result.errors.push({ orderCode, errors: [error.message] });
      }
    }

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await closeOpsPool();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
