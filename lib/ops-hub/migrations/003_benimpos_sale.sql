-- PR-6: BenimPOS satış referansı

ALTER TABLE ops_orders
  ADD COLUMN IF NOT EXISTS benimpos_sales_code TEXT;

CREATE INDEX IF NOT EXISTS idx_ops_orders_benimpos_sales
  ON ops_orders (benimpos_sales_code)
  WHERE benimpos_sales_code IS NOT NULL;
