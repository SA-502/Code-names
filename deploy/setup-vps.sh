#!/usr/bin/env bash
# تجهيز Hostinger VPS (Ubuntu 22.04/24.04) لتشغيل لعبة الشفرة — شغّله كـ root
#
#   بدون دومين (تفتح اللعبة على IP السيرفر):
#     bash setup-vps.sh
#   مع دومين (+ HTTPS تلقائي):
#     bash setup-vps.sh example.com
set -euo pipefail

DOMAIN="${1:-}"
REPO="${REPO:-https://github.com/SA-502/Code-names.git}"
BRANCH="${BRANCH:-main}"
APP_DIR=/opt/shifra-repo
export DEBIAN_FRONTEND=noninteractive

echo "==> تثبيت الأدوات"
apt-get update -y
apt-get install -y curl git nginx ufw certbot python3-certbot-nginx

echo "==> تثبيت Node.js 22"
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1)" != "v22" ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
command -v pm2 >/dev/null || npm install -g pm2

echo "==> تنزيل الكود"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch origin "$BRANCH"
  git -C "$APP_DIR" checkout -B "$BRANCH" FETCH_HEAD
else
  git clone --branch "$BRANCH" --depth 1 "$REPO" "$APP_DIR"
fi
cd "$APP_DIR"
npm ci --omit=dev

echo "==> تشغيل اللعبة بـ PM2"
pm2 startOrReload ecosystem.config.cjs
pm2 save
pm2 startup systemd -u root --hp /root >/dev/null || true

echo "==> إعداد Nginx"
NAME="${DOMAIN:-_}"
[ -n "$DOMAIN" ] && NAME="$DOMAIN www.$DOMAIN"
sed "s/server_name .*;/server_name $NAME;/" deploy/nginx.conf > /etc/nginx/sites-available/shifra
ln -sf /etc/nginx/sites-available/shifra /etc/nginx/sites-enabled/shifra
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "==> الجدار الناري"
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable

if [ -n "$DOMAIN" ]; then
  echo "==> شهادة SSL (HTTPS)"
  certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect \
    || certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect \
    || echo "⚠️ ما قدرنا نطلع شهادة SSL — تأكد إن الدومين يأشر على IP السيرفر وأعد تشغيل السكربت"
  echo "✅ تم! افتح https://$DOMAIN"
else
  IP=$(curl -fsS https://api.ipify.org || hostname -I | awk '{print $1}')
  echo "✅ تم! افتح http://$IP"
fi
