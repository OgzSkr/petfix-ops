#!/usr/bin/env bash
set -euo pipefail

: "${VPS_HOST:?VPS_HOST gerekli}"
: "${FCM_SERVICE_ACCOUNT_FILE:?FCM_SERVICE_ACCOUNT_FILE gerekli (Firebase service account JSON)}"
VPS_USER="${VPS_USER:-root}"
VPS_SSH_KEY="${VPS_SSH_KEY:-$HOME/.ssh/petfix_ops_deploy}"
APP_DIR="${VPS_APP_DIR:-/opt/petfix/buybox-platform}"
REMOTE_PATH="${VPS_FCM_SA_PATH:-/opt/petfix/secrets/fcm-service-account.json}"
COMPOSE_FILE="${COMPOSE_FILE:-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"

if ! python3 -c "import json; json.load(open('${FCM_SERVICE_ACCOUNT_FILE}'))" 2>/dev/null; then
  echo "Geçersiz JSON: ${FCM_SERVICE_ACCOUNT_FILE}" >&2
  exit 1
fi

SSH=(ssh -i "$VPS_SSH_KEY" -o StrictHostKeyChecking=accept-new "${VPS_USER}@${VPS_HOST}")
SCP=(scp -i "$VPS_SSH_KEY" -o StrictHostKeyChecking=accept-new)

echo "==> FCM service account → ${VPS_HOST}:${REMOTE_PATH}"
"${SSH[@]}" "mkdir -p $(dirname "${REMOTE_PATH}") && chmod 700 $(dirname "${REMOTE_PATH}")"
"${SCP[@]}" "${FCM_SERVICE_ACCOUNT_FILE}" "${VPS_USER}@${VPS_HOST}:${REMOTE_PATH}"
"${SSH[@]}" "chmod 600 ${REMOTE_PATH}"

"${SSH[@]}" bash -s <<EOF
set -euo pipefail
cd "${APP_DIR}"
if grep -q '^FCM_SERVICE_ACCOUNT_PATH=' "${ENV_FILE}"; then
  sed -i "s|^FCM_SERVICE_ACCOUNT_PATH=.*|FCM_SERVICE_ACCOUNT_PATH=${REMOTE_PATH}|" "${ENV_FILE}"
else
  echo "FCM_SERVICE_ACCOUNT_PATH=${REMOTE_PATH}" >> "${ENV_FILE}"
fi
docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" up -d api
for i in \$(seq 1 30); do
  curl -sf http://127.0.0.1:8787/ready | grep -q '"status"[[:space:]]*:[[:space:]]*"ready"' && break
  sleep 2
done
EOF

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -x "${ROOT}/scripts/ops-vps-hotfix.sh" ]]; then
  OPS_API_TOKEN="${OPS_API_TOKEN:-}" VPS_HOST="${VPS_HOST}" VPS_SSH_KEY="${VPS_SSH_KEY}" \
    "${ROOT}/scripts/ops-vps-hotfix.sh" || true
fi

echo "FCM service account yüklendi."
