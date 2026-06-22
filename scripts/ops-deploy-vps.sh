#!/usr/bin/env bash
# Mac → VPS production deploy
# Kullanım:
#   export VPS_HOST=203.0.113.10
#   export VPS_USER=root          # veya sudo yetkili kullanıcı
#   export VPS_SSH_KEY=~/.ssh/petfix_ops_deploy
#   bash scripts/ops-deploy-vps.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

: "${VPS_HOST:?VPS_HOST gerekli (ör. 203.0.113.10)}"
VPS_USER="${VPS_USER:-root}"
VPS_SSH_KEY="${VPS_SSH_KEY:-$HOME/.ssh/petfix_ops_deploy}"
APP_DIR="${VPS_APP_DIR:-/opt/petfix/buybox-platform}"
WORKER_DIR="${VPS_WORKER_DIR:-/opt/petfix/live-buybox-worker}"
WORKER_SRC="${WORKER_SRC:-$(dirname "$ROOT")/live-buybox-worker}"
DOMAIN="${OPS_DOMAIN:-api.petfix.com.tr}"

SSH=(ssh -i "$VPS_SSH_KEY" -o StrictHostKeyChecking=accept-new "${VPS_USER}@${VPS_HOST}")
RSYNC=(rsync -az --delete
  -e "ssh -i $VPS_SSH_KEY -o StrictHostKeyChecking=accept-new"
  --exclude .env
  --exclude .env.production
  --exclude .git
  --exclude data/buybox-history.jsonl
  --exclude data/db.json
  --exclude bin/cloudflared
  --exclude logs
)

echo "==> VPS bağlantı testi: ${VPS_USER}@${VPS_HOST}"
"${SSH[@]}" 'echo ok && uname -a'

echo "==> Uzak dizin: $APP_DIR"
"${SSH[@]}" "mkdir -p '$APP_DIR'"

if [[ ! -f "$ROOT/.env.production" ]]; then
  echo "==> .env.production yok — prepare-env-production.sh çalıştırılıyor"
  bash "$ROOT/scripts/prepare-env-production.sh"
fi

if [[ ! -f "$ROOT/.env.production" ]]; then
  echo "HATA: .env.production yok — bash scripts/prepare-env-production.sh"
  exit 1
fi

echo "==> Kod senkronu (buybox-platform)"
"${RSYNC[@]}" "$ROOT/" "${VPS_USER}@${VPS_HOST}:${APP_DIR}/"

if grep -q '^DEPLOY_PROFILE=ops-only' "$ROOT/.env.production" 2>/dev/null; then
  echo "==> DEPLOY_PROFILE=ops-only — live-buybox-worker senkronu atlanıyor"
else
  if [[ ! -f "$WORKER_SRC/src/index.js" ]]; then
    echo "HATA: live-buybox-worker bulunamadı: $WORKER_SRC"
    exit 1
  fi
  echo "==> Kod senkronu (live-buybox-worker)"
  "${SSH[@]}" "mkdir -p '$WORKER_DIR'"
  "${RSYNC[@]}" \
    --exclude .env \
    "$WORKER_SRC/" "${VPS_USER}@${VPS_HOST}:${WORKER_DIR}/"
fi

echo "==> Production .env doğrulama"
"${SSH[@]}" bash -s <<REMOTE
set -euo pipefail
cd '$APP_DIR'
grep -q '^OPS_PUBLIC_API_BASE_URL=' .env.production
grep -q '^GETIR_WEBHOOK_SECRET=' .env.production
REMOTE

echo "==> VPS kurulum (docker + nginx + certbot)"
"${SSH[@]}" "cd '$APP_DIR' && sudo APP_DIR='$APP_DIR' OPS_DOMAIN='$DOMAIN' bash deploy/vps-setup.sh"

echo "==> Production deploy"
if grep -q '^DEPLOY_PROFILE=ops-only' "$ROOT/.env.production" 2>/dev/null; then
  "${SSH[@]}" "cd '$APP_DIR' && SKIP_TESTS=1 bash scripts/deploy-production.sh"
else
  "${SSH[@]}" "cd '$APP_DIR' && SKIP_TESTS=1 bash scripts/deploy-production.sh"
fi

echo "==> Poll timer (systemd)"
"${SSH[@]}" bash -s <<'REMOTE'
set -euo pipefail

