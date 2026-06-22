import { readEnvFile } from '../../env.js';
import { paths } from '../../config.js';
import { envValue } from '../../env.js';

const CHANNEL_DEFS = [
  { id: 'yemeksepeti', label: 'Yemeksepeti', opsChannel: 'yemeksepeti', envKeys: ['YEMEKSEPETI_CLIENT_ID', 'YEMEKSEPETI_CLIENT_SECRET'] },
  { id: 'getir', label: 'Getir', opsChannel: 'getir', envKeys: ['GETIR_SHOP_ID', 'GETIR_API_USERNAME', 'GETIR_API_PASSWORD', 'GETIR_API_BASE_URL'] },
  { id: 'uber-eats', label: 'Uber / Trendyol GO', opsChannel: 'trendyol_go', envKeys: ['UBER_EATS_API_KEY', 'UBER_EATS_API_SECRET'] }
];

function isConfigured(platformEnv, keys) {
  return keys.some((key) => String(envValue(process.env, platformEnv, key, '') || '').trim());
}

async function queryChannelMetrics(pool, opsChannel) {
  if (!pool || !opsChannel) {
    return null;
  }

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const webhookResult = await pool.query(
    `SELECT MAX(created_at) AS last_webhook_at,
            COUNT(*) FILTER (WHERE created_at >= $2) AS webhooks_24h
     FROM ops_webhook_events
     WHERE channel = $1`,
    [opsChannel, since24h]
  );

  const orderResult = await pool.query(
    `SELECT MAX(ordered_at) FILTER (WHERE status NOT IN ('cancelled', 'failed')) AS last_success_order_at,
            MAX(updated_at) AS last_order_update_at
     FROM ops_orders
     WHERE channel = $1`,
    [opsChannel]
  );

  const errorResult = await pool.query(
    `SELECT MAX(created_at) AS last_error_at,
            (SELECT error_summary FROM ops_webhook_events
             WHERE channel = $1 AND status = 'failed'
             ORDER BY created_at DESC LIMIT 1) AS last_error_summary
     FROM ops_webhook_events
     WHERE channel = $1 AND status = 'failed'`,
    [opsChannel]
  );

  const syncResult = await pool.query(
    `SELECT MAX(se.created_at) AS last_sync_at
     FROM ops_shadow_events se
     JOIN ops_orders o ON o.id = se.order_id
     WHERE o.channel = $1 AND se.event_type LIKE '%sync%'`,
    [opsChannel]
  );

  const pendingResult = await pool.query(
    `SELECT COUNT(*)::int AS pending
     FROM ops_outbox ob
     JOIN ops_orders o ON o.id = ob.order_id
     WHERE o.channel = $1 AND ob.status = 'pending'`,
    [opsChannel]
  );

  const wh = webhookResult.rows[0] || {};
  const ord = orderResult.rows[0] || {};
  const err = errorResult.rows[0] || {};
  const sync = syncResult.rows[0] || {};
  const pending = pendingResult.rows[0] || {};

  return {
    lastWebhookAt: wh.last_webhook_at || null,
    lastSuccessfulOrderAt: ord.last_success_order_at || null,
    lastSyncAt: sync.last_sync_at || null,
    lastErrorAt: err.last_error_at || null,
    lastErrorSummary: err.last_error_summary || null,
    webhooksLast24h: Number(wh.webhooks_24h || 0),
    pendingCount: Number(pending.pending || 0)
  };
}

export async function buildProductionChannelStatus(pool, platformEnv = null) {
  const env = platformEnv || (await readEnvFile(paths.platformEnv));
  const channels = [];

  for (const def of CHANNEL_DEFS) {
    const configured = isConfigured(env, def.envKeys);
    if (!configured) {
      channels.push({
        id: def.id,
        label: def.label,
        state: 'not_configured'
      });
      continue;
    }

    const metrics = await queryChannelMetrics(pool, def.opsChannel);
    channels.push({
      id: def.id,
      label: def.label,
      state: 'configured',
      ...metrics
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    environment: String(process.env.NODE_ENV || env.NODE_ENV || 'development'),
    channels
  };
}
