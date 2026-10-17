# CampusMind deployment on Ubuntu ECS

The application uses one PostgreSQL database with pgvector for business data, messages, memory jobs, profiles and conversation summaries. Redis caches recent chat context and message lists; see [the cache guide](deploy/redis/README.md). The optional LiteLLM gateway has its own internal state database; see [the gateway guide](deploy/llm-gateway/README.md).

## First deployment

Clone the project into `/opt/campusmind`, install Docker Compose and Nginx, then create the configuration files without replacing existing ones:

```bash
cd /opt/campusmind
cp -n server/.env.example server/.env
cp -n deploy/postgres/.env.example deploy/postgres/.env
cp -n deploy/redis/.env.example deploy/redis/.env
```

Set `JWT_SECRET`, `LLM_CONFIG_ENCRYPTION_KEY`, `POSTGRES_PASSWORD` and `REDIS_PASSWORD`. Use generated hexadecimal database/cache passwords for the Compose URL templates. For an upgrade, preserve the existing application secrets so saved model keys remain decryptable. Configure the optional embedding service in `server/.env` if cross-session semantic memory is needed.

```bash
chmod +x deploy/server-setup.sh
./deploy/server-setup.sh
```

The setup script installs the supplied Nginx configuration and starts the API, web frontend, PostgreSQL and Redis. Allow public HTTP/HTTPS access through Nginx; keep database, cache, API and frontend container ports private. Add a domain and HTTPS before using real user credentials over the public Internet.

## Migrating an existing installation

Before starting the new API, stop writes to the old application. Back up the old SQLite database, uploads and original encryption configuration. Run the importer from a development installation with the SQLite import dependency installed, or migrate locally and transfer the PostgreSQL dump to the server.

See [the PostgreSQL migration guide](deploy/postgres/README.md) for the read-only backup, empty-target import, sequence reset and verification process. Do not initialize an empty application with demo seed data and then attempt to merge the old database into it; the importer deliberately rejects a populated target.

Uploads are stored separately from database rows. Copy existing uploads into the application's upload volume before making the new installation live. Verify registered accounts, resources, permissions and model-key decryption before switching traffic.

## Updates and checks

```bash
cd /opt/campusmind
git pull
docker compose --env-file deploy/postgres/.env --env-file deploy/redis/.env up -d --build
docker compose --env-file deploy/postgres/.env --env-file deploy/redis/.env ps
docker compose --env-file deploy/postgres/.env --env-file deploy/redis/.env logs -f api
curl http://127.0.0.1:3001/api/health
sudo nginx -t
```

The health endpoint reports `database: postgresql`. API startup applies versioned SQL migrations before accepting requests. Back up PostgreSQL and uploads before upgrading. Existing migration files are checksum-protected; add a new migration rather than editing an applied file.

## Backups and rollback

Use `pg_dump`/`pg_restore` for the `campusmind` database and separately back up the upload volume. Keep the matching `LLM_CONFIG_ENCRYPTION_KEY`. The import command retains its SQLite snapshot under `data/backups` and never removes the source file.

Rollback requires the previous code and its matching database snapshot; do not point the old SQLite application at PostgreSQL or expect new PostgreSQL writes to appear in the retained SQLite file.
