# Deploying the David edition to the Contabo server

Target: the Contabo VPS (Ubuntu) that also hosts other projects. Everything here lives next to
them and does not change them: its own user `holz_sauna`, folder `/opt/holz_sauna`, port 3010,
a Postgres 16 container `holz-sauna-db` on 127.0.0.1:5433, a Redis 7 container `holz-sauna-redis` on
127.0.0.1:6380 (share-link cache, password in `.env` as `REDIS_URL`; the app works without it), one systemd service `holz-sauna` and
one new nginx site `holz_sauna`. Only `nginx -t` and `systemctl reload nginx` touch shared
services (a reload does not drop connections to the other sites).

```
browser -> nginx (443, new site) -> 127.0.0.1:3010  Node process: API + web app + worker
                                    127.0.0.1:5433  Postgres 16 (Docker, own volume)
```

The app runs as `NODE_ENV=production` with the local adapters (`ADAPTERS=local`): users and
sessions are in Postgres, files in `/opt/holz_sauna/data/objects`. No mail is sent yet (the
dev mailbox is off in production), so password reset and invite mails do not exist; use
`db-tasks.mjs set-password` instead.

## Hostnames

| Host | What |
|---|---|
| `sauna-configurator.89-117-57-40.sslip.io` | David's shop and `/admin` (the only host; there is no manufacturer admin) |

sslip.io names resolve to the server by themselves, so no DNS record is needed. For a real domain,
add one **A** record pointing to `89.117.57.40` before running the HTTPS step.

## 1. Once, as root

```sh
SHOP_HOST=sauna-configurator.89-117-57-40.sslip.io \
CERTBOT_EMAIL=<your e-mail for Let's Encrypt notices> \
bash setup-root.sh
```

(Get the file with `curl -O` from this repository, or copy it over.) It generates the secrets in
`/opt/holz_sauna/.env` and `.env.deploy` (mode 600, owned by `holz_sauna`; never in git),
starts the database container, installs the service, adds the nginx site and asks Let's Encrypt
for a certificate. It stops if port 3010, 5433 or 6380 is already taken. Re-running it is safe: it keeps
existing secrets and containers.

## 2. Once, as holz_sauna: get the code

If the repository is private, create a read-only deploy key:

```sh
su - holz_sauna
ssh-keygen -t ed25519 -N '' -f ~/.ssh/id_ed25519 && cat ~/.ssh/id_ed25519.pub
```

Add the printed key under the repository's Settings, Deploy keys (read-only), then:

```sh
git clone git@github.com:shashikiranbs2006/souna_david.git /opt/holz_sauna/app
```

## 3. Deploy and every later update, as holz_sauna

```sh
bash /opt/holz_sauna/app/deploy/holz_sauna/deploy.sh
```

It updates to `main` (`BRANCH=<name>` for another branch), installs Node from `.nvmrc` via nvm,
builds the API and the web app, migrates the database, restarts the service and checks that it
answers. On the first run it seeds the shop (David's `holzsauna` with the six kit models) and
removes everything except David's shop (the other demo shops, the manufacturer admin and their
logins) and **replaces the seeded password**: `info@holzsauna.ch` gets a new random password that
is printed once in the terminal. Copy it then; it is stored nowhere. Staff sign-in asks for an
authenticator code (`STAFF_MFA=REQUIRED`) and offers to set one up on the first sign-in.

Change a password later (12 characters or more):

```sh
cd /opt/holz_sauna/app && set -a && . ../.env.deploy && set +a
NEW_PASSWORD='...' node deploy/holz_sauna/db-tasks.mjs set-password info@holzsauna.ch
```

## Checks and logs

```sh
sudo systemctl status holz-sauna
journalctl -u holz-sauna -n 100 --no-pager     # as root
curl -I https://sauna-configurator.89-117-57-40.sslip.io
```

## Backups

Not set up yet. The data is the Docker volume `holz_sauna_pgdata` (database) and
`/opt/holz_sauna/data/objects` (uploaded files). A first backup:
`docker exec holz-sauna-db pg_dump -U sauna sauna | gzip > sauna-$(date +%F).sql.gz`.

## Removing it again

As root: `systemctl disable --now holz-sauna`, delete `/etc/systemd/system/holz-sauna.service`,
`/etc/nginx/sites-enabled/holz_sauna`, `/etc/nginx/sites-available/holz_sauna` and
`/etc/sudoers.d/holz_sauna`, run `nginx -t && systemctl reload nginx`, then
`docker rm -f holz-sauna-db` (and `docker volume rm holz_sauna_pgdata` to delete the data).
