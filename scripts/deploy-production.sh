#!/usr/bin/env bash
# Production deploy pipeline — VPS üzerinde çalıştırın
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-compose.prod.yml}"
BASE_URL="${BASE_URL:-https://api.petfix.com.tr}"

is_ops_only() {
  [[ "${DEPLOY_PROFILE:-}" == "ops-only" ]] || grep -q '^DEPLOY_PROFILE=ops-only' "$ENV_FILE" 2>/dev/null
}

run_node() {
  if command -v node >/dev/null 2>&1; then
    node "$@"
  else
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" run --rm --no-deps api node "$@"
  fi
}

echo "==> 1/8 Image build"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" build api

echo "==> 2/8 Tests"
if [[ "${SKIP_TESTS:-}" == "1" ]]; then
  echo "SKIP_TESTS=1 — testler atlandı"
elif command -v node >/dev/null 2>&1; then
  npm test
else
  echo "host node yok — testler container içinde çalıştırılıyor"
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" run --rm --no-deps api node --test test/*.test.js
fi

echo "==> 3/8 Production config validation"
NODE_ENV=production PETFIX_ENV_FILE="$ENV_FILE" run_node -e "
  import { readEnvFile } from './lib/env.js';
  import { validateProductionConfig } from './lib/production/validate-config.js';
  const env = await readEnvFile('$ENV_FILE');
  validateProductionConfig(env, process.env);
  console.log('config ok');
"

echo "==> 4/8 Migration"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" run --rm api node scripts/migrations/ops-hub-migrate.js

echo "==> 5/8 Service start/update"
mkdir -p data
touch data/runtime-secrets.env
chmod 600 data/runtime-secrets.env 2>/dev/null || true
if is_ops_only; then
  echo "    DEPLOY_PROFILE=ops-only — HzlMrktOps modu"
else
  echo "    UYARI: DEPLOY_PROFILE=ops-only önerilir (marketplace ayrı repoda)"
fi
# Container petfix uid=100 — host'ta da 100:101 olmalı (VPS'te genelde _apt:input)
chown -R 100:101 data 2>/dev/null || sudo chown -R 100:101 data 2>/dev/null || true
if id -u petfix >/dev/null 2>&1 && [[ "$(stat -c '%u' data 2>/dev/null || echo 0)" != "100" ]]; then
  chown -R 100:101 data 2>/dev/null || sudo chown -R 100:101 data 2>/dev/null || true
fi
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d

echo "==> 6/8 Readiness"
for i in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:8787/ready" | grep -q '"status"[[:space:]]*:[[:space:]]*"ready"'; then
    echo "ready ok"
    break
  fi
  if [[ $i -eq 30 ]]; then
    echo "readiness failed"
    exit 1
  fi
  sleep 2
done

echo "==> 7/8 Smoke test"
if command -v node >/dev/null 2>&1; then
  HOST=127.0.0.1 PORT=8787 PETFIX_ENV_FILE="$ENV_FILE" npm run smoke
else
  docker exec -e PETFIX_ENV_FILE=.env.production petfix-prod-api node scripts/dev/smoke-test.js
fi

echo "==> 8/8 External verify (optional)"
if [[ "${SKIP_EXTERNAL_VERIFY:-}" != "1" ]]; then
  verify_cmd=(node scripts/maintenance/ops-verify-deploy.js "$BASE_URL")
  if ! command -v node >/dev/null 2>&1; then
    verify_cmd=(docker exec -e PETFIX_ENV_FILE=.env.production petfix-prod-api node scripts/maintenance/ops-verify-deploy.js "$BASE_URL")
  fi
  "${verify_cmd[@]}" || {
    echo "External verify uyarısı — DNS/TLS henüz hazır olmayabilir (deploy devam etti)"
  }
fi

echo "Deploy başarılı"
