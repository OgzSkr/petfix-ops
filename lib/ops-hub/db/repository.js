import { randomUUID } from 'node:crypto';
import { getOpsPool, closeOpsPool, checkOpsDbReady, applyOpsMigrations, getOpsMigrationStatus } from './migrate.js';
import { hydrateStoredChannelConfig } from '../integrations/channel-secrets-crypto.js';
import { readEnvFile } from '../../env.js';
import { paths } from '../../config.js';
import { STAFF_DAY_ORDERED_AT_SQL } from '../staff/staff-day.js';

export { getOpsPool, closeOpsPool, checkOpsDbReady, applyOpsMigrations, getOpsMigrationStatus };

async function resolvePlatformEnv(platformEnv) {
  return platformEnv || readEnvFile(paths.platformEnv);
}

function hydrateRow(row, platformEnv) {
  return hydrateStoredChannelConfig(row, platformEnv);
}

export async function ensureDefaultBranch(pool, { slug = 'main', name = 'Ana Şube' } = {}) {
  const existing = await pool.query(
    'SELECT id, slug, name FROM ops_branches WHERE slug = $1 LIMIT 1',
    [slug]
  );
  if (existing.rows[0]) {
    return existing.rows[0];
  }

  const id = randomUUID();
  const inserted = await pool.query(
    `INSERT INTO ops_branches (id, slug, name)
     VALUES ($1, $2, $3)
     RETURNING id, slug, name`,
    [id, slug, name]
  );
  return inserted.rows[0];
}

export async function upsertBranchChannelConfig(pool, row, options = {}) {
  const id = row.id || randomUUID();
  const result = await pool.query(
    `INSERT INTO ops_branch_channel_config (
       id, branch_id, channel, integration_mode, config_json,
       auto_accept_orders, enabled, secrets_ciphertext, updated_at
     ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, NOW())
     ON CONFLICT (branch_id, channel) DO UPDATE SET
       integration_mode = EXCLUDED.integration_mode,
       config_json = EXCLUDED.config_json,
       auto_accept_orders = EXCLUDED.auto_accept_orders,
       enabled = EXCLUDED.enabled,
       secrets_ciphertext = COALESCE(EXCLUDED.secrets_ciphertext, ops_branch_channel_config.secrets_ciphertext),
       updated_at = NOW()
     RETURNING *`,
    [
      id,
      row.branchId,
      row.channel,
      row.integrationMode,
      JSON.stringify(row.config),
      row.config.autoAcceptOrders ?? true,
      row.enabled ?? true,
      row.secretsCiphertext ?? null
    ]
  );
  const platformEnv = await resolvePlatformEnv(options.platformEnv);
  return hydrateRow(result.rows[0], platformEnv);
}

export async function listBranchChannelConfigs(pool, branchId, options = {}) {
  const result = await pool.query(
    `SELECT id, branch_id, channel, integration_mode, config_json,
            auto_accept_orders, enabled, secrets_ciphertext, created_at, updated_at
     FROM ops_branch_channel_config
     WHERE branch_id = $1
     ORDER BY channel`,
    [branchId]
  );
  const platformEnv = await resolvePlatformEnv(options.platformEnv);
  return result.rows.map((row) => hydrateRow(row, platformEnv));
}

export async function getBranchChannelConfig(pool, branchId, channel, options = {}) {
  const result = await pool.query(
    `SELECT id, branch_id, channel, integration_mode, config_json,
            auto_accept_orders, enabled, secrets_ciphertext, created_at, updated_at
     FROM ops_branch_channel_config
     WHERE branch_id = $1 AND channel = $2
     LIMIT 1`,
    [branchId, channel]
  );
  const row = result.rows[0];
  if (!row) return null;
  const platformEnv = await resolvePlatformEnv(options.platformEnv);
  return hydrateRow(row, platformEnv);
}

