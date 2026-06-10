#!/usr/bin/env bash
# Cloudflare quick tunnel — YS webhook geçici public URL
set -euo pipefail
ROOT="${PETFIX_OPS_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
SUPPORT="$HOME/Library/Application Support/PetFix"
URL_FILE="$SUPPORT/tunnel-url.txt"
LOG="$HOME/Library/Logs/petfix-ops-tunnel.log"
PORT="${OPS_PORT:-8787}"
CF="$ROOT/bin/cloudflared"

mkdir -p "$SUPPORT"

if [[ ! -x "$CF" ]]; then
  bash "$ROOT/scripts/ops-tunnel.sh" >>"$LOG" 2>&1 &
  exit 0
fi

if pgrep -f "cloudflared tunnel --url http://127.0.0.1:$PORT" >/dev/null 2>&1; then
  exit 0
fi

exec >>"$LOG" 2>&1
echo "==> $(date -u +%Y-%m-%dT%H:%M:%SZ) tunnel başlatılıyor"

"$CF" tunnel --url "http://127.0.0.1:$PORT" 2>&1 | while IFS= read -r line; do
  echo "$line"
  if [[ "$line" =~ https://[a-z0-9-]+\.trycloudflare\.com ]]; then
    url="${BASH_REMATCH[0]}"
    echo "$url" > "$URL_FILE"
    echo "WEBHOOK=${url}/webhooks/v1/yemeksepeti/orders" >> "$LOG"
  fi
done
