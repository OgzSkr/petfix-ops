# Production Deploy

PetFix API production yolu:

```
Partner / Platform → api.petfix.com.tr → Cloudflare DNS → VPS → Nginx → Docker Compose → API → PostgreSQL
```

## Ön koşullar

- VPS (Ubuntu/Debian) — SSH erişimi
- Cloudflare DNS: `api.petfix.com.tr` A kaydı → VPS IP
- Sunucuda `.env.production` (`.env.production.example` kopyası, gerçek secret'lar)

## Ortam

`DEPLOY_PROFILE=ops-only` (varsayılan). Pazaryeri modülü bu repoda yok — `../petfix-marketplace`.

## İlk kurulum (VPS)

```bash
git clone <repo> /opt/petfix/petfix-ops
cd /opt/petfix/petfix-ops
cp .env.production.example .env.production
# .env.production düzenle
sudo bash deploy/vps-setup.sh
```

## Güncelleme deploy

```bash
cd /opt/petfix/petfix-ops
git pull
bash scripts/deploy-production.sh
```

Deploy sırası: build → test → config validation → migration → up → readiness → smoke.

## Webhook URL'leri (Partner Portal)

| Kanal | URL |
|-------|-----|
| Yemeksepeti sipariş | `https://api.petfix.com.tr/webhooks/v1/yemeksepeti/orders` |
| Yemeksepeti katalog | `https://api.petfix.com.tr/webhooks/v1/yemeksepeti/catalog` |
| Getir yeni sipariş | `https://api.petfix.com.tr/webhooks/v1/getir/orders/new` |
| Getir iptal | `https://api.petfix.com.tr/webhooks/v1/getir/orders/cancelled` |

Geçici Cloudflare tunnel URL'lerini production webhook olarak kullanmayın.

## Health

- Liveness: `GET /health` — process ayakta
- Readiness: `GET /ready` — DB, migration, config
- Kanal durumu (auth): `GET /api/admin/channel-status`

## Compose

Production stack: `compose.prod.yml` — yalnızca **Postgres + API** (`DEPLOY_PROFILE=ops-only`).

- Postgres yalnızca Docker ağında (host portu yok)
- API `127.0.0.1:8787` — Nginx reverse proxy
- `restart: unless-stopped`, log rotation, non-root container
- Trendyol BuyBox worker **VPS'te yok** — local Mac'te `live-buybox-worker` çalışır

## Marketplace verisi temizliği (VPS, bir kez)

Eski Buybox/Trendyol JSON kalıntılarını `data/` içinden temizlemek için:

```bash
cd /opt/petfix/petfix-ops
bash scripts/maintenance/vps-ops-only-cleanup.sh --dry-run
bash scripts/maintenance/vps-ops-only-cleanup.sh --purge-files
```

PostgreSQL (`petfix_ops`) sipariş verisine dokunmaz; yalnızca `db.json` marketplace anahtarları ve buybox dosyaları silinir.

## Manuel adımlar (sizden gerekli)

1. VPS IP + SSH
2. Cloudflare DNS A kaydı
3. `.env.production` secret'ları
4. Yemeksepeti Partner Portal → webhook URL + secret
