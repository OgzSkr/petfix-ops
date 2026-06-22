# PetFix Ops (HzlMrktOps)

Getir, Yemeksepeti ve Uber Eats operasyon paneli.

| Ortam | URL | Port |
|-------|-----|------|
| Production VPS | [api.petfix.com.tr](https://api.petfix.com.tr) | 8787 |
| Local | [http://127.0.0.1:8787/hzlmrktops](http://127.0.0.1:8787/hzlmrktops) | 8787 |

**Trendyol BuyBox / Pazaryeri** ayrı repoda çalışır: `../petfix-marketplace` (:8788) + `../live-buybox-worker`.

## Hızlı başlangıç

```bash
cd buybox-platform   # repo adı geçiş döneminde; içerik = petfix-ops
npm install
cp .env.example .env
npm start
```

Pazaryeri (local Mac):

```bash
cd ../petfix-marketplace && npm start
# http://127.0.0.1:8788/marketplace/trendyol
```

## Modüller

- **Siparişler** — kanal siparişleri, kârlılık, BenimPOS satış
- **Kanal eşleştirmeleri** — master ↔ kanal ürün eşleştirme
- **Entegrasyonlar** — webhook, API kimlik bilgileri, şube bağlantıları
- **Yönetim** — şube RBAC, personel

## Veri

| Dosya | Açıklama |
|-------|----------|
| `data/db.json` | Ürün eşleştirme, kanal ürünleri, master katalog |
| PostgreSQL (`OPS_POSTGRES_URL`) | Siparişler, webhook olayları, entegrasyon durumu |

Monolit `db.json`'ı iki repoya bölmek:

```bash
npm run maintain:split-db -- --dry-run
npm run maintain:split-db
```

VPS'te pazaryeri kalıntılarını temizlemek:

```bash
npm run maintain:vps-cleanup -- --dry-run
```

## Deploy

Production `DEPLOY_PROFILE=ops-only` kullanır (`.env.production.example`). Detay: [docs/deploy-profiles.md](docs/deploy-profiles.md).

```bash
bash scripts/ops-deploy-vps.sh
```

Smoke test:

```bash
npm run smoke
```

## Proje yapısı

```
buybox-platform/
├── server.js
├── lib/
│   ├── platform/          # HTTP router, panel servisleri
│   ├── ops-hub/           # PostgreSQL, webhook, poll worker
│   ├── channels/          # Getir, YS, Uber Eats adaptörleri
│   └── product-matching/  # Eşleştirme motoru
├── public/assets/         # Panel istemci kodu
└── scripts/
    ├── ops-deploy-vps.sh
    └── maintenance/       # split-db, purge, VPS cleanup
```

## Ortam değişkenleri

Örnek: `.env.example` (local), `.env.production.example` (VPS).

| Değişken | Açıklama |
|----------|----------|
| `DEPLOY_PROFILE` | `ops-only` (varsayılan) — pazaryeri bu repoda kapalı |
| `HOST` / `PORT` | Dinleme adresi (varsayılan `127.0.0.1:8787`) |
| `PLATFORM_API_TOKEN` | Ayarlanırsa panel Bearer token ister |
| `OPS_POSTGRES_URL` | Ops Hub PostgreSQL bağlantısı |

## Geliştirme

```bash
npm test
npm run check
```
