-- Ek indeksler (001'deki channel+ordered_at ile çakışmayanlar).

CREATE INDEX IF NOT EXISTS idx_ops_orders_branch_channel_ordered_at
  ON ops_orders (branch_id, channel, ordered_at DESC);

CREATE INDEX IF NOT EXISTS idx_ops_orders_ys_ordered_at
  ON ops_orders (ordered_at DESC)
  WHERE channel = 'yemeksepeti';

CREATE INDEX IF NOT EXISTS idx_ops_order_lines_order_barcode
  ON ops_order_lines (order_id, barcode);
