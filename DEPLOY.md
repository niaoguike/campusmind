# CampusMind first deployment (Ubuntu ECS)

Optional per-user LiteLLM gateway deployment: [gateway guide](deploy/llm-gateway/README.md). Use its Compose overlay commands to enable the gateway; the base commands below keep direct DeepSeek access.

This first deployment uses the ECS public IP over HTTP. Add a domain and HTTPS only after the IP deployment works.

## 1. Security group

Allow inbound TCP 80 from the public Internet. Keep TCP 22 restricted to your own public IP. Do not expose 3001, 8080, SQLite, or Redis.

## 2. First server setup

```bash
sudo mkdir -p /opt/campusmind
sudo chown -R $USER:$USER /opt/campusmind
cd /opt
git clone https://gitee.com/wensr_517/campusmind.git campusmind
cd /opt/campusmind
cp server/.env.example server/.env
nano server/.env
```

In `server/.env`, replace both placeholder secrets with different long random values. Do not put a student API key in this file.

```bash
chmod +x deploy/server-setup.sh
./deploy/server-setup.sh
```

Then visit `http://123.56.248.129`.

## 3. Update later

```bash
cd /opt/campusmind
git pull
docker compose up -d --build
```

## 4. Check and troubleshoot

```bash
docker compose ps
docker compose logs -f api
docker compose logs -f web
curl http://127.0.0.1:3001/api/health
sudo nginx -t
```

The SQLite database is persisted at `/opt/campusmind/data/data.db`. Back up that file regularly before updating the server.
