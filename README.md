# SaunaKlar for Holzsauna

A quoting tool for David's sauna shop (Holzsauna, Hörhausen, Switzerland). David builds the sauna for a
customer in a 3D configurator, sends a quote by e-mail, sees whether and how the customer looked at it,
and invoices a prepayment once the quote is accepted. Customers have no accounts and configure nothing:
they open the view-only link in their e-mail and can write back from that page.

Single shop, Swiss francs (prices include 8.1 % VAT), German, English, French and Italian. Six models:
Espoo, Kelo, Fjord, Lappi, Aurora and Saimaa. The watermark is SaunaKlar. Designed and maintained by
Klardatalabs.

## What David can do (`/admin`)

- **Contacts and quotes.** Save a contact, build the sauna for them in the 3D configurator, then make a
  numbered quote (Q-1024, ...) with quantity, extra lines (delivery, installation) and a comment. A change
  after sending is a new version of the same number; the unit price is stored on the quote.
- **Send the quote by e-mail.** One click: the customer gets a mail in the language David picks, with the
  quote as a PDF, an optional personal note and a view-only link to the sauna in 3D. The quote becomes
  "sent". Mail goes out through Resend (see below).
- **Customer link.** Short (10 characters), view-only, no sign-in. David chooses the expiry. Opens are
  counted: bots and link previews are ignored and a reload within 30 minutes is one open. The quotes list
  shows the opens and the last visit; each quote shows visitors, the inside view and a likelihood score.
- **Customer questions.** The link page has a short form; the message reaches David by e-mail with the
  customer as Reply-To (five per ten minutes per visitor).
- **Prices.** Base price and largest discount of every sauna; option prices under Saunas, Options.
- **Downloads.** A PDF of every quote version and a picture from the 3D view, both stamped with the
  SaunaKlar watermark on the server.
- **Command box** on every page: `new quote`, `find Müller`, `open Q-1024`, `list open quotes`,
  `list expiring links` (also in German, French and Italian).
- **Reports and invoices.** Quotes by status, conversion, top models, link activity, and prepayment
  invoices (INV-1001, ...) with a PDF. No card or bank connection.

## Run it locally

Node.js 22.18 or newer (`.nvmrc`) and Docker (or your own PostgreSQL 16). On Windows start Docker Desktop first.

```sh
npm ci
docker compose up -d postgres
STAFF_MFA=OPTIONAL npm run dev:david
```

This applies the migrations, seeds the shop, keeps only David's shop, and starts the API (8787) and the
web app (5173). Open http://localhost:5173 (shop) and http://localhost:5173/admin. Sign in as
`info@holzsauna.ch`, password `Sauna!2026` (local only). Without `STAFF_MFA=OPTIONAL` the admin asks for an
authenticator code. Every mail sent locally is listed at http://localhost:8787/dev/mail.

## Configuration

| Variable | What |
|---|---|
| `DATABASE_URL`, `API_DATABASE_URL` | Postgres (owner for migrations, restricted login for the API) |
| `PLATFORM_DOMAIN` | The shop's host name |
| `SINGLE_SHOP` | `holzsauna` |
| `STAFF_MFA` | `REQUIRED` (default) or `OPTIONAL` |
| `RESEND_API_KEY` | Send mail through Resend; without it mail lands in the dev mailbox |
| `MAIL_FROM_ADDRESS` | Sender on a domain verified at Resend (default `onboarding@resend.dev`) |
| `REDIS_URL` | Optional cache for customer-link lookups; without it an in-memory cache is used |

Full list: `services/api/.env.example`. Secrets live only in `/opt/holz_sauna/.env*` on the server, never in git.

## Tests

| Command | What runs |
|---|---|
| `npm run typecheck` | All workspaces |
| `npm run test:unit` | Pricing, rules, shared schemas, web helpers, the 3D kit, mail templates |
| `npm run test:db` | Schema, security rules and seed against a real PostgreSQL |
| `npm run test:api` | The API end to end (login, quotes, links, mail, prices) |
| `npm run test:e2e` | Playwright in Chromium: admin, customer link, language switch |

## How the 3D files are protected

A browser can always save what it shows, so the aim is to make it hard and clearly yours: 3D files are served
only with a signed cookie (low quality without one, full quality with the customer link), full-quality files
are not cached by the browser and cannot be embedded by other sites, downloaded PDFs and pictures are
watermarked on the server, and the customer-link page overlays the watermark on the live 3D view.

## Deploy (Contabo)

One Node process (API and web app) on `127.0.0.1:3010` behind nginx and HTTPS, Postgres 16 in its own
Docker container on `127.0.0.1:5433`, Redis on `127.0.0.1:6380`, one systemd service `holz-sauna`, user
`holz_sauna`, folder `/opt/holz_sauna`. Other projects on the server are not touched. Details, backups and
how to remove it: [deploy/holz_sauna/README.md](deploy/holz_sauna/README.md).

1. As root, once: `deploy/holz_sauna/setup-root.sh` (containers, secrets, service, nginx, HTTPS).
2. As `holz_sauna`: `deploy/holz_sauna/deploy.sh` for the first deploy and every update. It builds with
   all four languages, migrates, removes everything but David's shop, renames his login to
   `info@holzsauna.ch` and, on a first run, prints his new password once.
3. Add `RESEND_API_KEY` and `MAIL_FROM_ADDRESS` to `/opt/holz_sauna/.env` and restart the service.

The shop currently answers on `sauna-configurator.89-117-57-40.sslip.io`.

## Layout

```
apps/web          React + Vite app: the shop, the customer link page, the 3D configurator, /admin
services/api      Hono API, local identity, mail (Resend or dev mailbox), PDF and watermark
packages/shared   The API contract (routes and schemas) shared by both sides
packages/db       Migrations, row-level security, seed
packages/pricing, packages/rules   Price and option rules
e2e               Playwright tests
deploy/holz_sauna Server scripts
```
