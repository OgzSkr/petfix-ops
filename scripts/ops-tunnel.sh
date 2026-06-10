#!/usr/bin/env bash
# Geçici public URL — YS webhook test ve partner portal kaydı için.
# Kalıcı production: api.petfix.com.tr (VPS + DNS gerekli)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CF="$ROOT/bin/cloudflared"
PORT="${OPS_PORT:-8787}"

if [[ ! -x "$CF" ]]; then
  ARCH=$(uname -m)
  case "$ARCH" in
    arm64) ASSET=cloudflared-darwin-arm64.tgz ;;
    x86_64) ASSET=cloudflared-darwin-amd64.tgz ;;
    *) echo "Desteklenmeyen mimari: $ARCH"; exit 1 ;;
  esac
  mkdir -p "$ROOT/bin"
  curl -fsSL -o /tmp/cloudflared.tgz "https://github.com/cloudflare/cloudflared/releases/latest/download/$ASSET"
  tar -xzf /tmp/cloudflared.tgz -C "$ROOT/bin" cloudflared
  chmod +x "$CF"
fi

echo "Tunnel başlatılıyor → http://127.0.0.1:$PORT"
echo "Webhook URL: https://<subdomain>.trycloudflare.com/webhooks/v1/yemeksepeti/orders"
exec "$CF" tunnel --url "http://127.0.0.1:$PORT"
