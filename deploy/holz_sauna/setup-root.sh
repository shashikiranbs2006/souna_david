#!/usr/bin/env bash
# One-time server setup for the David edition. Run as root on the Contabo server:
#
#   SHOP_HOST=sauna-configurator.klardatalabs.com \
#   ADMIN_HOST=admin.sauna-configurator.klardatalabs.com \
#   CERTBOT_EMAIL=you@example.com \
#   bash setup-root.sh
#
# It only creates things of its own and refuses to continue if a port it needs is taken:
#   - Docker container `holz-sauna-db` (Postgres 16, bound to 127.0.0.1:5433) and its own volume
#   - /opt/holz_sauna/.env and .env.deploy (generated secrets, mode 600, owner holz_sauna)
#   - /etc/systemd/system/holz-sauna.service
#   - /etc/nginx/sites-available/holz_sauna (+ symlink in sites-enabled)
#   - /etc/sudoers.d/holz_sauna (lets holz_sauna restart only its own service)
# Other projects' users, containers, services and nginx sites are not touched. nginx is
# tested (`nginx -t`) before it is reloaded; a reload does not interrupt the other sites.
set -euo pipefail

: "${SHOP_HOST:?set SHOP_HOST, e.g. sauna-configurator.klardatalabs.com}"
: "${ADMIN_HOST:?set ADMIN_HOST, e.g. admin.sauna-configurator.klardatalabs.com}"
APP_USER=holz_sauna
BASE=/opt/holz_sauna
PORT=3010
DB_PORT=5433
SERVICE=holz-sauna
DB_CONTAINER=holz-sauna-db

[ "$(id -u)" = 0 ] || { echo "run as root" >&2; exit 1; }
id "$APP_USER" >/dev/null 2>&1 || { echo "user $APP_USER does not exist" >&2; exit 1; }
[ -d "$BASE" ] || { echo "$BASE does not exist" >&2; exit 1; }
command -v docker >/dev/null || { echo "docker is not installed" >&2; exit 1; }
command -v nginx >/dev/null || { echo "nginx is not installed" >&2; exit 1; }

port_taken() { ss -Hltn "sport = :$1" | grep -q .; }
if ! docker ps -a --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
  port_taken "$DB_PORT" && { echo "port $DB_PORT is already in use" >&2; exit 1; }
fi
if ! systemctl is-active --quiet "$SERVICE"; then
  port_taken "$PORT" && { echo "port $PORT is already in use" >&2; exit 1; }
fi

rand() { openssl rand -hex "$1"; }

# ---- secrets (kept if they already exist) ------------------------------------------------
if [ ! -f "$BASE/.env" ]; then
  DB_SUPER_PW=$(rand 24)
  DB_API_PW=$(rand 24)
  umask 077
  cat > "$BASE/.env.deploy" <<ENV
DATABASE_URL=postgres://sauna:${DB_SUPER_PW}@127.0.0.1:${DB_PORT}/sauna
API_DB_PASSWORD=${DB_API_PW}
SHOP_HOST=${SHOP_HOST}
ADMIN_HOST=${ADMIN_HOST}
ENV
  cat > "$BASE/.env" <<ENV
NODE_ENV=production
PORT=${PORT}
API_DATABASE_URL=postgres://sauna_api:${DB_API_PW}@127.0.0.1:${DB_PORT}/sauna
PLATFORM_DOMAIN=${SHOP_HOST}
ADMIN_HOST=${ADMIN_HOST}
SINGLE_SHOP=holzsauna
PUBLIC_SCHEME=https
COOKIE_SECURE=true
TRUST_X_TENANT_HOST=true
APP_SECRET=$(rand 32)
ORIGIN_SECRET=$(rand 24)
ADAPTERS=local
STAFF_MFA=REQUIRED
LOCAL_IDP_JWT_SECRET=$(rand 32)
LOCAL_ASSET_SIGNING_SECRET=$(rand 32)
LOCAL_UPLOAD_SIGNING_SECRET=$(rand 32)
LOCAL_OBJECTS_DIR=${BASE}/data/objects
LOCAL_ASSET_URL_SCHEME=https
LOG_LEVEL=info
ENV
  chown "$APP_USER:$APP_USER" "$BASE/.env" "$BASE/.env.deploy"
  chmod 600 "$BASE/.env" "$BASE/.env.deploy"
  umask 022
  echo "generated $BASE/.env and $BASE/.env.deploy"
