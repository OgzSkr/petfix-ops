#!/usr/bin/env bash
set -euo pipefail
ROOT="${PETFIX_OPS_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$ROOT"
export PATH="/usr/local/bin:/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH"

if ! docker info >/dev/null 2>&1; then
  open -a Docker 2>/dev/null || true
  exit 0
fi

docker run --rm \
  --network host \
  -v "$ROOT:/app" \
  -w /app \
  --env-file "$ROOT/.env" \
  -e OPS_POSTGRES_URL="${OPS_POSTGRES_URL:-postgresql://petfix:petfix@127.0.0.1:5433/petfix_ops}" \
  node:22-alpine \
  node scripts/ops-hub-poll.js --ys-days 1 --tgo-limit 30 >> "$HOME/Library/Logs/petfix-ops-poll.log" 2>&1
