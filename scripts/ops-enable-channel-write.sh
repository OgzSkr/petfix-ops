#!/usr/bin/env bash
set -euo pipefail

if [[ "${CONFIRM_LIVE_CHANNEL_WRITE:-}" != "yes" ]]; then
  echo "Getir/Uber'e gerçek onay gitmesini istiyorsanız:"
  echo "  CONFIRM_LIVE_CHANNEL_WRITE=yes VPS_HOST=... ./scripts/ops-enable-channel-write.sh"
  exit 1
fi

: "${VPS_HOST:?VPS_HOST gerekli}"
VPS_USER="${VPS_USER:-root}"
VPS_SSH_KEY="${VPS_SSH_KEY:-$HOME/.ssh/petfix_ops_deploy}"
APP_DIR="${VPS_APP_DIR:-/opt/petfix/buybox-platform}"
COMPOSE_FILE="${COMPOSE_FILE:-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"

SSH=(ssh -i "$VPS_SSH_KEY" -o StrictHostKeyChecking=accept-new "${VPS_USER}@${VPS_HOST}")

echo "==> FF_CHANNEL_STATUS_WRITE=true → ${VPS_HOST}"
"${SSH[@]}" bash -s <<EOF
set -euo pipefail
cd "${APP_DIR}"
if grep -q '^FF_CHANNEL_STATUS_WRITE=' "${ENV_FILE}"; then
  sed -i 's|^FF_CHANNEL_STATUS_WRITE=.*|FF_CHANNEL_STATUS_WRITE=true|' "${ENV_FILE}"
else
  echo 'FF_CHANNEL_STATUS_WRITE=true' >> "${ENV_FILE}"
fi
docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" up -d api
sleep 4
EOF

echo "Kanal yazması açıldı. İlk test siparişinde Kabul → Getir/Uber API çağrılır."