# Hızlı poll (canlı sipariş akışı): her 120s. flock ile üst üste binme engellenir.
# Getir delivered geçmişi BURADA çalışmaz (yavaş + paginasyon güvenilmez); ayrı timer'da.
cat > /tmp/petfix-ops-poll.service <<'UNIT'
[Unit]
Description=PetFix Ops channel poll (live)
After=docker.service

[Service]
Type=oneshot
WorkingDirectory=/opt/petfix/buybox-platform
ExecStart=/usr/bin/flock -n /run/petfix-ops-poll.lock /usr/bin/docker exec petfix-prod-api node scripts/ops-hub-poll.js --ys-days 14 --tgo-limit 50 --getir-days 1
UNIT
cat > /tmp/petfix-ops-poll.timer <<'UNIT'
[Unit]
Description=PetFix Ops poll every 120s

[Timer]
OnBootSec=60
OnUnitActiveSec=120
Persistent=true

[Install]
WantedBy=timers.target
UNIT

# Getir delivered backfill: her 3 dk. flock ile tekil çalışır (tek tur ~30-40s).
# Getir pull API'sinde "hazırlanıyor/yolda" durumu yoktur; tamamlanan siparişler
# yalnızca delivered API'den gelir. Sık backfill, teslim sonrası gecikmeyi kısaltır.
cat > /tmp/petfix-ops-getir-backfill.service <<'UNIT'
[Unit]
Description=PetFix Getir delivered backfill
After=docker.service

[Service]
Type=oneshot
WorkingDirectory=/opt/petfix/buybox-platform
ExecStart=/usr/bin/flock -n /run/petfix-ops-getir-backfill.lock /usr/bin/docker exec petfix-prod-api node scripts/ops-hub-poll.js --getir-only --getir-days 2
UNIT
cat > /tmp/petfix-ops-getir-backfill.timer <<'UNIT'
[Unit]
Description=PetFix Getir delivered backfill every 3m

[Timer]
OnBootSec=120
OnUnitActiveSec=180
Persistent=true

[Install]
WantedBy=timers.target
UNIT

sudo mv /tmp/petfix-ops-poll.service /etc/systemd/system/
sudo mv /tmp/petfix-ops-poll.timer /etc/systemd/system/
sudo mv /tmp/petfix-ops-getir-backfill.service /etc/systemd/system/
sudo mv /tmp/petfix-ops-getir-backfill.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now petfix-ops-poll.timer
sudo systemctl enable --now petfix-ops-getir-backfill.timer

# Uber/TGO statü yenileme: her 5 dk (Delivered/completed backfill + duplicate statü güncelleme)
cat > /tmp/petfix-ops-uber-backfill.service <<'UNIT'
[Unit]
Description=PetFix Uber/TGO status backfill
After=docker.service

[Service]
Type=oneshot
WorkingDirectory=/opt/petfix/buybox-platform
ExecStart=/usr/bin/flock -n /run/petfix-ops-uber-backfill.lock /usr/bin/docker exec petfix-prod-api node scripts/ops-hub-poll.js --tgo-only --no-active-only --tgo-limit 40
UNIT
cat > /tmp/petfix-ops-uber-backfill.timer <<'UNIT'
[Unit]
Description=PetFix Uber/TGO backfill every 5m

[Timer]
OnBootSec=180
OnUnitActiveSec=300
Persistent=true

[Install]
WantedBy=timers.target
UNIT

sudo mv /tmp/petfix-ops-uber-backfill.service /etc/systemd/system/
sudo mv /tmp/petfix-ops-uber-backfill.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now petfix-ops-uber-backfill.timer
REMOTE

echo ""
echo "Deploy tamam."
echo "  Health: https://${DOMAIN}/health"
echo "  Ops:    https://${DOMAIN}/ops/"
echo ""
echo "Sonraki adımlar:"
echo "  1. DNS A kaydı: ${DOMAIN} → ${VPS_HOST}"
echo "  2. npm run ops:verify-deploy -- https://${DOMAIN}"
echo "  3. Getir yeni sipariş: https://${DOMAIN}/webhooks/v1/getir/orders/new"
echo "  4. Getir iptal: https://${DOMAIN}/webhooks/v1/getir/orders/cancelled"
echo "  5. npm run ops:webhook-setup"
