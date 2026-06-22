-- Siparişten teslime kadar geçen süre (mobil Tamamlanan sekmesi).
ALTER TABLE ops_orders
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

UPDATE ops_orders
SET completed_at = updated_at
WHERE status = 'completed'
  AND completed_at IS NULL;
