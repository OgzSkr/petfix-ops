# Deploy profilleri

İki ayrı repo, iki port:

| Repo | Port | Kanallar |
|------|------|----------|
| `petfix-ops` | 8787 | Getir, YS, Uber Eats |
| `petfix-marketplace` | 8788 | Trendyol BuyBox |
| `live-buybox-worker` | — | Worker → marketplace :8788 |

## DEPLOY_PROFILE

```bash
# Varsayılan (local + VPS)
DEPLOY_PROFILE=ops-only

# Legacy — pazaryeri yine bu repoda açılmaz; petfix-marketplace kullanın
DEPLOY_PROFILE=full
```

`ops-only` profili:

- Navigasyonda yalnızca **HzlMrktOps** ve **Yönetim**
- `/marketplace/*`, `/api/buybox/*`, komisyon tarifesi vb. engellenir
- Legacy `/siparisler` → `/hzlmrktops/siparisler` yönlendirmesi

Pazaryeri API'leri **profilden bağımsız** bu repoda 404 döner — `petfix-marketplace` kullanın.

## Production (VPS)

```bash
DEPLOY_PROFILE=ops-only
DB_READ_BACKEND=json
SQLITE_DUAL_WRITE=false
```

- Docker: `compose.prod.yml` — buybox-worker yok
- Deploy: `bash scripts/ops-deploy-vps.sh`

## Local

```bash
# Ops paneli
cd petfix-ops && npm start

# Pazaryeri (ayrı terminal)
cd ../petfix-marketplace && npm start
cd ../live-buybox-worker && node src/index.js
```

## Veri ayrımı

`data/db.json` içinde hem ops hem pazaryeri verisi varsa:

```bash
npm run maintain:split-db
```

- Ops: `petfix-ops/data/db.json` — getir, uber-eats, yemeksepeti
- Marketplace: `petfix-marketplace/data/db.json` — trendyol-marketplace, buybox snapshot'ları

## VPS temizliği

Eski monolit kalıntıları (buybox meta, platform.sqlite):

```bash
bash scripts/maintenance/vps-ops-only-cleanup.sh --dry-run
bash scripts/maintenance/vps-ops-only-cleanup.sh --purge-files
```
