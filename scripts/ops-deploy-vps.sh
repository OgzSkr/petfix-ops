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
DOMAIN="${OPS_DOMAIN:-api.petfix.com.tr}"

SSH=(ssh -i "$VPS_SSH_KEY" -o StrictHostKeyChecking=accept-new "${VPS_USER}@${VPS_HOST}")
RSYNC=(rsync -az --delete
  -e "ssh -i $VPS_SSH_KEY -o StrictHostKeyChecking=accept-new"
  --exclude node_modules
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

if [[ ! -f "$ROOT/.env" ]]; then
  echo "HATA: .env yok — önce yerel .env hazırlayın."
  exit 1
fi

echo "==> Kod senkronu"
"${RSYNC[@]}" "$ROOT/" "${VPS_USER}@${VPS_HOST}:${APP_DIR}/"

echo "==> Production .env (OPS_PUBLIC + HOST ayarları)"
"${SSH[@]}" bash -s <<REMOTE
set -euo pipefail
cd '$APP_DIR'
grep -q '^OPS_PUBLIC_API_BASE_URL=' .env 2>/dev/null || \
  echo 'OPS_PUBLIC_API_BASE_URL=https://${DOMAIN}' >> .env
sed -i.bak -E 's|^OPS_PUBLIC_API_BASE_URL=.*|OPS_PUBLIC_API_BASE_URL=https://${DOMAIN}|' .env
sed -i.bak -E 's|^HOST=.*|HOST=0.0.0.0|' .env
sed -i.bak -E 's|^NODE_ENV=.*|NODE_ENV=production|' .env
grep -q '^OPS_POSTGRES_URL=postgresql://petfix:petfix@ops-postgres' .env && \
  sed -i.bak 's|^OPS_POSTGRES_URL=.*|OPS_POSTGRES_URL=postgresql://petfix:petfix@ops-postgres:5432/petfix_ops|' .env || true
rm -f .env.bak
REMOTE

echo "==> VPS kurulum (docker + nginx + certbot)"
"${SSH[@]}" "cd '$APP_DIR' && sudo APP_DIR='$APP_DIR' OPS_DOMAIN='$DOMAIN' bash deploy/vps-setup.sh"

echo "==> Poll timer (systemd)"
"${SSH[@]}" bash -s <<'REMOTE'
set -euo pipefail
cat > /tmp/petfix-ops-poll.service <<'UNIT'
[Unit]
Description=PetFix Ops channel poll
After=docker.service

[Service]
Type=oneshot
WorkingDirectory=/opt/petfix/buybox-platform
ExecStart=/usr/bin/docker run --rm --network host -v /opt/petfix/buybox-platform:/app -w /app --env-file /opt/petfix/buybox-platform/.env -e OPS_POSTGRES_URL=postgresql://petfix:petfix@127.0.0.1:5433/petfix_ops node:22-alpine node scripts/ops-hub-poll.js
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
sudo mv /tmp/petfix-ops-poll.service /etc/systemd/system/
sudo mv /tmp/petfix-ops-poll.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now petfix-ops-poll.timer
REMOTE

echo ""
echo "Deploy tamam."
echo "  Health: https://${DOMAIN}/health"
echo "  Ops:    https://${DOMAIN}/ops/"
echo ""
echo "Sonraki adımlar:"
echo "  1. DNS A kaydı: ${DOMAIN} → ${VPS_HOST}"
echo "  2. npm run ops:verify-deploy -- https://${DOMAIN}"
echo "  3. YS portal webhook URL: https://${DOMAIN}/webhooks/v1/yemeksepeti/orders"
echo "  4. npm run ops:webhook-setup"
