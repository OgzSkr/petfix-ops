-- Yanlış toplu backfill (11:44–11:51) — shadow event veya gerçek teslim anına çek.
UPDATE ops_orders o
SET completed_at = COALESCE(ev.deliver_at, ev.ready_at)
FROM (
  SELECT
    order_id,
    MAX(created_at) FILTER (
      WHERE event_type IN ('courier_delivered', 'courier_deliver_simulation')
    ) AS deliver_at,
    MAX(created_at) FILTER (
      WHERE event_type IN ('mobile_channel_ready', 'channel_status_write')
    ) AS ready_at
  FROM ops_shadow_events
  GROUP BY order_id
) ev
WHERE o.id = ev.order_id
  AND o.status = 'completed'
  AND o.completed_at >= TIMESTAMPTZ '2026-06-21 11:44:00+00'
  AND o.completed_at <= TIMESTAMPTZ '2026-06-21 11:51:00+00'
  AND COALESCE(ev.deliver_at, ev.ready_at) IS NOT NULL;

-- Olay kaydı olmayan sahte backfill → bilinmiyor (badge gizlenir).
UPDATE ops_orders
SET completed_at = NULL
WHERE status = 'completed'
  AND completed_at >= TIMESTAMPTZ '2026-06-21 11:44:00+00'
  AND completed_at <= TIMESTAMPTZ '2026-06-21 11:51:00+00';
