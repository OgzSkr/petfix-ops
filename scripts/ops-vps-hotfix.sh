#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
: "${VPS_HOST:?VPS_HOST gerekli}"
VPS_USER="${VPS_USER:-root}"
VPS_SSH_KEY="${VPS_SSH_KEY:-$HOME/.ssh/petfix_ops_deploy}"
APP_DIR="${VPS_APP_DIR:-/opt/petfix/buybox-platform}"
CONTAINER="${OPS_CONTAINER:-petfix-prod-api}"

SSH=(ssh -i "$VPS_SSH_KEY" -o StrictHostKeyChecking=accept-new "${VPS_USER}@${VPS_HOST}")
RSYNC=(rsync -az -e "ssh -i $VPS_SSH_KEY -o StrictHostKeyChecking=accept-new")

echo "==> Ops hotfix → ${VPS_HOST}"
"${RSYNC[@]}" "$ROOT/lib/ops-hub/" "${VPS_USER}@${VPS_HOST}:${APP_DIR}/lib/ops-hub/"
for f in lib/platform/services/ops-poll-sync.js scripts/ops-hub-poll.js; do
  "${RSYNC[@]}" "$ROOT/$f" "${VPS_USER}@${VPS_HOST}:${APP_DIR}/$f"
done

"${SSH[@]}" "docker cp ${APP_DIR}/lib/ops-hub ${CONTAINER}:/app/lib/ && \
  docker cp ${APP_DIR}/lib/platform/services/ops-poll-sync.js ${CONTAINER}:/app/lib/platform/services/ops-poll-sync.js && \
  docker cp ${APP_DIR}/scripts/ops-hub-poll.js ${CONTAINER}:/app/scripts/ops-hub-poll.js && \
  docker restart ${CONTAINER}"

sleep 8
TOKEN="${OPS_API_TOKEN:-1234}"
curl -sf "https://${OPS_DOMAIN:-api.petfix.com.tr}/ops/v1/config" -H "Authorization: Bearer ${TOKEN}" | head -c 280
echo ""
echo "Hotfix tamam."
