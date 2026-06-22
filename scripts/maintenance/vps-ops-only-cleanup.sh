#!/usr/bin/env bash
# VPS (DEPLOY_PROFILE=ops-only): marketplace/Buybox disk kalıntılarını temizler.
# PostgreSQL sipariş verisine dokunmaz.
#
#   bash scripts/maintenance/vps-ops-only-cleanup.sh --dry-run
#   bash scripts/maintenance/vps-ops-only-cleanup.sh
#   bash scripts/maintenance/vps-ops-only-cleanup.sh --purge-files
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-compose.prod.yml}"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="/tmp/petfix-data-backup-${STAMP}.tar.gz"

if ! grep -q '^DEPLOY_PROFILE=ops-only' "$ENV_FILE" 2>/dev/null; then
  echo "HATA: $ENV_FILE içinde DEPLOY_PROFILE=ops-only olmalı."
  echo "      Bu script yalnızca production VPS içindir; local'de ÇALIŞTIRMAYIN."
  exit 1
fi

run_node() {
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" run --rm --no-deps api node "$@"
}

echo "==> 1/5 data/ yedeği: $BACKUP"
tar -czf "$BACKUP" data/
echo "    Yedek boyutu: $(du -h "$BACKUP" | cut -f1)"

echo "==> 2/5 API durduruluyor"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" stop api

echo "==> 3/5 db.json marketplace temizliği"
ARGS=(scripts/maintenance/purge-marketplace-local-data.js)
for arg in "$@"; do
  ARGS+=("$arg")
done
run_node "${ARGS[@]}"

echo "==> 4/5 API başlatılıyor"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d api

echo "==> 5/5 Readiness"
for i in $(seq 1 20); do
  if curl -sf "http://127.0.0.1:8787/ready" | grep -q '"status"[[:space:]]*:[[:space:]]*"ready"'; then
    echo "ready ok"
    break
  fi
  if [[ $i -eq 20 ]]; then
    echo "readiness failed"
    exit 1
  fi
  sleep 2
done

echo ""
echo "Temizlik tamam. Yedek: $BACKUP"
echo "Geri almak için: tar -xzf $BACKUP -C $ROOT"
