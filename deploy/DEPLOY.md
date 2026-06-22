# api.petfix.com.tr — Production Deploy

## Ön koşullar

1. **Güzel.net DNS:** `api.petfix.com.tr` → VPS public IP (A kaydı)
2. **VPS:** Ubuntu/Debian, en az 2 GB RAM, port 80/443 açık
3. **SSH:** root veya sudo kullanıcı + public key

## Mac'ten tek komut deploy

```bash
# SSH anahtarı (bir kez)
ssh-keygen -t ed25519 -f ~/.ssh/petfix_ops_deploy -N "" -C "petfix-ops-deploy"

# Public key'i VPS'e ekle (panel veya ssh-copy-id)
ssh-copy-id -i ~/.ssh/petfix_ops_deploy.pub root@VPS_IP

# Deploy
export VPS_HOST=VPS_IP
export VPS_USER=root
bash scripts/ops-deploy-vps.sh
```

## DNS (Güzel.net)

| Tip | Host | Değer |
|-----|------|-------|
| A | api | VPS_PUBLIC_IP |

TTL: 300–3600. Yayılma 5–30 dk sürebilir.

Doğrulama:

```bash
dig +short api.petfix.com.tr A
```

## Kalıcı YS webhook

Partner portal → Order Webhook Management:

- **URL:** `https://api.petfix.com.tr/webhooks/v1/yemeksepeti/orders`
- **Secret:** `npm run ops:webhook-setup` çıktısındaki değer

Test:

```bash
npm run ops:webhook-test-ys
npm run ops:verify-deploy -- https://api.petfix.com.tr
```

## Mac geçici tunnel (VPS hazır olana kadar)

```bash
npm run ops:tunnel
# Çıkan trycloudflare.com URL'sini YS portalda güncelle
```

Mac kapalıyken veya tunnel düşünce YS siparişleri gelmez — production için VPS şart.

## BuyBox worker (production)

Trendyol BuyBox polling VPS'te `petfix-prod-buybox-worker` container olarak çalışır (`compose.prod.yml`).

```bash
# VPS'te
docker logs -f petfix-prod-buybox-worker --tail 30
curl -s -H "Authorization: Bearer TOKEN" https://api.petfix.com.tr/api/live-status
```

`.env.production` içinde `TRENDYOL_*` ve `LIVE_BUYBOX_WEBHOOK_SECRET` gerekli. Yerelde:

```bash
bash scripts/prepare-env-production.sh   # yerel .env → .env.production
export VPS_HOST=SUNUCU_IP
bash scripts/ops-deploy-vps.sh             # worker klasörünü de kopyalar
```
