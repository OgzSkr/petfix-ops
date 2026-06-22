-- completed_at yanlış backfill düzeltmesi (migration 011 updated_at kopyası).
-- Gerçek teslim: courier_delivered olayı.
UPDATE ops_orders o
SET completed_at = sub.delivered_at
FROM (
  SELECT DISTINCT ON (order_id) order_id, created_at AS delivered_at
  FROM ops_shadow_events
  WHERE event_type IN ('courier_delivered', 'courier_deliver_simulation')
  ORDER BY order_id, created_at ASC
) sub
WHERE o.id = sub.order_id
  AND o.status = 'completed';

-- Teslim olayı yok + toplu backfill zaman damgası → bilinmiyor (badge gizlenir).
UPDATE ops_orders
SET completed_at = NULL
WHERE status = 'completed'
  AND completed_at IS NOT NULL
  AND id NOT IN (
    SELECT order_id FROM ops_shadow_events
    WHERE event_type IN ('courier_delivered', 'courier_deliver_simulation')
  )
  AND completed_at >= TIMESTAMPTZ '2026-06-21 11:44:00+00'
  AND completed_at <= TIMESTAMPTZ '2026-06-21 11:46:00+00';
