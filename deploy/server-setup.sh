#!/usr/bin/env bash
set -euo pipefail

APP_DIR=/opt/campusmind
cd "$APP_DIR"

mkdir -p data
touch data/data.db
chmod 600 data/data.db

if [ ! -f server/.env ]; then
  cp server/.env.example server/.env
  echo "Created server/.env. Edit its JWT_SECRET and LLM_CONFIG_ENCRYPTION_KEY before continuing."
  exit 1
fi

sudo cp deploy/nginx/campusmind.conf /etc/nginx/sites-available/campusmind
sudo ln -sfn /etc/nginx/sites-available/campusmind /etc/nginx/sites-enabled/campusmind
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx

docker compose up -d --build
docker compose ps
echo "CampusMind is running. Open http://$(curl -4 -s ifconfig.me || hostname -I | awk '{print $1}')"
