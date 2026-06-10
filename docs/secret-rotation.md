# Secret Rotation

Repository'de gerçek secret tutulmamalı. `.env`, `.env.production` gitignore'da.

## Rotation gerektiren alanlar

| Secret | Env key | Ne zaman rotate |
|--------|---------|-----------------|
| Platform API token | `PLATFORM_API_TOKEN` | Sızıntı, personel ayrılışı |
| Yemeksepeti OAuth | `YEMEKSEPETI_CLIENT_SECRET` | Repo/commit sızıntısı |
| Yemeksepeti webhook | `YEMEKSEPETI_WEBHOOK_SECRET` | Portal değişikliği, sızıntı |
| Postgres | `POSTGRES_PASSWORD` / URL | Yıllık veya sızıntı |
| BenimPOS | `BENIMPOS_API_KEY`, `BENIMPOS_SECRET_KEY` | Sızıntı |

## Repo geçmişi kontrolü

```bash
git log -p --all -S 'YEMEKSEPETI_CLIENT_SECRET' -- '*.env*'
git log -p --all -S 'PLATFORM_API_TOKEN'
```

Commit edilmiş secret bulunursa: **rotate edin** (silme yeterli değil).

## Rotation adımları

1. Yeni secret üret / Partner Portal'dan güncelle
2. VPS `.env.production` güncelle
3. `docker compose -f compose.prod.yml --env-file .env.production up -d`
4. `/ready` ve smoke test
5. Eski secret'ı iptal et

## Log güvenliği

Yapılandırılmış log Authorization, secret ve PII içermez. Deploy sonrası log örneği kontrol edin.
