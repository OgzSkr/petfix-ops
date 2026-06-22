import { readEnvFile } from '../../env.js';
import { paths } from '../../config.js';
import {
  enrichYemeksepetiOrderPackages,
  hasRealYemeksepetiLines,
  loadYemeksepetiOrderUuidMap,
  resolveYemeksepetiPartnerOrderUuid
} from '../../channels/yemeksepeti-order-enrich.js';
import { packageFromYemeksepetiOpsRow } from '../../channels/ops-orders-bridge.js';
import { resolveYemeksepetiOpsConfig } from '../integrations/branch-config-resolver.js';
import { normalizeYemeksepetiWebhookOrder } from '../channels/yemeksepeti-normalize.js';
import { ingestOpsOrder } from '../ingest/ingest-service.js';

export async function enrichYemeksepetiOpsOrderLines(pool, options = {}) {
  const platformEnv = options.platformEnv || (await readEnvFile(paths.platformEnv));
  const cfg = options.cfg || (await resolveYemeksepetiOpsConfig(pool, { platformEnv }));
  const uuidMap = options.uuidMap || loadYemeksepetiOrderUuidMap();
  const limit = Number(options.limit || 100);

  const result = await pool.query(
    `SELECT o.id, o.external_id, o.display_id, o.status, o.channel_status, o.ordered_at,
            o.ingest_source, o.raw_payload, o.customer_masked, o.delivery_mode,
            COALESCE(
              json_agg(
                json_build_object(
                  'barcode', l.barcode,
                  'title', l.title,
                  'quantity', l.quantity,
                  'unit_price', l.unit_price,
                  'channel_product_id', l.channel_product_id
                )
                ORDER BY l.line_index
              ) FILTER (WHERE l.id IS NOT NULL),
              '[]'::json
            ) AS lines
     FROM ops_orders o
     LEFT JOIN ops_order_lines l ON l.order_id = o.id
     WHERE o.channel = 'yemeksepeti'
     GROUP BY o.id
     ORDER BY o.ordered_at DESC
     LIMIT $1`,
    [limit]
  );

  const summary = {
    scanned: result.rows.length,
    enriched: 0,
    skipped: 0,
    failed: 0,
    errors: []
  };

  for (const row of result.rows) {
    const pkg = packageFromYemeksepetiOpsRow(row);
    if (!pkg) {
      summary.skipped += 1;
      continue;
    }

    if (hasRealYemeksepetiLines(pkg.lines)) {
      summary.skipped += 1;
      continue;
    }

    const partnerOrderId = resolveYemeksepetiPartnerOrderUuid({
      externalId: row.external_id,
      displayId: row.display_id,
      rawPayload: row.raw_payload || {},
      uuidMap
    });

    if (!partnerOrderId) {
      summary.skipped += 1;
      continue;
    }

    try {
      const [enriched] = await enrichYemeksepetiOrderPackages([pkg], cfg, {
        platformEnv,
        pool,
        uuidMap
      });

      if (!enriched?.lines?.length || !hasRealYemeksepetiLines(enriched.lines)) {
        summary.skipped += 1;
        continue;
      }

      const normalized = await normalizeYemeksepetiWebhookOrder(
        {
          order_id: partnerOrderId,
          order_code: row.display_id || row.external_id,
          status: row.channel_status || row.status || enriched.status || 'RECEIVED',
          sys: { created_at: row.ordered_at || enriched.orderDate || new Date().toISOString() },
          items: enriched.lines.map((line, index) => ({
            sku: line.stockCode || line.barcode || `line-${index}`,
            barcode: line.barcode ? [line.barcode] : [],
            name: line.productName,
            pricing: {
              quantity: line.quantity || 1,
              unit_price: line.lineUnitPrice ?? line.unitPrice ?? 0
            }
          }))
        },
        { platformEnv, shadowMode: true }
      );

      if (!normalized.ok) {
        summary.failed += 1;
        summary.errors.push({ externalId: row.external_id, errors: normalized.errors });
        continue;
      }

      normalized.order.ingestSource = row.ingest_source || normalized.order.ingestSource;
      normalized.order.rawPayload = {
        ...(row.raw_payload || {}),
        partnerOrderId,
        yemeksepetiOrder: {
          order_id: partnerOrderId,
          order_code: row.display_id || row.external_id,
          status: row.channel_status || row.status || enriched.status,
          items: normalized.order.lines.map((line) => ({
            sku: line.channelProductId,
            barcode: line.barcode ? [line.barcode] : [],
            name: line.title,
            pricing: {
              quantity: line.quantity,
              unit_price: line.unitPrice
            }
          }))
        }
      };

      await ingestOpsOrder(pool, normalized.order, {
        shadowModeDefault: true,
        branchSlug: options.branchSlug || 'main',
        platformEnv
      });

      summary.enriched += 1;
    } catch (error) {
      summary.failed += 1;
      summary.errors.push({
        externalId: row.external_id,
        errors: [error.message || 'enrich_failed']
      });
    }
  }

  return summary;
}
