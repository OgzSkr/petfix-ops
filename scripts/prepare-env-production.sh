#!/usr/bin/env bash
# Yerel .env → .env.production (VPS deploy öncesi)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SRC="${1:-.env}"
OUT="${2:-.env.production}"

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

POSTGRES_PASSWORD="$(read_env POSTGRES_PASSWORD)"
if [[ -z "$POSTGRES_PASSWORD" || "$POSTGRES_PASSWORD" == DEGISTIR* ]]; then
  POSTGRES_PASSWORD="$(openssl rand -hex 24)"
fi

PLATFORM_API_TOKEN="$(read_env PLATFORM_API_TOKEN)"
PANEL_ALLOW_SIMPLE_TOKEN=false
if [[ -z "$PLATFORM_API_TOKEN" ]]; then
  PLATFORM_API_TOKEN="$(openssl rand -hex 32)"
elif [[ ${#PLATFORM_API_TOKEN} -lt 24 ]]; then
  PANEL_ALLOW_SIMPLE_TOKEN=true
fi

YS_SECRET="$(read_env YEMEKSEPETI_WEBHOOK_SECRET)"
if [[ -z "$YS_SECRET" ]]; then
  YS_SECRET="$(openssl rand -hex 32)"
fi
GETIR_SHOP="$(read_env GETIR_SHOP_ID)"
GETIR_WH="$(read_env GETIR_WEBHOOK_SECRET)"
if [[ -z "$GETIR_WH" ]]; then
  GETIR_WH="$(openssl rand -hex 32)"
fi

LIVE_BB_SECRET="$(read_env LIVE_BUYBOX_WEBHOOK_SECRET)"
DEPLOY_PROFILE_VAL="$(read_env DEPLOY_PROFILE ops-only)"
if [[ -z "$LIVE_BB_SECRET" && "$DEPLOY_PROFILE_VAL" != "ops-only" ]]; then
  LIVE_BB_SECRET="$(openssl rand -hex 32)"
fi

cat > "$OUT" <<EOF
# PetFix Production — otomatik üretildi: bash scripts/prepare-env-production.sh
DEPLOY_PROFILE=${DEPLOY_PROFILE_VAL}
NODE_ENV=production
HOST=0.0.0.0
PORT=8787

AUTH_REQUIRED=true
AUTH_ALLOW_INSECURE=false
PLATFORM_API_TOKEN=${PLATFORM_API_TOKEN}
PANEL_ALLOW_SIMPLE_TOKEN=${PANEL_ALLOW_SIMPLE_TOKEN}

POSTGRES_USER=petfix
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
POSTGRES_DB=petfix_ops

OPS_POSTGRES_URL=postgresql://petfix:${POSTGRES_PASSWORD}@postgres:5432/petfix_ops
OPS_PUBLIC_API_BASE_URL=https://api.petfix.com.tr
OPS_SHADOW_MODE_DEFAULT=true

YEMEKSEPETI_WEBHOOK_SECRET=${YS_SECRET}
WEBHOOK_VERIFY_DISABLED=false

YEMEKSEPETI_CLIENT_ID=$(read_env YEMEKSEPETI_CLIENT_ID)
YEMEKSEPETI_CLIENT_SECRET=$(read_env YEMEKSEPETI_CLIENT_SECRET)
YEMEKSEPETI_VENDOR_ID=$(read_env YEMEKSEPETI_VENDOR_ID)
YEMEKSEPETI_CHAIN_ID=$(read_env YEMEKSEPETI_CHAIN_ID)
YEMEKSEPETI_STORE_ID=$(read_env YEMEKSEPETI_STORE_ID)
YEMEKSEPETI_EXTERNAL_PARTNER_CONFIG_ID=$(read_env YEMEKSEPETI_EXTERNAL_PARTNER_CONFIG_ID)
YEMEKSEPETI_VENDOR_IDS=$(read_env YEMEKSEPETI_VENDOR_IDS)

GETIR_SHOP_ID=${GETIR_SHOP:-64b7cadc8c8aa8a145b3c573}
GETIR_API_USERNAME=$(read_env GETIR_API_USERNAME)
GETIR_API_PASSWORD=$(read_env GETIR_API_PASSWORD)
GETIR_API_INITIAL_PASSWORD=$(read_env GETIR_API_INITIAL_PASSWORD)
GETIR_API_BASE_URL=$(read_env GETIR_API_BASE_URL https://locals-integration-api-gateway.artisan.getirapi.com)
GETIR_API_ENV=$(read_env GETIR_API_ENV prod)
GETIR_WEBHOOK_SECRET=${GETIR_WH}
GETIR_API_KEY=$(read_env GETIR_API_KEY)

UBER_EATS_SUPPLIER_ID=$(read_env UBER_EATS_SUPPLIER_ID)
UBER_EATS_API_KEY=$(read_env UBER_EATS_API_KEY)
UBER_EATS_API_SECRET=$(read_env UBER_EATS_API_SECRET)
UBER_EATS_STORE_ID=$(read_env UBER_EATS_STORE_ID)

FF_CHANNEL_STATUS_WRITE=false
FF_BENIMPOS_SALE_WRITE=false
FF_STOCK_PUSH=false

BENIMPOS_BRANCH_ID=$(read_env BENIMPOS_BRANCH_ID)
BENIMPOS_API_URL=$(read_env BENIMPOS_API_URL https://dev.benimpos.com/api)
BENIMPOS_API_KEY=$(read_env BENIMPOS_API_KEY)
BENIMPOS_SECRET_KEY=$(read_env BENIMPOS_SECRET_KEY)

PRODUCT_MATCHING_MODE=$(read_env PRODUCT_MATCHING_MODE hybrid)
PRODUCT_MATCHING_ENABLED=$(read_env PRODUCT_MATCHING_ENABLED true)
SQLITE_DUAL_WRITE=false
DB_READ_BACKEND=json
EOF

if [[ "$DEPLOY_PROFILE_VAL" != "ops-only" ]]; then
  cat >> "$OUT" <<EOF

# Trendyol BuyBox (yalnızca DEPLOY_PROFILE=full — local veya tam panel VPS)
TRENDYOL_SELLER_ID=$(read_env TRENDYOL_SELLER_ID)
TRENDYOL_API_KEY=$(read_env TRENDYOL_API_KEY)
TRENDYOL_API_SECRET=$(read_env TRENDYOL_API_SECRET)
TRENDYOL_INTEGRATOR_NAME=$(read_env TRENDYOL_INTEGRATOR_NAME SelfIntegration)
TRENDYOL_ENVIRONMENT=$(read_env TRENDYOL_ENVIRONMENT PROD)
LIVE_BUYBOX_WEBHOOK_SECRET=${LIVE_BB_SECRET}
PLATFORM_WEBHOOK_URL=http://api:8787/api/live-buybox
BUYBOX_POLL_INTERVAL_MS=$(read_env POLL_INTERVAL_MS 2000)
BUYBOX_BATCH_SIZE=$(read_env BATCH_SIZE 10)
EOF
fi

echo "==> $OUT oluşturuldu"
echo "    OPS_PUBLIC_API_BASE_URL=https://api.petfix.com.tr"
echo "    GETIR_WEBHOOK_SECRET=$(grep '^GETIR_WEBHOOK_SECRET=' "$OUT" | cut -d= -f2)"
echo ""
echo "Sonraki adım: VPS + DNS sonrası"
echo "  export VPS_HOST=SUNUCU_IP"
echo "  bash scripts/ops-deploy-vps.sh"
