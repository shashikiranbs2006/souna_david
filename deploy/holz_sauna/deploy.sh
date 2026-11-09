#!/usr/bin/env bash
# Deploys (or updates) the David edition. Run as the holz_sauna user:
#   bash /opt/holz_sauna/app/deploy/holz_sauna/deploy.sh
# First time: clone the repo to /opt/holz_sauna/app yourself (see deploy/holz_sauna/README.md).
# Every run updates to the latest main, rebuilds, migrates and restarts.
set -euo pipefail

BASE=/opt/holz_sauna
APP=$BASE/app
REPO_URL=${REPO_URL:-git@github.com:shashikiranbs2006/souna_david.git}
BRANCH=${BRANCH:-main}

[ "$(id -un)" = holz_sauna ] || { echo "run as holz_sauna" >&2; exit 1; }
[ -f "$BASE/.env" ] && [ -f "$BASE/.env.deploy" ] || { echo "run setup-root.sh as root first" >&2; exit 1; }

# ---- code ---------------------------------------------------------------------------------
if [ "${SKIP_GIT:-}" = 1 ]; then
  : # SKIP_GIT=1: the code is already in $APP (copied over by hand), git is not touched
elif [ ! -d "$APP/.git" ]; then
  git clone --branch "$BRANCH" "$REPO_URL" "$APP"
else
  git -C "$APP" fetch origin "$BRANCH"
  git -C "$APP" checkout "$BRANCH"
  git -C "$APP" reset --hard "origin/$BRANCH"
fi
cd "$APP"

# ---- Node (version from .nvmrc, installed with nvm under this user only) ------------------
export NVM_DIR="$HOME/.nvm"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | PROFILE=/dev/null bash
fi
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm install >/dev/null
nvm use >/dev/null
ln -sfn "$(dirname "$(dirname "$(command -v node)")")" "$BASE/node"
node --version

# ---- build --------------------------------------------------------------------------------
npm ci
VITE_SINGLE_SHOP=holzsauna VITE_LOCALES=de,en,fr,it npm run build

# ---- database -----------------------------------------------------------------------------
set -a
# shellcheck disable=SC1091
. "$BASE/.env.deploy"
set +a
export LOCAL_IDP=1 LOCAL_OBJECTS_DIR="$BASE/data/objects"
npm run db:migrate
node deploy/holz_sauna/db-tasks.mjs ensure-api-password
OWNER=info@holzsauna.ch
if node deploy/holz_sauna/db-tasks.mjs needs-seed; then
  echo "empty database: seeding the shop"
  npm run db:seed
  FRESH=1
else
  npm run db:media
  FRESH=0
fi
# On every deploy: David's earlier login (owner@holzsauna.test) becomes the shop's own address, and only
# David's shop stays (the other demo shops and all other logins go). Both steps are safe to repeat.
node deploy/holz_sauna/db-tasks.mjs rename-user owner@holzsauna.test "$OWNER"
node deploy/holz_sauna/db-tasks.mjs keep-only-shop holzsauna "$OWNER"
node deploy/holz_sauna/db-tasks.mjs ensure-contact holzsauna "$OWNER" "+41 52 552 43 23" "Ihre Sauna, gemeinsam geplant"
if [ "$FRESH" = 1 ] || [ "${RESET_OWNER_PASSWORD:-}" = 1 ]; then
  # A new random password, printed once (set RESET_OWNER_PASSWORD=1 to do this on a later deploy).
  node deploy/holz_sauna/db-tasks.mjs lock-demo-users "$OWNER"
fi

# ---- start --------------------------------------------------------------------------------
sudo /usr/bin/systemctl restart holz-sauna
for _ in $(seq 1 20); do
  curl -fsS -o /dev/null -H "Host: $(grep '^PLATFORM_DOMAIN=' "$BASE/.env" | cut -d= -f2-)" http://127.0.0.1:3010/ && { echo "app is up on 127.0.0.1:3010"; exit 0; }
  sleep 1
done
echo "the app did not answer on port 3010; check: sudo systemctl status holz-sauna" >&2
exit 1
