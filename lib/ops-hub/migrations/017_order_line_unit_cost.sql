-- Sipariş satırına ingest anındaki ana havuz alış fiyatı (BenimPOS sync snapshot).
ALTER TABLE ops_order_lines
  ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(12, 4),
  ADD COLUMN IF NOT EXISTS cost_source TEXT,
  ADD COLUMN IF NOT EXISTS cost_captured_at TIMESTAMPTZ;
