-- Production: order source + webhook event dedupe

ALTER TABLE ops_orders
  ADD COLUMN IF NOT EXISTS ingest_source TEXT NOT NULL DEFAULT 'webhook'
    CHECK (ingest_source IN ('webhook', 'partner_api', 'fixture', 'manual'));

CREATE INDEX IF NOT EXISTS idx_ops_orders_ingest_source
  ON ops_orders (channel, ingest_source, ordered_at DESC);

CREATE TABLE IF NOT EXISTS ops_webhook_events (
  id UUID PRIMARY KEY,
  channel TEXT NOT NULL,
  event_id TEXT,
  external_order_id TEXT,
  event_type TEXT NOT NULL DEFAULT 'order',
  payload_hash TEXT,
  status TEXT NOT NULL DEFAULT 'processed',
  order_id UUID REFERENCES ops_orders(id) ON DELETE SET NULL,
  error_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ops_webhook_events_event_id
  ON ops_webhook_events (channel, event_id)
  WHERE event_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ops_webhook_events_composite
  ON ops_webhook_events (channel, external_order_id, event_type, payload_hash)
  WHERE event_id IS NULL AND payload_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ops_webhook_events_channel_created
  ON ops_webhook_events (channel, created_at DESC);
