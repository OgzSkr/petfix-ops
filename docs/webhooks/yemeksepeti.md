# Yemeksepeti Webhooks

## Production URL

```
POST https://api.petfix.com.tr/webhooks/v1/yemeksepeti/orders
POST https://api.petfix.com.tr/webhooks/v1/yemeksepeti/catalog
```

## Doğrulama

Header veya query ile webhook secret gönderilir (`X-Petfix-Webhook-Secret` veya `Authorization: Bearer <secret>`).

Production'da `YEMEKSEPETI_WEBHOOK_SECRET` zorunludur (`WEBHOOK_VERIFY_DISABLED=true` yalnızca development).

## Sipariş kaynağı

| Kaynak | Kullanım |
|--------|----------|
| `webhook` | Canlı siparişler — birincil kaynak |
| `partner_api` | Mutabakat, backfill, geçmiş |
| `fixture` | Test — KPI dışı |
| `manual` | Yönetici kaydı |

## Idempotency

1. Platform `event_id` varsa → `ops_webhook_events (channel, event_id)` unique
2. Yoksa → `channel + external_order_id + event_type + payload_hash`
3. Sipariş seviyesi → `ops_orders (channel, external_id)` unique

Duplicate webhook: 2xx, yeni sipariş oluşturmaz, yapılandırılmış log'da `duplicate`.

## Test (gerçek sipariş oluşturmaz)

```bash
npm run ops:webhook-test-ys
```

Health: `GET /webhooks/v1/health`

## Partner Portal

Shop Integrations → webhook URL ve secret girin. Loglarda 2xx ve `webhook_ingest` shadow event beklenir.
