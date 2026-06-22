# Scripts

Script'ler amaçlarına göre klasörlere ayrılmıştır. Canlı veri akışı (sipariş çekme,
katalog/stok/fiyat senkronu, webhook) kalıcı servis/worker modüllerinden geçer; buradaki
script'ler ya bunların ince CLI sarmalayıcısıdır ya da tek seferlik bakım/seed/migration
araçlarıdır.

## Klasör yapısı

- `scripts/` (kök) — canlı veri akışı CLI sarmalayıcıları ve deploy/altyapı shell script'leri
  - Veri akışı: `ops-hub-poll.js`, `ops-hub-sync-tgo.js`, `ops-hub-sync-ys.js`,
    `ops-hub-stock-sync.js`, `ys-portal-*`, `ys-enrich-order-lines.js`,
    `ys-backfill-orders-by-id.js`, `ops-backfill-ys-payload.js`, `ops-prod-daily-sync.js`,
    `sync-trendyol-products.js`, `sync-uber-catalog.js`, `ops-auto-match-all-channels.js`,
    `fetch-missing-buybox-from-pages.js`, `ops-autopilot.js`, `ys-portal-webhook-cdp.js`
  - Worker modülleri: `lib/ops-hub/workers/` (`poll-worker`, `daily-sync`,
    `order-lines-enrich-worker`, `portal-sync-worker`)
  - Deploy/altyapı (shell): `deploy-production.sh`, `ops-deploy-vps.sh`,
    `prepare-env-production.sh`, `ops-bootstrap.sh`, `seed-runtime-secrets.sh`,
    `ensure-buybox-worker.sh`, `ops-api-watchdog.sh`, `ops-install-*.sh`,
    `ops-poll-launchd.sh`, `ops-tunnel*.sh`
- `scripts/migrations/` — DB migration ve doğrulama: `ops-hub-migrate.js`, `verify-migration-006.js`
- `scripts/maintenance/` — bakım/diagnostik (JS): `check-db-parity.js`, `trim-snapshots.js`,
  `purge-marketplace-local-data.js`, `vps-ops-only-cleanup.sh`,
  `run-platform-maintenance.js`, `rebuild-workbench-index.js`, `backfill-product-urls.js`,
  `ops-verify-deploy.js`, `chrome-profiles-audit.js`, `chrome-profiles-repair.js`
- `scripts/seed/` — ilk veri importu / seed: `import-xlsx.py`, `parse-*-xlsx.py`,
  `import-benimpos-*.{js,py}`, `import-product-settings-xlsx.js`, `ops-hub-seed-mock.js`,
  `ops-hub-seed-integrations.js`
- `scripts/dev/` — geliştirme/test/diagnostik: `smoke-test.js`, `ops-hub-webhook-test-ys.js`,
  `ops-hub-g6-cancel-test.js`, `benimpos-status.js`, `benimpos-test-trendgo-sale.js`,
  `ops-shadow-readiness.js`, `ops-print-webhook-setup.js`

## Sık kullanılanlar

```bash
# Veri içe aktarma (seed)
python3 scripts/seed/import-xlsx.py data/trendyol-export.xlsx

# Snapshot bakımı
npm run maintain:trim-snapshots

# Ops Hub migration
npm run ops:migrate

# Smoke test
npm run smoke
```
