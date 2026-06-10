# Rollback

## Hızlı rollback (son image)

```bash
cd /opt/petfix/buybox-platform
git checkout <previous-tag-or-commit>
docker compose -f compose.prod.yml --env-file .env.production up -d --build
curl -sf http://127.0.0.1:8787/ready
npm run smoke
```

## Migration rollback

Ops migration'lar forward-only. Geri alma için:

1. Önceki commit'e dön
2. DB snapshot'tan restore (tercih edilen)
3. Veya manuel SQL (yalnızca acil durum)

## Veritabanı restore

```bash
docker compose -f compose.prod.yml exec postgres pg_dump -U petfix petfix_ops > backup.sql
# restore:
cat backup.sql | docker compose -f compose.prod.yml exec -T postgres psql -U petfix petfix_ops
```

## Nginx / TLS

Önceki config: `/etc/nginx/sites-available/api.petfix.com.tr.conf` git'ten `git checkout` ile geri alın, `nginx -t && systemctl reload nginx`.

## Webhook

Rollback sırasında DNS aynı kalır; Partner Portal URL değişmez. Readiness başarısızsa webhook 503 alabilir — önce health/ready düzeltin.
