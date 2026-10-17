#!/usr/bin/env bash
set -euo pipefail

APP_DIR=/opt/campusmind
cd "$APP_DIR"

mkdir -p data/backups

if [ ! -f server/.env ]; then
  cp server/.env.example server/.env
  echo "Created server/.env. Edit its JWT_SECRET and LLM_CONFIG_ENCRYPTION_KEY before continuing."
  exit 1
fi
if [ ! -f deploy/postgres/.env ]; then
  cp deploy/postgres/.env.example deploy/postgres/.env
  echo "Created deploy/postgres/.env. Set POSTGRES_PASSWORD, then rerun this script."
  exit 1
fi
if [ ! -f deploy/redis/.env ]; then
  cp deploy/redis/.env.example deploy/redis/.env
  echo "Created deploy/redis/.env. Set REDIS_PASSWORD, then rerun this script."
  exit 1
fi

sudo cp deploy/nginx/campusmind.conf /etc/nginx/sites-available/campusmind
sudo ln -sfn /etc/nginx/sites-available/campusmind /etc/nginx/sites-enabled/campusmind
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx

docker compose --env-file deploy/postgres/.env --env-file deploy/redis/.env up -d --build
docker compose --env-file deploy/postgres/.env --env-file deploy/redis/.env ps
echo "CampusMind is running. Open http://$(curl -4 -s ifconfig.me || hostname -I | awk '{print $1}')"
