#!/usr/bin/env bash
# PetFix Production VPS kurulum — idempotent, tekrar çalıştırılabilir
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/petfix/buybox-platform}"
DEPLOY_USER="${DEPLOY_USER:-petfix}"
DOMAIN="${OPS_DOMAIN:-api.petfix.com.tr}"
EMAIL="${OPS_LETSENCRYPT_EMAIL:-ops@petfix.com.tr}"
ENV_FILE="${ENV_FILE:-.env.production}"

echo "==> PetFix Production VPS setup"
echo "    APP_DIR=$APP_DIR"
echo "    DOMAIN=$DOMAIN"
echo "    DEPLOY_USER=$DEPLOY_USER"

if [[ $EUID -ne 0 ]]; then
  echo "Root olarak çalıştırın: sudo bash deploy/vps-setup.sh"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq docker.io docker-compose-plugin nginx certbot python3-certbot-nginx curl git ufw

systemctl enable docker nginx
systemctl start docker

if ! id "$DEPLOY_USER" &>/dev/null; then
  useradd -m -s /bin/bash "$DEPLOY_USER"
  usermod -aG docker "$DEPLOY_USER"
fi

mkdir -p /var/log/petfix "$APP_DIR"
chown -R "$DEPLOY_USER:$DEPLOY_USER" /var/log/petfix

echo "==> Firewall (ufw)"
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

if [[ ! -d "$APP_DIR" ]]; then
  echo "HATA: $APP_DIR bulunamadı — önce repoyu clone edin."
  exit 1
fi

cd "$APP_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "HATA: $ENV_FILE eksik — cp .env.production.example $ENV_FILE"
  exit 1
fi

echo "==> Production Docker stack"
docker compose -f compose.prod.yml --env-file "$ENV_FILE" up -d --build

echo "==> nginx"
cp deploy/nginx-api.petfix.com.tr.conf "/etc/nginx/sites-available/${DOMAIN}.conf"
ln -sf "/etc/nginx/sites-available/${DOMAIN}.conf" "/etc/nginx/sites-enabled/${DOMAIN}.conf"
rm -f /etc/nginx/sites-enabled/default
nginx -t

if [[ ! -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]]; then
  echo "==> TLS (Let's Encrypt)"
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" || {
    echo "Certbot başarısız — DNS A kaydının $DOMAIN → bu sunucuya işaret ettiğini doğrulayın."
    exit 1
  }
fi

systemctl reload nginx

echo "==> systemd — ops poll worker (opsiyonel)"
cat > /etc/systemd/system/petfix-ops-poll.service <<EOF
[Unit]
Description=PetFix Ops poll worker
After=docker.service
Requires=docker.service

[Service]
Type=simple
User=$DEPLOY_USER
WorkingDirectory=$APP_DIR
Environment=PETFIX_ENV_FILE=$ENV_FILE
ExecStart=/usr/bin/node scripts/ops-hub-poll.js
Restart=always
RestartSec=15

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable petfix-ops-poll.service
systemctl restart petfix-ops-poll.service || echo "Poll worker başlatılamadı — credentials kontrol edin"

echo "==> Verify"
sleep 5
curl -sf "http://127.0.0.1:8787/health" >/dev/null && echo "Local health OK"

echo ""
echo "Kurulum tamam."
echo "  Health:   https://${DOMAIN}/health"
echo "  Ready:    https://${DOMAIN}/ready"
echo "  Webhook:  https://${DOMAIN}/webhooks/v1/yemeksepeti/orders"
echo "  Deploy:   bash scripts/deploy-production.sh"
