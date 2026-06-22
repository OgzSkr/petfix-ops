#!/usr/bin/env bash
set -euo pipefail

: "${VPS_HOST:?VPS_HOST gerekli (örn. 104.247.163.98)}"
VPS_USER="${VPS_USER:-root}"
VPS_SSH_KEY="${VPS_SSH_KEY:-$HOME/.ssh/petfix_ops_deploy}"
APP_DIR="${VPS_APP_DIR:-/opt/petfix/buybox-platform}"
COMPOSE_FILE="${COMPOSE_FILE:-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"

NEW_TOKEN="${1:-$(openssl rand -hex 24)}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SSH=(ssh -i "$VPS_SSH_KEY" -o StrictHostKeyChecking=accept-new "${VPS_USER}@${VPS_HOST}")

echo "==> Mağaza token yenileniyor → ${VPS_HOST}"
"${SSH[@]}" bash -s <<EOF
set -euo pipefail
cd "${APP_DIR}"
if grep -q '^PLATFORM_API_TOKEN=' "${ENV_FILE}"; then
  sed -i "s|^PLATFORM_API_TOKEN=.*|PLATFORM_API_TOKEN=${NEW_TOKEN}|" "${ENV_FILE}"
else
  echo "PLATFORM_API_TOKEN=${NEW_TOKEN}" >> "${ENV_FILE}"
fi
docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" up -d api
for i in \$(seq 1 30); do
  if curl -sf http://127.0.0.1:8787/ready | grep -q '"status"[[:space:]]*:[[:space:]]*"ready"'; then
    break
  fi
  sleep 2
done
EOF

if curl -sf "https://api.petfix.com.tr/ops/v1/config" -H "Authorization: Bearer ${NEW_TOKEN}" | grep -q '"ok":true'; then
  echo "Token doğrulandı."
else
  echo "UYARI: API yeni token ile yanıt vermedi — container loglarını kontrol edin." >&2
  exit 1
fi

if [[ "${RUN_HOTFIX_AFTER:-1}" == "1" ]] && [[ -x "${ROOT:-}/scripts/ops-vps-hotfix.sh" ]]; then
  echo "==> Hotfix yeniden uygulanıyor (compose recreate sonrası)"
  OPS_API_TOKEN="${NEW_TOKEN}" VPS_HOST="${VPS_HOST}" VPS_SSH_KEY="${VPS_SSH_KEY}" \
    "${ROOT}/scripts/ops-vps-hotfix.sh" || true
fi

echo ""
echo "Yeni mağaza token (personel uygulamasına girin):"
echo "${NEW_TOKEN}"
echo ""
echo "Eski token (1234) artık geçersiz."
