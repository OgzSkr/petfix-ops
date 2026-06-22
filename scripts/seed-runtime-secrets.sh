#!/usr/bin/env bash
# Yerel .env Trendyol bilgilerini data/runtime-secrets.env dosyasına yazar (VPS/production).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SRC="${1:-.env}"
OUT="${2:-data/runtime-secrets.env}"

if [[ ! -f "$SRC" ]]; then
  echo "HATA: $SRC bulunamadı"
  exit 1
fi

read_env() {
  local key="$1"
  local default="${2:-}"
  local line
  line="$(grep -E "^${key}=" "$SRC" 2>/dev/null | tail -1 || true)"
  if [[ -z "$line" ]]; then
    printf '%s' "$default"
    return
  fi
  printf '%s' "${line#*=}"
}

SELLER_ID="$(read_env TRENDYOL_SELLER_ID)"
API_KEY="$(read_env TRENDYOL_API_KEY)"
API_SECRET="$(read_env TRENDYOL_API_SECRET)"

if [[ -z "$SELLER_ID" || -z "$API_KEY" || -z "$API_SECRET" ]]; then
  echo "HATA: $SRC içinde TRENDYOL_SELLER_ID / TRENDYOL_API_KEY / TRENDYOL_API_SECRET gerekli"
  exit 1
fi

LIVE_SECRET="$(read_env LIVE_BUYBOX_WEBHOOK_SECRET)"
if [[ -z "$LIVE_SECRET" && -f ../live-buybox-worker/.env ]]; then
  LIVE_SECRET="$(grep -E '^LIVE_BUYBOX_WEBHOOK_SECRET=' ../live-buybox-worker/.env 2>/dev/null | tail -1 | cut -d= -f2- || true)"
fi
if [[ -z "$LIVE_SECRET" ]]; then
  LIVE_SECRET="$(openssl rand -hex 32)"
fi

mkdir -p "$(dirname "$OUT")"
touch "$OUT"
chmod 600 "$OUT" 2>/dev/null || true

upsert() {
  local key="$1"
  local value="$2"
  local tmp
  tmp="$(mktemp)"
  if grep -q "^${key}=" "$OUT" 2>/dev/null; then
    grep -v "^${key}=" "$OUT" > "$tmp" || true
    printf '%s=%s\n' "$key" "$value" >> "$tmp"
    mv "$tmp" "$OUT"
  else
    printf '\n%s=%s\n' "$key" "$value" >> "$OUT"
  fi
}

upsert TRENDYOL_SELLER_ID "$SELLER_ID"
upsert TRENDYOL_API_KEY "$API_KEY"
upsert TRENDYOL_API_SECRET "$API_SECRET"
upsert TRENDYOL_INTEGRATOR_NAME "$(read_env TRENDYOL_INTEGRATOR_NAME SelfIntegration)"
upsert TRENDYOL_ENVIRONMENT "$(read_env TRENDYOL_ENVIRONMENT PROD)"
upsert LIVE_BUYBOX_WEBHOOK_SECRET "$LIVE_SECRET"
upsert PLATFORM_WEBHOOK_URL "http://api:8787/api/live-buybox"
upsert POLL_INTERVAL_MS "$(read_env POLL_INTERVAL_MS 2000)"
upsert BATCH_SIZE "$(read_env BATCH_SIZE 10)"

echo "==> $OUT güncellendi (Trendyol + BuyBox worker)"
