#!/usr/bin/env bash
set -euo pipefail

: "${VPS_HOST:?VPS_HOST gerekli}"
: "${FCM_SERVER_KEY:?FCM_SERVER_KEY gerekli (Firebase Legacy server key)}"
VPS_USER="${VPS_USER:-root}"
VPS_SSH_KEY="${VPS_SSH_KEY:-$HOME/.ssh/petfix_ops_deploy}"
APP_DIR="${VPS_APP_DIR:-/opt/petfix/buybox-platform}"
COMPOSE_FILE="${COMPOSE_FILE:-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"

SSH=(ssh -i "$VPS_SSH_KEY" -o StrictHostKeyChecking=accept-new "${VPS_USER}@${VPS_HOST}")

echo "==> FCM server key ayarlanıyor → ${VPS_HOST}"
"${SSH[@]}" bash -s <<EOF
set -euo pipefail
cd "${APP_DIR}"
if grep -q '^FCM_SERVER_KEY=' "${ENV_FILE}"; then
  sed -i "s|^FCM_SERVER_KEY=.*|FCM_SERVER_KEY=${FCM_SERVER_KEY}|" "${ENV_FILE}"
else
  echo "FCM_SERVER_KEY=${FCM_SERVER_KEY}" >> "${ENV_FILE}"
fi
docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" up -d api
sleep 6
EOF

TOKEN="${OPS_API_TOKEN:-}"
if [[ -z "$TOKEN" ]]; then
  echo "OPS_API_TOKEN verilmedi — pushConfigured kontrolü atlandı."
  exit 0
fi

curl -sf "https://api.petfix.com.tr/ops/v1/config" -H "Authorization: Bearer ${TOKEN}" | python3 -m json.tool 2>/dev/null | grep -E 'pushConfigured|pollEnabled' || true
echo ""
echo "Push test: curl -X POST https://api.petfix.com.tr/ops/v1/notifications/test -H \"Authorization: Bearer TOKEN\" -H \"X-Staff-Name: Test\" -H \"X-Device-Name: Test\""
