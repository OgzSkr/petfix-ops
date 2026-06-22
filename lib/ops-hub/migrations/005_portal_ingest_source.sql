-- Portal sipariş geçmişi (GraphQL özet) kaynağı
ALTER TABLE ops_orders DROP CONSTRAINT IF EXISTS ops_orders_ingest_source_check;
ALTER TABLE ops_orders
  ADD CONSTRAINT ops_orders_ingest_source_check
  CHECK (ingest_source IN ('webhook', 'partner_api', 'portal_api', 'fixture', 'manual'));
