# Production Checklist

## Altyapı

- [ ] DNS: `api.petfix.com.tr` A kaydı VPS IP'ye işaret ediyor
- [ ] HTTPS: Let's Encrypt sertifikası geçerli
- [ ] Firewall: yalnızca 22, 80, 443 açık; Postgres internete kapalı
- [ ] `.env.production` sunucuda, repoda yok

## Servis

- [ ] `GET /health` → 200, `status: alive`
- [ ] `GET /ready` → 200, `status: ready`
- [ ] Migration'lar uygulandı (`ops_schema_migrations`)
- [ ] Smoke test geçti: `npm run smoke`

## Webhook

- [ ] Partner Portal URL: `https://api.petfix.com.tr/webhooks/v1/yemeksepeti/orders`
- [ ] Webhook secret eşleşiyor
- [ ] Test event alındı (log: `YS-WEBHOOK`, status `ingested`)
- [ ] Duplicate test: aynı event_id → tek sipariş, 2xx

## Veri & güvenlik

- [ ] Loglarda secret/token yok
- [ ] Fixture siparişleri KPI dışında
- [ ] Backup aktif (pg_dump cron)
- [ ] Restore prosedürü dokümante (`docs/rollback.md`)

## Kanal durumu

- [ ] `GET /api/admin/channel-status` (Bearer token) kanal metriklerini döndürüyor

## Deploy komutu

```bash
bash scripts/deploy-production.sh
```

Başarısız adımda deploy durur; logları kontrol edip düzeltin veya rollback uygulayın.
