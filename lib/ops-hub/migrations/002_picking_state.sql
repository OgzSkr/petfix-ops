-- PR-4: Picking state (shadow mode — UI only, no channel writes)

ALTER TABLE ops_order_lines
  ADD COLUMN IF NOT EXISTS picked_qty NUMERIC(12, 3) NOT NULL DEFAULT 0 CHECK (picked_qty >= 0);

ALTER TABLE ops_orders
  ADD COLUMN IF NOT EXISTS picking_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS picking_completed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_ops_orders_picking_queue
  ON ops_orders (branch_id, status, ordered_at DESC)
  WHERE status IN ('received', 'picking');
