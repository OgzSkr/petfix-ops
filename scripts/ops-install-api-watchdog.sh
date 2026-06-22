#!/usr/bin/env bash
# VPS'te API watchdog cron kaydı (root veya deploy kullanıcısı).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="${VPS_APP_DIR:-/opt/petfix/buybox-platform}"
CRON_LINE="*/5 * * * * cd ${APP_DIR} && bash scripts/ops-api-watchdog.sh >> /var/log/petfix-api-watchdog.log 2>&1"

chmod +x "${ROOT}/scripts/ops-api-watchdog.sh"

if crontab -l 2>/dev/null | grep -q 'ops-api-watchdog.sh'; then
  echo "Watchdog cron zaten kayıtlı."
else
  (crontab -l 2>/dev/null; echo "$CRON_LINE") | crontab -
  echo "Watchdog cron eklendi: her 5 dakikada health kontrolü"
fi

echo "Log: /var/log/petfix-api-watchdog.log"
