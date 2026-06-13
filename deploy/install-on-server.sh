#!/usr/bin/env bash
# Розгортання Radio Vinnipeg Nights на сервері (Ubuntu/Debian).
# Запускати з кореня репозиторію на сервері: bash deploy/install-on-server.sh
set -euo pipefail

APP_DIR="/opt/radio-vinnipeg"

cd "$APP_DIR"

python3 -m venv .venv
.venv/bin/pip install -q -r requirements.txt

if [ ! -f .env ]; then
    cp .env.example .env
    echo "⚠️  Заповни /opt/radio-vinnipeg/.env (SECRET_KEY тощо) перед запуском."
fi

cd frontend
npm ci
npm run build
cd ..

sudo cp deploy/radio-vinnipeg.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable radio-vinnipeg
sudo systemctl restart radio-vinnipeg

sudo cp deploy/nginx-radio.conf /etc/nginx/sites-available/radio.munister.com.ua
sudo ln -sf /etc/nginx/sites-available/radio.munister.com.ua /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

echo "✅ Готово. Якщо DNS вже вказує на цей сервер, запусти:"
echo "   sudo certbot --nginx -d radio.munister.com.ua"
