import { randomUUID } from 'node:crypto';
import { getOpsPool, closeOpsPool, checkOpsDbReady, applyOpsMigrations, getOpsMigrationStatus } from './migrate.js';

export { getOpsPool, closeOpsPool, checkOpsDbReady, applyOpsMigrations, getOpsMigrationStatus };

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

export async function upsertBranchChannelConfig(pool, row) {
  const id = row.id || randomUUID();
  const result = await pool.query(
    `INSERT INTO ops_branch_channel_config (
       id, branch_id, channel, integration_mode, config_json,
       auto_accept_orders, enabled, updated_at
     ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, NOW())
     ON CONFLICT (branch_id, channel) DO UPDATE SET
       integration_mode = EXCLUDED.integration_mode,
       config_json = EXCLUDED.config_json,
       auto_accept_orders = EXCLUDED.auto_accept_orders,
       enabled = EXCLUDED.enabled,
       updated_at = NOW()
     RETURNING *`,
    [
      id,
      row.branchId,
      row.channel,
      row.integrationMode,
      JSON.stringify(row.config),
      row.config.autoAcceptOrders ?? true,
      row.enabled ?? true
    ]
  );
  return result.rows[0];
}

export async function listBranchChannelConfigs(pool, branchId) {
  const result = await pool.query(
    `SELECT id, branch_id, channel, integration_mode, config_json,
            auto_accept_orders, enabled, created_at, updated_at
     FROM ops_branch_channel_config
     WHERE branch_id = $1
     ORDER BY channel`,
    [branchId]
  );
  return result.rows;
}

export async function getBranchChannelConfig(pool, branchId, channel) {
  const result = await pool.query(
    `SELECT id, branch_id, channel, integration_mode, config_json,
            auto_accept_orders, enabled, created_at, updated_at
     FROM ops_branch_channel_config
     WHERE branch_id = $1 AND channel = $2
     LIMIT 1`,
    [branchId, channel]
  );
  return result.rows[0] || null;
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
           reserved_qty, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6,
           $7, $8, $9, $10,
           $11, NOW()
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
          line.reservedQty
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

export async function updateOpsOrderStatusByExternalId(
  pool,
  { channel, externalId, status, channelStatus = null }
) {
  const result = await pool.query(
    `UPDATE ops_orders
     SET status = $3,
         channel_status = COALESCE($4, channel_status),
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

export async function listOpsOrders(pool, { branchId, channel, status, limit = 50, offset = 0 } = {}) {
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

  params.push(limit);
  params.push(offset);

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const result = await pool.query(
    `SELECT id, branch_id, channel, external_id, display_id, status,
            channel_status, delivery_mode, shadow_mode, ingest_source, ordered_at, created_at
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
