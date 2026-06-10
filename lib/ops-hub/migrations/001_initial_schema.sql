-- PetFix Ops Hub — initial schema (PR-1)
-- PostgreSQL only; separate from buybox JSON/SQLite

CREATE TABLE IF NOT EXISTS ops_schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ops_branches (
  id UUID PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  benimpos_branch_id TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ops_branch_channel_config (
  id UUID PRIMARY KEY,
  branch_id UUID NOT NULL REFERENCES ops_branches(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('trendyol_go', 'yemeksepeti', 'getir')),
  integration_mode TEXT NOT NULL DEFAULT 'direct'
    CHECK (integration_mode IN ('direct', 'integrator')),
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  auto_accept_orders BOOLEAN NOT NULL DEFAULT TRUE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (branch_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_ops_branch_channel_config_branch
  ON ops_branch_channel_config (branch_id);

CREATE TABLE IF NOT EXISTS ops_orders (
  id UUID PRIMARY KEY,
  branch_id UUID NOT NULL REFERENCES ops_branches(id),
  channel TEXT NOT NULL CHECK (channel IN ('trendyol_go', 'yemeksepeti', 'getir')),
  external_id TEXT NOT NULL,
  display_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN (
      'received', 'picking', 'picked', 'ready',
      'dispatched', 'completed', 'cancelled', 'failed'
    )),
  channel_status TEXT,
  channel_integration_mode TEXT NOT NULL DEFAULT 'direct'
    CHECK (channel_integration_mode IN ('direct', 'integrator')),
  delivery_mode TEXT NOT NULL DEFAULT 'unknown'
    CHECK (delivery_mode IN ('platform_courier', 'own_courier', 'pickup', 'unknown')),
  shadow_mode BOOLEAN NOT NULL DEFAULT TRUE,
  customer_masked JSONB,
  raw_payload JSONB,
  ordered_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (channel, external_id)
);

CREATE INDEX IF NOT EXISTS idx_ops_orders_branch_status
  ON ops_orders (branch_id, status, ordered_at DESC);

CREATE INDEX IF NOT EXISTS idx_ops_orders_channel_ordered
  ON ops_orders (channel, ordered_at DESC);

CREATE TABLE IF NOT EXISTS ops_order_lines (
  id UUID PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES ops_orders(id) ON DELETE CASCADE,
  line_index INTEGER NOT NULL,
  channel_product_id TEXT NOT NULL,
  barcode TEXT,
  title TEXT,
  quantity NUMERIC(12, 3) NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12, 2),
  matching_status TEXT NOT NULL DEFAULT 'unmapped'
    CHECK (matching_status IN ('unmapped', 'matched', 'blocked', 'legacy')),
  benimpos_sales_code TEXT,
  reserved_qty NUMERIC(12, 3) NOT NULL DEFAULT 0 CHECK (reserved_qty >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (order_id, line_index)
);

CREATE INDEX IF NOT EXISTS idx_ops_order_lines_order
  ON ops_order_lines (order_id);

CREATE TABLE IF NOT EXISTS ops_shadow_events (
  id UUID PRIMARY KEY,
  branch_id UUID NOT NULL REFERENCES ops_branches(id),
  order_id UUID REFERENCES ops_orders(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ops_shadow_events_branch_created
  ON ops_shadow_events (branch_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ops_outbox (
  id UUID PRIMARY KEY,
  branch_id UUID NOT NULL REFERENCES ops_branches(id),
  order_id UUID REFERENCES ops_orders(id) ON DELETE SET NULL,
  message_type TEXT NOT NULL
    CHECK (message_type IN ('channel_status', 'benimpos_sale', 'benimpos_cancel', 'stock_push')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ops_outbox_status_created
  ON ops_outbox (status, created_at);

CREATE TABLE IF NOT EXISTS ops_idempotency_keys (
  key TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  response_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ops_idempotency_expires
  ON ops_idempotency_keys (expires_at)
  WHERE expires_at IS NOT NULL;