fi
install -d -o "$APP_USER" -g "$APP_USER" -m 750 "$BASE/data" "$BASE/data/objects"
DB_SUPER_PW=$(grep '^DATABASE_URL=' "$BASE/.env.deploy" | sed -E 's#.*://sauna:([^@]+)@.*#\1#')
ORIGIN_SECRET=$(grep '^ORIGIN_SECRET=' "$BASE/.env" | cut -d= -f2-)

# ---- Postgres (own container, own volume, localhost only) --------------------------------
if ! docker ps -a --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
  docker run -d --name "$DB_CONTAINER" --restart unless-stopped \
    -e POSTGRES_USER=sauna -e POSTGRES_PASSWORD="$DB_SUPER_PW" -e POSTGRES_DB=sauna \
    -p "127.0.0.1:${DB_PORT}:5432" -v holz_sauna_pgdata:/var/lib/postgresql/data \
    postgres:16 >/dev/null
  echo "started container $DB_CONTAINER"
else
  docker start "$DB_CONTAINER" >/dev/null 2>&1 || true
fi
for _ in $(seq 1 30); do
  docker exec "$DB_CONTAINER" pg_isready -U sauna >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$DB_CONTAINER" pg_isready -U sauna >/dev/null

# ---- systemd service ----------------------------------------------------------------------
cat > "/etc/systemd/system/${SERVICE}.service" <<UNIT
[Unit]
Description=SaunaKlar David edition (Holzsauna)
After=network.target docker.service
Wants=docker.service

[Service]
User=${APP_USER}
WorkingDirectory=${BASE}/app
EnvironmentFile=${BASE}/.env
ExecStart=${BASE}/node/bin/node services/api/dist/local.js
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null 2>&1

# holz_sauna may restart only this one service.
cat > /etc/sudoers.d/holz_sauna <<SUDO
${APP_USER} ALL=(root) NOPASSWD: /usr/bin/systemctl restart ${SERVICE}, /usr/bin/systemctl start ${SERVICE}, /usr/bin/systemctl status ${SERVICE}
SUDO
chmod 440 /etc/sudoers.d/holz_sauna
visudo -cf /etc/sudoers.d/holz_sauna >/dev/null

# ---- nginx site (new file; the others stay as they are) -----------------------------------
SITE=/etc/nginx/sites-available/holz_sauna
cat > "$SITE" <<NGINX
# SaunaKlar David edition. Generated by deploy/holz_sauna/setup-root.sh.
server {
    listen 80;
    listen [::]:80;
    server_name ${SHOP_HOST} ${ADMIN_HOST};

    client_max_body_size 55m;

    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header x-tenant-host \$host;
        proxy_set_header x-origin-secret ${ORIGIN_SECRET};
        proxy_read_timeout 60s;
    }
}
NGINX
chmod 640 "$SITE"
ln -sfn "$SITE" /etc/nginx/sites-enabled/holz_sauna
nginx -t
systemctl reload nginx
echo "nginx site added and reloaded"

# ---- HTTPS (needs both DNS records pointing at this server) -------------------------------
if command -v certbot >/dev/null; then
  if [ -n "${CERTBOT_EMAIL:-}" ]; then
    certbot --nginx -d "$SHOP_HOST" -d "$ADMIN_HOST" --non-interactive --agree-tos \
      -m "$CERTBOT_EMAIL" --redirect || echo "certbot failed: check that both DNS A records point here, then re-run"
  else
    echo "certbot found; set CERTBOT_EMAIL and re-run, or run: certbot --nginx -d $SHOP_HOST -d $ADMIN_HOST"
  fi
else
  echo "certbot is not installed: apt install certbot python3-certbot-nginx, then run: certbot --nginx -d $SHOP_HOST -d $ADMIN_HOST"
fi

echo
echo "Setup done. Next, as $APP_USER, clone the repo to $BASE/app and run deploy/holz_sauna/deploy.sh (see deploy/holz_sauna/README.md)"
