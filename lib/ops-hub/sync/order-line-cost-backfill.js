import { readEnvFile } from '../../env.js';
import { paths } from '../../config.js';
import { captureOrderLineCosts } from '../ingest/order-line-cost.js';

const BACKFILL_COST_SOURCE = 'backfill_snapshot';

function lineInputFromRow(row) {
  return {
    lineIndex: row.line_index,
    channelProductId: row.channel_product_id,
    barcode: row.barcode,
    title: row.title,
    quantity: Number(row.quantity) || 1,
    unitPrice: row.unit_price != null ? Number(row.unit_price) : null,
    matchingStatus: row.matching_status || 'unmapped',
    benimposSalesCode: row.benimpos_sales_code || null,
    reservedQty: Number(row.reserved_qty) || 0
  };
}

/**
 * unit_cost boş satırlara güncel ana havuz alış fiyatını yazar (geçmiş siparişler için tahmini).
 */
export async function backfillOrderLineCosts(pool, {
  limit = 500,
  dryRun = false,
  platformEnv = null,
  channel = null,
  since = null,
  until = null,
  db: injectedDb = null
} = {}) {
  if (!pool) {
    return { ok: false, error: 'pool gerekli' };
  }

  const env = platformEnv || (await readEnvFile(paths.platformEnv));
  const params = [Math.max(1, Number(limit) || 500)];
  let where = `l.unit_cost IS NULL
     AND o.status NOT IN ('cancelled', 'failed')`;

  if (channel) {
    params.push(String(channel).trim());
    where += ` AND o.channel = $${params.length}`;
  }
  if (since) {
    params.push(new Date(since).toISOString());
    where += ` AND o.ordered_at >= $${params.length}::timestamptz`;
  }
  if (until) {
    params.push(new Date(until).toISOString());
    where += ` AND o.ordered_at < $${params.length}::timestamptz`;
  }

  const result = await pool.query(
    `SELECT l.id, l.order_id, l.line_index, l.barcode, l.title, l.quantity, l.unit_price,
            l.channel_product_id, l.matching_status, l.benimpos_sales_code, l.reserved_qty,
            o.channel, o.ordered_at, o.display_id
     FROM ops_order_lines l
     INNER JOIN ops_orders o ON o.id = l.order_id
     WHERE ${where}
     ORDER BY o.ordered_at DESC
     LIMIT $1`,
    params
  );

  const summary = {
    scanned: result.rows.length,
    updated: 0,
    skipped: 0,
    dryRun,
    errors: []
  };

  if (!result.rows.length) {
    return { ok: true, ...summary };
  }

  const byChannel = new Map();
  for (const row of result.rows) {
    const key = row.channel;
    if (!byChannel.has(key)) byChannel.set(key, []);
    byChannel.get(key).push(row);
  }

  for (const [opsChannel, rows] of byChannel.entries()) {
    const lineInputs = rows.map(lineInputFromRow);
    let captured;
    try {
      captured = await captureOrderLineCosts({
        channel: opsChannel,
        lines: lineInputs,
        platformEnv: env,
        db: injectedDb
      });
    } catch (error) {
      summary.errors.push({ channel: opsChannel, error: error.message || String(error) });
      summary.skipped += rows.length;
      continue;
    }

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const line = captured[i];
      const unitCost = Number(line?.unitCost) || 0;
      if (unitCost <= 0) {
        summary.skipped += 1;
        continue;
      }

      if (dryRun) {
        summary.updated += 1;
        continue;
      }

      try {
        await pool.query(
          `UPDATE ops_order_lines
           SET unit_cost = $2,
               cost_source = $3,
               cost_captured_at = COALESCE(cost_captured_at, NOW()),
               updated_at = NOW()
           WHERE id = $1`,
          [row.id, unitCost, BACKFILL_COST_SOURCE]
        );
        summary.updated += 1;
      } catch (error) {
        summary.errors.push({ lineId: row.id, error: error.message || String(error) });
        summary.skipped += 1;
      }
    }
  }

  return { ok: summary.errors.length === 0, ...summary };
}

export { BACKFILL_COST_SOURCE };
