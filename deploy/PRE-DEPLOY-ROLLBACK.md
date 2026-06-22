# Deploy Öncesi Kontrol ve Rollback

Canlı Uber / Getir / Yemeksepeti sipariş hattı için **deploy öncesi zorunlu adımlar**.

## 1. Kod doğrulama

```bash
npm run check
npm test
node scripts/migrations/verify-migration-006.js
npm run smoke   # sunucu çalışıyor olmalı
```

Getir finansal modül dosyaları repoda olmalı:

- `lib/channels/getir-portal-financials.js`
- `lib/channels/getir-orders.js`
- `lib/channels/uber-eats-portal-financials.js`
- `test/getir-benimpos-financials.test.js`

## 2. Veritabanı yedek (Ops Postgres)

**Production VPS:**

```bash
ssh root@VPS_IP
docker exec petfix-prod-postgres pg_dump -U petfix -Fc petfix_ops \
  > /var/backups/petfix_ops_$(date +%Y%m%d_%H%M).dump
```

Yedek doğrulama:

```bash
ls -lh /var/backups/petfix_ops_*.dump | tail -1
```

**Yerel:**

```bash
docker exec petfix_ops_postgres pg_dump -U petfix -Fc petfix_ops > ./backup/petfix_ops_local.dump
```

## 3. Migration 006

Otomatik: uygulama bootstrap sırasında `applyOpsMigrations` çalışır.

Manuel doğrulama:

```bash
node scripts/migrations/ops-hub-migrate.js
node scripts/migrations/verify-migration-006.js
```

Beklenen: ikinci çalıştırmada yeni migration uygulanmaz (`secondRunApplied: []`).

## 4. Deploy

```bash
export VPS_HOST=SUNUCU_IP
bash scripts/ops-deploy-vps.sh
# veya
npm run prod:deploy
```

Deploy sonrası:

```bash
npm run ops:verify-deploy -- https://api.petfix.com.tr
npm run smoke
```

## 5. Oturum / ürün görseli

`product-thumb-img` artık **HttpOnly cookie** (`pf_platform_token`) veya Bearer token gerektirir.

- Kullanıcılar deploy sonrası **bir kez yeniden giriş** yapmalı (cookie oluşması için).
- `<img src="/api/product-thumb-img?...">` cookie ile otomatik çalışır; ekstra header gerekmez.

## 6. Rollback planı

### A) Uygulama rollback (hızlı)

```bash
ssh root@VPS_IP
cd /opt/petfix/buybox-platform
git log -3 --oneline
git checkout <önceki_commit_veya_tag>
docker compose -f compose.prod.yml --env-file .env.production up -d --build petfix-prod-api
docker logs petfix-prod-api --tail 50
```

Önceki imaj varsa:

```bash
docker compose -f compose.prod.yml --env-file .env.production up -d --no-build petfix-prod-api
```

### B) Migration rollback (yalnızca 006 sorun çıkarırsa)

006 yalnızca indeks ekler; veri silmez. Rollback genelde **gerekmez**.

Gerekirse:

```sql
DROP INDEX IF EXISTS idx_ops_orders_branch_channel_ordered_at;
DROP INDEX IF EXISTS idx_ops_orders_ys_ordered_at;
DROP INDEX IF EXISTS idx_ops_order_lines_order_barcode;
DELETE FROM ops_schema_migrations WHERE version = 6;
```

### C) Veritabanı tam geri yükleme (ciddi veri bozulması)

```bash
docker exec -i petfix-prod-postgres pg_restore -U petfix -d petfix_ops --clean --if-exists \
  < /var/backups/petfix_ops_YYYYMMDD_HHMM.dump
```

**Uyarı:** `--clean` mevcut şemayı siler; yalnızca felaket senaryosunda kullanın.

### D) Webhook / sipariş akışı kontrolü

Rollback sonrası:

```bash
curl -s https://api.petfix.com.tr/webhooks/v1/health
curl -s -H "Authorization: Bearer TOKEN" https://api.petfix.com.tr/api/hzlmrktops/orders?days=1
```

## 7. Smoke test kapsamı (otomatik)

`npm run smoke` şunları doğrular:

- HzlMrktOps sipariş sayfası ve API
- Kanal sipariş uçları (Uber Eats, Yemeksepeti, Getir)
- Ürün görseli: auth olmadan 401, cookie ile erişim
- Bozuk JSON → 400
- Dashboard auth

UI kırmızı hata satırı (`orders-error`) manuel veya E2E ile doğrulanır.

## 8. İzleme (deploy sonrası 24 saat)

```bash
docker logs -f petfix-prod-api --tail 100 | grep -E 'HTTP|ERROR|webhook'
docker exec petfix-prod-postgres psql -U petfix -d petfix_ops -c \
  "SELECT channel, count(*) FROM ops_orders WHERE ordered_at > now() - interval '24 hours' GROUP BY channel;"
```

Beklenen: Uber / Getir / YS kanallarında ingest artışı; duplicate external_id hatası yok.