export async function insertOpsOrder(pool, order) {
  const orderId = order.id || randomUUID();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO ops_orders (
         id, branch_id, channel, external_id, display_id, status,
         channel_status, channel_integration_mode, delivery_mode,
         shadow_mode, customer_masked, raw_payload, ingest_source, ordered_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, $8, $9,
         $10, $11::jsonb, $12::jsonb, $13, $14::timestamptz, NOW()
       )`,
      [
        orderId,
        order.branchId,
        order.channel,
        order.externalId,
        order.displayId,
        order.status,
        order.channelStatus,
        order.channelIntegrationMode,
        order.deliveryMode,
        order.shadowMode,
        order.customerMasked ? JSON.stringify(order.customerMasked) : null,
        order.rawPayload ? JSON.stringify(order.rawPayload) : null,
        order.ingestSource || 'webhook',
        order.orderedAt
      ]
    );

    for (const line of order.lines) {
      await client.query(
        `INSERT INTO ops_order_lines (
           id, order_id, line_index, channel_product_id, barcode, title,
           quantity, unit_price, matching_status, benimpos_sales_code,
           reserved_qty, unit_cost, cost_source, cost_captured_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6,
           $7, $8, $9, $10,
           $11, $12, $13, $14::timestamptz, NOW()
         )`,
        [
          randomUUID(),
          orderId,
          line.lineIndex,
          line.channelProductId,
          line.barcode,
          line.title,
          line.quantity,
          line.unitPrice,
          line.matchingStatus,
          line.benimposSalesCode,
          line.reservedQty,
          line.unitCost ?? null,
          line.costSource ?? null,
          line.costCapturedAt ?? null
        ]
      );
    }

    await client.query('COMMIT');
    return { id: orderId };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function replaceOpsOrderLines(pool, orderId, lines = []) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM ops_order_lines WHERE order_id = $1', [orderId]);
    for (const line of lines) {
      await client.query(
        `INSERT INTO ops_order_lines (
           id, order_id, line_index, channel_product_id, barcode, title,
           quantity, unit_price, matching_status, benimpos_sales_code,
           reserved_qty, unit_cost, cost_source, cost_captured_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6,
           $7, $8, $9, $10,
           $11, $12, $13, $14::timestamptz, NOW()
         )`,
        [
          randomUUID(),
          orderId,
          line.lineIndex,
          line.channelProductId,
          line.barcode,
          line.title,
          line.quantity,
          line.unitPrice,
          line.matchingStatus,
          line.benimposSalesCode,
          line.reservedQty,
          line.unitCost ?? null,
          line.costSource ?? null,
          line.costCapturedAt ?? null
        ]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function patchOpsOrderRawPayload(pool, orderId, rawPayload) {
  await pool.query(
    `UPDATE ops_orders SET raw_payload = $2::jsonb, updated_at = NOW() WHERE id = $1`,
    [orderId, JSON.stringify(rawPayload || {})]
  );
}

export async function patchOpsOrderCustomerSnapshot(pool, orderId, { customerMasked, rawPayloadMerge } = {}) {
  if (!orderId) return;
  const parts = ['updated_at = NOW()'];
  const params = [orderId];
  if (customerMasked !== undefined) {
    params.push(JSON.stringify(customerMasked));
    parts.push(`customer_masked = $${params.length}::jsonb`);
  }
  if (rawPayloadMerge !== undefined) {
    params.push(JSON.stringify(rawPayloadMerge));
    parts.push(`raw_payload = COALESCE(raw_payload, '{}'::jsonb) || $${params.length}::jsonb`);
  }
  if (parts.length === 1) return;
  await pool.query(
    `UPDATE ops_orders SET ${parts.join(', ')} WHERE id = $1`,
    params
  );
}

export async function recordIdempotencyKey(
  pool,
  { key, scope, resourceType, resourceId, responseHash = null, expiresAt = null }
) {
  await pool.query(
    `INSERT INTO ops_idempotency_keys (
       key, scope, resource_type, resource_id, response_hash, expires_at
     ) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (key) DO NOTHING`,
    [key, scope, resourceType, resourceId, responseHash, expiresAt]
  );
}

export async function hasIdempotencyKey(pool, key) {
  const result = await pool.query(
    'SELECT key FROM ops_idempotency_keys WHERE key = $1 LIMIT 1',
    [key]
  );
  return Boolean(result.rows[0]);
}

export async function findOpsOrderByChannelExternalId(pool, channel, externalId) {
  const result = await pool.query(
    `SELECT id, channel, external_id, display_id, status, shadow_mode, ingest_source, ordered_at
     FROM ops_orders
     WHERE channel = $1 AND external_id = $2
     LIMIT 1`,
    [channel, externalId]
  );
  return result.rows[0] || null;
}

/** Backfill/poll canlı modda eski shadow kayıtları listeye almak için. */
export async function promoteOpsOrderToLiveIfShadow(pool, { orderId }) {
  if (!orderId) return null;
  const result = await pool.query(
    `UPDATE ops_orders
     SET shadow_mode = false, updated_at = NOW()
     WHERE id = $1 AND shadow_mode = true
     RETURNING id, display_id, shadow_mode`,
    [orderId]
  );
  return result.rows[0] || null;
}

export async function updateOpsOrderStatusByExternalId(
  pool,
  { channel, externalId, status, channelStatus = null }
) {
  const result = await pool.query(
    `UPDATE ops_orders
     SET status = $3,
         channel_status = COALESCE($4, channel_status),
         completed_at = CASE
           WHEN $3 = 'completed' THEN COALESCE(completed_at, picking_completed_at, NOW())
           ELSE completed_at
         END,
         updated_at = NOW()
     WHERE channel = $1 AND external_id = $2
     RETURNING id, channel, external_id, status, channel_status`,
    [channel, externalId, status, channelStatus]
  );
  return result.rows[0] || null;
}

export async function getOpsOrderById(pool, orderId) {
  const orderResult = await pool.query(
    `SELECT *
     FROM ops_orders
     WHERE id = $1
     LIMIT 1`,
    [orderId]
  );
  const order = orderResult.rows[0];
  if (!order) {
    return null;
  }

  const linesResult = await pool.query(
    `SELECT *
     FROM ops_order_lines
     WHERE order_id = $1
     ORDER BY line_index ASC`,
    [orderId]
  );

  return { order, lines: linesResult.rows };
}

/** Getir — tamamlanmamış/iptal olmayan son siparişler (aktif statü yenileme için). */
export async function listOpsNonTerminalGetirOrders(pool, { maxAgeHours = 48, limit = 50 } = {}) {
  const hours = Math.max(1, Math.min(Number(maxAgeHours) || 48, 168));
  const rowLimit = Math.max(1, Math.min(Number(limit) || 50, 100));
  const result = await pool.query(
    `SELECT id, external_id, status, channel_status, ordered_at
     FROM ops_orders
     WHERE channel = 'getir'
       AND status NOT IN ('completed', 'cancelled')
       AND ordered_at >= NOW() - ($1::text || ' hours')::interval
     ORDER BY ordered_at DESC
     LIMIT $2`,
    [String(hours), rowLimit]
  );
  return result.rows;
}

export async function countStaffOrders(pool, { branchId, liveOnly = true } = {}) {
  const params = [branchId];
  const clauses = [
    'branch_id = $1',
    STAFF_DAY_ORDERED_AT_SQL
  ];
  if (liveOnly) {
    clauses.push('shadow_mode = false');
  }

  const where = clauses.join(' AND ');
  const result = await pool.query(
    `SELECT
       count(*) FILTER (WHERE status IN ('received', 'picking', 'picked')) AS picking,
       count(*) FILTER (
         WHERE status IN ('ready', 'dispatched')
           OR (channel = 'getir' AND status = 'completed' AND channel_status NOT IN ('900', '1500'))
       ) AS on_the_way,
       count(*) FILTER (
         WHERE (status = 'ready' AND delivery_mode = 'own_courier')
           OR (channel = 'getir' AND status = 'completed' AND channel_status NOT IN ('900', '1500'))
       ) AS courier,
       count(*) FILTER (
         WHERE status = 'completed'
           AND (channel != 'getir' OR channel_status IN ('900', '1500'))
       ) AS completed
     FROM ops_orders
     WHERE ${where}`,
    params
  );
  const row = result.rows[0] || {};
  return {
    picking: Number(row.picking || 0),
    onTheWay: Number(row.on_the_way || 0),
    courier: Number(row.courier || 0),
    completed: Number(row.completed || 0),
    active: Number(row.picking || 0)
  };
}

export async function countStaffOrdersByChannel(pool, { branchId, liveOnly = true } = {}) {
  const params = [branchId];
  const clauses = [
    'branch_id = $1',
    STAFF_DAY_ORDERED_AT_SQL
  ];
  if (liveOnly) {
    clauses.push('shadow_mode = false');
  }

  const where = clauses.join(' AND ');
  const result = await pool.query(
    `SELECT channel,
       count(*) FILTER (WHERE status IN ('received', 'picking', 'picked')) AS picking,
       count(*) FILTER (
         WHERE status IN ('ready', 'dispatched')
           OR (channel = 'getir' AND status = 'completed' AND channel_status NOT IN ('900', '1500'))
       ) AS on_the_way,
       count(*) FILTER (
         WHERE (status = 'ready' AND delivery_mode = 'own_courier')
           OR (channel = 'getir' AND status = 'completed' AND channel_status NOT IN ('900', '1500'))
       ) AS courier,
       count(*) FILTER (
         WHERE status = 'completed'
           AND (channel != 'getir' OR channel_status IN ('900', '1500'))
       ) AS completed
     FROM ops_orders
     WHERE ${where}
     GROUP BY channel`,
    params
  );

  const byChannel = {};
  for (const row of result.rows) {
    const picking = Number(row.picking || 0);
    const onTheWay = Number(row.on_the_way || 0);
    const courier = Number(row.courier || 0);
    const completed = Number(row.completed || 0);
    byChannel[row.channel] = {
      picking,
      onTheWay,
      courier,
      completed,
      active: picking
    };
  }
  return byChannel;
}

export async function listOpsOrders(pool, {
  branchId,
  channel,
  status,
  limit = 50,
  offset = 0,
  liveOnly = false,
  since = null,
  staffDay = false
} = {}) {
  const clauses = [];
  const params = [];

  if (branchId) {
    params.push(branchId);
    clauses.push(`branch_id = $${params.length}`);
  }
  if (channel) {
    params.push(channel);
    clauses.push(`channel = $${params.length}`);
  }
  if (status) {
    params.push(status);
    clauses.push(`status = $${params.length}`);
  }
  if (liveOnly) {
    clauses.push('shadow_mode = false');
  }
  if (staffDay) {
    clauses.push(STAFF_DAY_ORDERED_AT_SQL);
  } else if (since) {
    params.push(since);
    clauses.push(`ordered_at >= $${params.length}`);
  }

  params.push(limit);
  params.push(offset);

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const result = await pool.query(
    `SELECT id, branch_id, channel, external_id, display_id, status,
            channel_status, delivery_mode, shadow_mode, ingest_source,
            ordered_at, completed_at, updated_at, created_at,
            picking_completed_at, customer_masked,
            raw_payload,
            (SELECT COALESCE(SUM(l.quantity * COALESCE(l.unit_price, 0)), 0)
             FROM ops_order_lines l WHERE l.order_id = ops_orders.id) AS line_total,
            (SELECT COUNT(*)::int FROM ops_order_lines l WHERE l.order_id = ops_orders.id) AS line_count,
            (SELECT COALESCE(SUM(l.quantity), 0)::int FROM ops_order_lines l WHERE l.order_id = ops_orders.id) AS total_item_qty
     FROM ops_orders
     ${where}
     ORDER BY ordered_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return result.rows;
}

export async function insertShadowEvent(pool, { branchId, orderId, eventType, payload }) {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO ops_shadow_events (id, branch_id, order_id, event_type, payload)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [id, branchId, orderId || null, eventType, JSON.stringify(payload)]
  );
  return { id };
}

export async function listShadowEvents(pool, { branchId, limit = 200 } = {}) {
  const params = [branchId, limit];
  const result = await pool.query(
    `SELECT id, branch_id, order_id, event_type, payload, created_at
     FROM ops_shadow_events
     WHERE branch_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    params
  );
  return result.rows;
}
