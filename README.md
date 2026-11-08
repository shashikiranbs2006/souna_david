# SaunaKlar for David (Holzsauna)

A quoting tool for David's sauna shop. David builds the sauna for his customer in a 3D
configurator, sends a quote with a link, sees whether and how the customer looked at it, and
invoices a prepayment once the quote is accepted. Customers do not configure anything and have no
accounts: they only open the view-only link David sends them.

The shop is `holzsauna` (CHF, prices include 8.1 % VAT, German and English). It sells six
models: Espoo, Kelo, Fjord, Lappi, Aurora and Saimaa, with their own prices and options.
The brand and the watermark are SaunaKlar.

## What David can do

David works in `/admin`.

- **Contacts and quotes.** Save a contact, build the sauna for them in the 3D configurator
  (Configurations, Open in 3D), then make a numbered quote (Q-1024, Q-1025, ...) with a quantity,
  extra lines such as delivery or installation, and a comment. A change after sending is a new
  version of the same number. The unit price is stored on the quote, so later price changes do
  not move it.
- **Share link.** A view-only page for the customer: no sign-in, no configuring, no cloning. David
  picks the expiry and copies the link. No e-mail is sent yet.
- **Tracking and likelihood.** Each quote shows opens, visitors, whether the inside view was
  opened, the longest visit, and a score (none, low, medium, high) with its reasons.
- **Downloads.** A PDF of every quote version and a picture from the 3D view. Both carry the
  SaunaKlar watermark, which is added on the server.
- **Command box** above every admin page: `new quote`, `find Müller`, `open Q-1024`,
  `list open quotes`, `list expiring links`.
- **Quotes and Reports.** Quotes by status, conversion, most quoted models, link activity and
  links to follow up.
- **Invoices.** From an accepted quote, a prepayment invoice (INV-1001, ...) with a percent, a due
  date and payment details David types in. He marks it paid by hand. There is a watermarked PDF.
  No card or bank connection.

## Run it locally

You need Node.js **22.18 or newer** (see `.nvmrc`) and **Docker** (or your own PostgreSQL 16 with a
superuser). On Windows, start Docker Desktop first.

```sh
npm ci
docker compose up -d postgres
npm run dev:david
```

This checks that Postgres is reachable, applies the migrations, seeds the shop if the database is
empty, and starts the API (port 8787) and the web app (port 5173). Ctrl+C stops both.

| URL | What |
|---|---|
| http://localhost:5173 | David's shop |
| http://localhost:5173/admin | David's admin |
| http://localhost:8787/dev/mail | Dev mailbox: every mail sent locally |

Sign in at `/admin` as `owner@holzsauna.test` with the password **`Sauna!2026`**. Staff sign-in
asks for an authenticator code by default. To skip it locally, run
`STAFF_MFA=OPTIONAL npm run dev:david`.

A database that was seeded before the shop existed needs `LOCAL_IDP=1 npm run db:reset` once.
`npm run dev -- --no-seed` skips seeding and `npm run dev -- --skip-db` skips the database steps.
The database URL defaults to `postgres://sauna:sauna@127.0.0.1:5432/sauna`; override it with
`DATABASE_URL`.

To run the single-shop edition elsewhere, set `SINGLE_SHOP=<slug>` for the API and
`VITE_SINGLE_SHOP=<slug>` and `VITE_LOCALES=de,en` for the web app (or `singleShop` and `locales`
in `/config.js`). API variables are listed in [services/api/.env.example](services/api/.env.example).

## Deploy (Contabo server)

The edition runs on the Contabo server next to other projects, without touching them: user
`holz_sauna`, folder `/opt/holz_sauna`, port 3010 behind a new nginx site, Postgres 16 in its own
Docker container on localhost, one systemd service. Planned addresses:
`sauna-configurator.klardatalabs.com` (the shop and `/admin`) and
`admin.sauna-configurator.klardatalabs.com` (manufacturer admin).

1. Add two DNS A records for those names pointing to the server.
2. As root, once: `deploy/holz_sauna/setup-root.sh` (database container, secrets, service, nginx,
   HTTPS).
3. As `holz_sauna`: clone the repository to `/opt/holz_sauna/app`, then run
   `deploy/holz_sauna/deploy.sh` for the first deploy and for every update.

The first deploy seeds the shop and replaces all seeded passwords with random ones, printed once.
Secrets live only in `/opt/holz_sauna/.env*` on the server, never in git. Details, backups and how
to remove it again: [deploy/holz_sauna/README.md](deploy/holz_sauna/README.md).

## Tests

| Command | What runs |
|---|---|
| `npm run test:unit` | Pricing, rules, shared schemas, web helpers, the 3D kit. No database needed. |
| `npm run test:db` | Schema, database rules and tenant isolation. Needs Postgres. |
| `npm run test:api` | API integration tests, including quotes and invoices. Needs Postgres. |
| `npm test` | All of the above. |
| `npm run typecheck` | `tsc` in every workspace. |
| `npm run test:e2e` | Playwright. |

## How it is built

React 19 and Vite for the web app (`apps/web`, with React Three Fiber for 3D), a Hono API in
TypeScript (`services/api`), PostgreSQL 16 with row-level security and migrations
(`packages/db`), and a shared Zod contract (`packages/shared`). Prices are computed on the server
in integer minor units. Contacts, quotes and invoices are migrations `0016` to `0018`.

This repository is a copy of the multi-reseller SaunaKlar platform, run here as a single shop, so
the code still contains platform parts David does not use (manufacturer admin, customer accounts,
the Terraform in `infra/`). The server deploy files are in `deploy/holz_sauna/`.

More: [docs/david-fork-plan.md](docs/david-fork-plan.md) (the plan), [docs/api.md](docs/api.md) and
the generated [docs/openapi.json](docs/openapi.json) (`npm run openapi`),
[docs/design.md](docs/design.md) (platform design).

## Still open

- David's VAT number and rate (invoices only say "includes VAT") and how his bank details read.
- How long to keep tracking data, and a privacy note on the link page.
- Final domain (the klardatalabs.com names above are for testing), e-mail sending (nothing is
  sent in production yet), and automatic backups.
