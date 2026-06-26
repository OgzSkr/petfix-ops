-- Product matching normalization scaffold (Phase: SQLite migration)
-- JSON blob (db.productMatching) → normalized tables for parity and audit.

CREATE TABLE IF NOT EXISTS pm_master_products (
  id TEXT PRIMARY KEY,
  benimpos_barcode TEXT NOT NULL,
  name TEXT,
  stock REAL,
  buying_price REAL,
  sale_price_1 REAL,
  synced_at TEXT,
  last_seen_in_benimpos_at TEXT,
  absent_from_benimpos_since TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pm_master_barcode ON pm_master_products (benimpos_barcode);

CREATE TABLE IF NOT EXISTS pm_channel_products (
  channel_id TEXT NOT NULL,
  channel_product_id TEXT NOT NULL,
  channel_barcode TEXT,
  channel_name TEXT,
  ingest_source TEXT,
  last_seen_in_catalog_at TEXT,
  absent_from_catalog_since TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (channel_id, channel_product_id)
);

CREATE INDEX IF NOT EXISTS idx_pm_channel_barcode ON pm_channel_products (channel_barcode);

CREATE TABLE IF NOT EXISTS pm_mappings (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  channel_product_id TEXT NOT NULL,
  master_product_id TEXT,
  status TEXT NOT NULL,
  match_method TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (channel_id, channel_product_id)
);

CREATE INDEX IF NOT EXISTS idx_pm_mappings_master ON pm_mappings (master_product_id);

CREATE TABLE IF NOT EXISTS pm_mapping_events (
  id TEXT PRIMARY KEY,
  channel_id TEXT,
  channel_product_id TEXT,
  master_product_id TEXT,
  action TEXT NOT NULL,
  source TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pm_mapping_events_created ON pm_mapping_events (created_at DESC);
