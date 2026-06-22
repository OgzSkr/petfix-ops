#!/usr/bin/env bash
# API health watchdog — VPS cron ile çalıştırın (ör. */5 * * * *)
# Health yanıt vermezse petfix-prod-api container'ını yeniden başlatır.
set -euo pipefail

APP_DIR="${VPS_APP_DIR:-/opt/petfix/buybox-platform}"
HEALTH_URL="${OPS_HEALTH_URL:-http://127.0.0.1:8787/health}"
TIMEOUT_SEC="${OPS_HEALTH_TIMEOUT_SEC:-12}"
COMPOSE_FILE="${OPS_COMPOSE_FILE:-compose.prod.yml}"
ENV_FILE="${OPS_ENV_FILE:-.env.production}"
LOG_TAG="petfix-api-watchdog"

if curl -sf --max-time "$TIMEOUT_SEC" "$HEALTH_URL" | grep -q '"ok"[[:space:]]*:[[:space:]]*true'; then
  exit 0
fi

echo "$(date -Is) [$LOG_TAG] health failed — restarting api" >&2
cd "$APP_DIR"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" restart api
sleep 8
if curl -sf --max-time "$TIMEOUT_SEC" "$HEALTH_URL" | grep -q '"ok"[[:space:]]*:[[:space:]]*true'; then
  echo "$(date -Is) [$LOG_TAG] api recovered after restart" >&2
  exit 0
fi

echo "$(date -Is) [$LOG_TAG] api still unhealthy after restart" >&2
exit 1
