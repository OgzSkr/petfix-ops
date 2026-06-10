#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

NODE_IMAGE="${OPS_NODE_IMAGE:-node:22-alpine}"
COMPOSE_ENV="${OPS_COMPOSE_ENV:-$ROOT/deploy/compose.env}"

echo "==> PetFix Ops Hub bootstrap"

if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon kapalı — Docker Desktop başlatılıyor..."
  open -a Docker 2>/dev/null || true
  for i in $(seq 1 30); do
    docker info >/dev/null 2>&1 && break
    sleep 2
  done
  docker info >/dev/null 2>&1 || {
    echo "Docker başlatılamadı."
    exit 1
  }
fi

echo "==> npm install (container)"
docker run --rm \
  -v "$ROOT:/app" \
  -w /app \
  "$NODE_IMAGE" \
  sh -c "npm install --omit=dev"

echo "==> PostgreSQL"
docker compose --env-file "$COMPOSE_ENV" -f docker-compose.ops.yml up -d

echo "==> postgres hazır bekleniyor"
for i in $(seq 1 30); do
  if docker exec petfix-ops-postgres pg_isready -U petfix -d petfix_ops >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "==> migrate"
docker run --rm \
  --network host \
  -v "$ROOT:/app" \
  -w /app \
  --env-file "$ROOT/.env" \
  -e OPS_POSTGRES_URL=postgresql://petfix:petfix@127.0.0.1:5433/petfix_ops \
  "$NODE_IMAGE" \
  node scripts/ops-hub-migrate.js

echo "==> seed integrations from .env (optional)"
docker run --rm \
  --network host \
  -v "$ROOT:/app" \
  -w /app \
  --env-file "$ROOT/.env" \
  -e OPS_POSTGRES_URL=postgresql://petfix:petfix@127.0.0.1:5433/petfix_ops \
  "$NODE_IMAGE" \
  node scripts/ops-hub-seed-integrations.js 2>/dev/null || true

echo "==> API stack"
docker compose --env-file "$COMPOSE_ENV" -f docker-compose.ops-api.yml up -d --build

echo "==> health"
for i in $(seq 1 20); do
  if curl -sf "http://127.0.0.1:8787/health" >/dev/null; then
    curl -s "http://127.0.0.1:8787/health"
    echo
    curl -s "http://127.0.0.1:8787/ready"
    echo
    echo "Bootstrap tamam: http://127.0.0.1:8787/ops/"
    exit 0
  fi
  sleep 2
done

echo "API henüz hazır değil — docker logs petfix-ops-api"
exit 1
