# David edition: plan and approach

Status: plan only, no David-specific code yet. Written 2026-11-05, updated 2026-11-05 after
syncing with saunaKlar `main` at `0357ad9` (PR #17). This file lives in David's repository
(`shashikiranbs2006/souna_david`); the first version is in saunaKlar PR #16.

This plan describes a single-reseller version of saunaKlar for one store owner, David. It runs in
David's store, and it is the product we show to wholesalers afterwards. The big multi-layer
platform (manufacturer, resellers, customers) in this repo stays as it is.

Everything marked **verified** was checked in this repo's code. Everything marked
**assumption** was not, and needs a confirmation from you.

---

## 0. What changed in saunaKlar since the first copy

The first copy into this repo was saunaKlar `main` at `692a917`. saunaKlar `main` is now at
`0357ad9`, and this repo's `main` was synced to it (commit `ba1fabe`, tree identical to
saunaKlar `0357ad9`). The difference is one merged pull request, saunaKlar PR #17
"Feat/hardening and customization", made of five commits: 336 files changed, 186 added,
143 modified, 7 deleted (9,244 lines added, 3,150 removed; most of the added files are image
variants under `apps/web/public/catalogue/`).

| Commit | What it did (from the commit message, checked in the diff) | What it means for David |
|---|---|---|
| `746daab` Backend | Migration `0015_reseller_option_settings.sql`: table `reseller_sauna_options` lets a reseller switch an option off, override its price (reseller currency) and its description, per sauna. Enforced in validation, pricing and the lock trigger. New access level `reseller-owner` (`services/api/src/lib/route.ts`): branding, settings, sauna visibility/order, discounts and option prices are owner-only; `reseller-staff` can still read. Runtime host config `window.__SK_CONFIG__` (`apps/web/public/config.js`, `apps/web/src/host.ts`). Stricter production config checks and a new `GET /api/ready` (`services/api/src/config.ts`, `app.ts`). Seed: translated descriptions, new door/heater/floor options, seventh model `kide-glass-corner`. Romansh (`rm`) removed from the locales. | **Helps a lot.** David can now shape his own option list and option prices without a manufacturer screen. David = OWNER, any store staff = ADMIN. One web build can be pointed at David's domain at deploy time. Languages are now en, de, fr, it. |
| `7199910` Web | Theme tokens derived from the brand colour, new kit forms (glass corner), compressed 3D kit assets (commit says about 6.4 MB to 1 MB), reference six-sided renderer, account dashboard, reseller admin split into owner/admin, manufacturer overview (replaces `Analytics.tsx`), mobile bottom bar, Showroom page removed (redirects to `/saunas`). The reseller Settings page was removed: the default share-link expiry now sits on the Branding ("Shop") page (`Branding.tsx`). New configurations can be started from a customer's page (`Configurations.tsx`). | Look and feel David gets is this new one. Smaller 3D files help the store tablet. The share expiry setting moved, but the share page itself did **not** change. |
| `7cb64cd` Tooling and docs | `scripts/optimize-kit-assets.mjs`, Blender scripts `tools/blender/reference_sauna.py` and `render_skp_reference.py`, previews in `docs/previews/`, `docs/customization.md`, `docs/reference-driven-sauna-plan.md`. | Background for the six-sided model. Also committed two Python cache files (`tools/blender/__pycache__/*.pyc`) that look accidental. |
| `05d54d9` README | README rewritten: roles, seven-model catalogue, start steps, demo logins. | Reference only. |
| `b43f21b` 3D fix | Fixes kit parts (heater, benches, stones) that came out about 2.6x too large after compression; adds a test. | Needed; already included. |

**The new model.** Two separate things arrived:

1. **Kide Glass Corner** (`kide-glass-corner`): a seventh catalogue sauna, seeded in
   `packages/db/src/seed.ts`, built from the shared kit with the new `glass-corner` form.
2. **A parametric six-sided glass-front sauna** (`kide-glass-six`), rebuilt from the
   `Modell 6-eck mit Glasfront 1.skp` file and a reference PDF
   (`docs/reference-driven-sauna-plan.md`, renderer in `apps/web/src/three/reference/`).
   Width, depth and height are customer choices (5 × 5 × 4 sizes with proposed EUR price
   deltas). It is **parked**: the seed comment says it is not seeded and the shop shows seven
   models. The plan file itself says the sizes and the 25 mm heater gap are not
   manufacturer-confirmed.

**Checked after the sync** (in this repo, 2026-11-05): `npm ci` installs, and
`VITE_MOCK_API=1 npm run dev -w @saunaklar/web` starts. In a headless browser the platform
page, the `nordic` demo storefront, the Kelo Barrel 3D configurator (after a demo customer
login) and the reseller admin (demo owner login) load with no console errors. Not run: the
real API, the database, the test suites. Note: the mock data (`apps/web/src/api/mock-data.ts`)
still has only six models, so `kide-glass-corner` shows "not available" in mock mode; it
exists only in the real database seed.

**Not changed by PR #17** (verified, no diff): `Shared.tsx` (shared link page still has claim
and clone, still no inside-view tabs), `services/api/src/domain/sharing.ts`,
`domain/configurations.ts`, `packages/pricing`, `packages/rules`. So everything in sections 3
to 7 about the share page, tracking, quotes and contacts still applies.

## 1. Goal

1. David signs in, builds a quotation with the customer in the store, and shares a view-only
   link with that customer.
2. The customer can look at the sauna (3D, outside and inside) and the price, but cannot change
   anything. Changes go through David.
3. David sees who opened which link, how often, and a simple "how likely is this to sell" score.
4. The big platform's code is not touched by David's work. David gets his own repository and
   his own hosting, and we keep access to ship updates.

## 2. Approach: separate repo, but "switch off" instead of "delete"

You suggested cloning the repo and deleting the wholesaler parts. I agree with the separate
repo. I suggest one change to the method: **turn the multi-tenant parts off with a
single-reseller setting rather than deleting them**, at least at the start.

Why: the data model is built around a reseller row. Every tenant table carries `reseller_id`,
row-level security reads `app.reseller_id`, and prices come from the manufacturer
(**verified**: `packages/db/migrations/0002_tenancy_identity.sql`, `0004_reseller_catalog.sql`,
`packages/pricing/src/index.ts`). Deleting the manufacturer and reseller layers means rewriting
the schema, the pricing engine and most API routes. Keeping them and running with exactly one
manufacturer row and one reseller row ("David") means very little changes underneath.

| | Switch off (recommended) | Delete the layers |
|---|---|---|
| Work to start | Small: seed one reseller, hide screens, map David's domain | Large: schema, pricing, RLS, routes, tests |
| Bringing fixes over from the big repo | Easy: the shared code is still the same shape, so `git cherry-pick` mostly works | Hard: every fix has to be re-done by hand |
| Risk of breaking working things | Low | High |
| Leftover unused code in David's repo | Yes (manufacturer admin, sign-up pages) | No |
| What David's repo exposes | More of our platform's code | Less |

Later, once David's version is stable, unused parts can be deleted in small steps.

How the repo was made (**decided**): `shashikiranbs2006/souna_david`, with the saunaKlar code
copied in as a **fresh history** (no shared commits, no fork link). Because the histories are
not shared, `git cherry-pick` from saunaKlar does not apply directly. The way to bring later
saunaKlar changes across: fetch saunaKlar as a local remote, take the diff between the last
synced saunaKlar commit and the new one (`git diff 0357ad9 <new>`), and apply it here with
`git apply -3`. Each sync commit message names the saunaKlar commit it matches (this one:
`0357ad9`). Until David-specific changes start, a sync is a straight copy; after that, conflicts
are expected in the files David's work touches.

## 3. What exists today, and what happens to it

### Reused as it is

| Part | Where (verified) | Notes |
|---|---|---|
| 3D configurator, construction kit, outside and inside views | `apps/web/src/three/`, `apps/web/src/three/kit/`, `apps/web/src/storefront/pages/Configure.tsx` | Exterior/Interior tabs exist (`ViewerSlot` `views` prop). |
| Option rules (required, excludes, single/multi) | `packages/rules/src/index.ts` | `toggle` pulls in required options and drops conflicting ones, so the model "adjusts automatically". |
| Per-sauna option settings (new in PR #17) | `packages/db/migrations/0015_reseller_option_settings.sql`, `apps/web/src/storefront/admin/SaunaOptions.tsx`, `GET/PUT /api/admin/saunas/:id/options` | David switches options off and sets his own option prices and texts. Base (list) prices still come from `sauna_model_prices` (manufacturer side); a reseller can only discount them within the cap. |
| Owner / admin roles (new in PR #17) | `apps/web/src/storefront/admin/permissions.tsx`, access `reseller-owner` | David is OWNER; store staff are ADMIN (requests, customers, configurations, read-only shop settings). |
| Runtime domain config (new in PR #17) | `apps/web/public/config.js`, `apps/web/src/host.ts` | David's domain is set at deploy time, not in the build. |
| Pricing engine (integer, per currency, discounts) | `packages/pricing/src/index.ts` | Live price while configuring. |
| Currencies and languages | `packages/db/migrations/0010_reference_data.sql` (EUR, CHF, SEK, NOK, DKK, PLN, CZK, GBP), `packages/shared/src/common.ts` (`en, de, fr, it`; Romansh removed in PR #17) | One currency per reseller (`resellers.currency_code`). |
| Staff sign-in with MFA | `services/api/src/routes/staffAuth.ts`, `apps/web/src/staff/` | David's login. |
| Price freezing when shared | `lockConfiguration` in `services/api/src/domain/configurations.ts` | Snapshot of price and option lines. |
| Share links: random 256-bit token, only the hash stored, expiry, revoke | `services/api/src/domain/sharing.ts`, `routes/admin.ts` (`adminCreateShareLink`, `adminRevokeShareLink`) | Staff can already choose `expiresInDays` (1 to 90). |
| Basic view tracking | `share_link_views` table (time + device class) | Count and last-viewed shown in admin. |
| Branding (logo, colour), storefront layouts, look and feel | `apps/web/src/storefront/admin/Branding.tsx`, `layouts/` | You want things to look the same, so this stays. |
| Reports base | `adminAnalytics` in `routes/admin.ts`, `apps/web/src/storefront/admin/Dashboard.tsx` | Totals, daily chart, top saunas. |
| Deployment (AWS, Terraform) | `infra/`, `.github/workflows/deploy*.yml` | Region `eu-central-1`. |

### Changed

| Part | Today (verified) | For David |
|---|---|---|
| Shared link page `/s/:token` | `apps/web/src/storefront/pages/Shared.tsx` lets a signed-in customer **claim** the configuration, clone it and open it in the configurator | View only: 3D, inside view, option list, price, David's comments, "call David" button. No claim, no edit, no sign-in. |
| Inside view on the shared page | Shared page renders `ViewerSlot` without `views`, so no Exterior/Interior tabs | Turn the tabs on so the customer can look inside. |
| Staff configuration screen | `apps/web/src/storefront/admin/Configurations.tsx` edits options as a list; the 3D configurator is only on the customer storefront | David needs the full 3D configurator inside his admin, because he configures with the customer. |
| Customer record | `customers` needs an e-mail-verified account to be ACTIVE; no organisation field. Staff can only attach ACTIVE customers to a configuration | A "contact" David types in himself: person, organisation, e-mail, mobile. No account, no verification e-mail. |
| Quote | A quote today belongs to a **customer request** (`request_quotes`, status flow SUBMITTED → … → ACCEPTED in `packages/shared/src/requests.ts`) | A quote is started by David: number (e.g. Q-1024), contact, quantity, configuration, comments, versions. |
| Link expiry | Range 1 to 90 days, enforced in the database (`share_links_expiry`), default from `resellers.default_share_expiry_days` (set on the Shop/Branding page since PR #17). Price snapshot is valid 30 days (`SHARE_PRICE_VALID_DAYS`) | David picks the duration when creating the link. Link expiry and price validity must line up (see risks). |
| Tracking | Time and device class only, **no IP** stored | Add IP, user agent, repeat visits, time spent, whether the inside view was opened. Exclude David's own opens. |

### Hidden (switched off, not deleted at first)

| Part | Where (verified) |
|---|---|
| Manufacturer admin app (still needed by us to set list prices; not for David) | `apps/web/src/manufacturer/`, `services/api/src/routes/manufacturer.ts`, `functions/manufacturer-admin.ts` |
| Platform landing page (recruiting resellers) | `apps/web/src/platform/` |
| Customer sign-up, account pages, saved configurations, customer requests | `apps/web/src/storefront/account/`, `services/api/src/routes/account.ts`, `routes/auth.ts`, `routes/configurations.ts` |
| Multiple resellers / subdomains | Host parsing in `packages/shared/src/host.ts`, `apps/web/src/host.ts`: David gets one fixed domain |
| Reseller discount caps set by a manufacturer | `reseller_*_discounts`, `maxDiscountBps`: only relevant if a wholesaler sets David's prices (open question 4) |

### New (does not exist today)

| Feature | Verified missing |
|---|---|
| Watermark on 3D and on downloads | No "watermark" anywhere in the code |
| Downloads: image, itemised list, cost and comments (PDF) | No PDF or image export found |
| Contact capture with organisation and quantity | Not in schema |
| Quote numbers and versions | Not in schema |
| IP and detailed link tracking | Not in schema |
| Purchase-likelihood score | Not present |
| Command box | Not present |
| Custom line items (delivery, installation, special requests) | Pricing engine only knows base price, options and one discount |
| Payments and invoices (phase 2) | Not present |

## 4. David's feature list (from your picture)

### Phase 1

1. **Login.** David (and staff, if any) sign in. Existing staff login with MFA.
2. **New quotation.** David starts a quote, picks or creates the contact.
3. **Pick a model.** From the catalogue.
4. **Configure.** All option groups, model updates live, price updates live, rules block
   invalid combinations, "ready" only when validation passes (existing `validate`).
5. **Watermark** on the live 3D view and on every download (see section 5).
6. **Downloads of the offer:**
   - image of the configured sauna,
   - itemised list (each option with its price),
   - cost and comments (totals, quantity, discount, David's notes).
   Probably one PDF with all three, plus a separate image. **Assumption:** to confirm.
7. **Share link.** Before creating it, David enters name (person, organisation), e-mail, mobile,
   quantity, and the expiry. The picture asks "add payment info or not?": I suggest **not** in
   phase 1. Taking card or bank details belongs with phase 2 payments and brings extra legal and
   security rules.
8. **Customer opens the link.** View only. Can rotate, look outside and inside, see options and
   price, cannot change anything, sees a "call David" button.
9. **Tracking.** Opens, repeat opens, IP, device, time on page, inside view opened or not.
10. **Purchase likelihood.** A rule-based score from the tracking data (section 6).
11. **Command box.** Commands like `new quote`, `find Müller`, `open Q-1024`, `list open quotes`,
    `list expiring links` (section 7).
12. **Reports and lists.** Quotes by status, link activity, top models, conversion, expiring
    quotes.

### Phase 2

13. Payment integration.
14. Invoice generation.

## 5. Customer link: security and privacy

- **Token:** random 256-bit, only the hash stored (already the case). Nobody can guess a link,
  and a leaked database does not leak working links.
- **Expiry:** David picks it. After expiry the page shows "this offer has expired, call David"
  (the expired page exists today).
- **Revoke:** David can withdraw a link at any time (exists).
- **Versioned quotes:** when David changes a quote, it becomes version 2. The old link either
  keeps showing version 1 or is revoked and a new link sent. A customer must never see prices
  change under an open link without David knowing. **Decision needed** (question 9).
- **Watermark, honestly:** a watermark drawn in the browser over the 3D view stops casual
  copying but anyone can take a screenshot, and code running in the browser can be bypassed.
  For **downloads**, the watermark should be added on the **server** when the file is made, so
  the file that leaves the system always carries it. The live 3D watermark is a deterrent, not
  protection. The full-quality 3D files are already served through signed cookies bound to the
  host (`services/api/src/routes/assets.ts`).
- **Privacy:** storing IP addresses and customer contact details is personal data. The servers
  are in the EU (`eu-central-1`) and CHF and EUR are supported, so GDPR and the Swiss data
  protection act likely apply (**assumption:** depends on where David's store is). Needed: a
  short privacy notice on the link page, a retention period for tracking data (for example 12
  months), and a way to delete a contact. The existing retention worker
  (`services/api/src/worker/retention.ts`) is a place to add that. Storing a shortened IP, or the
  city it maps to, is safer than the full IP.
- **No customer accounts:** removing sign-up also removes password resets, verification mails
  and account takeover risks for the customer side.

## 6. Purchase likelihood: keep it simple and explainable

With one store and no history there is no data to train a model on, so this should be rules with
points, and David sees why a quote scored what it did. Example (numbers are a starting point to
tune with David):

| Signal | Points |
|---|---|
| Link opened at least once | +20 |
| Opened again on a later day | +15 per day, max +30 |
| Inside view opened | +10 |
| More than 2 minutes on the page | +10 |
| Opened from more than one device or IP (sharing with family) | +15 |
| Opened within 24 h of sending | +10 |
| Not opened after 3 days | −20 |
| Expiry within 3 days and no open | −10 |

Shown as Low / Medium / High with the reasons listed. Once some quotes have been won or lost,
the points can be checked against real outcomes.

Known noise: link previews in WhatsApp, Outlook "safe links" and similar scanners can open a link
automatically. Today a view is recorded only when the page's JavaScript calls the API
(`routes/catalog.ts`, `routes.shared`), which most preview bots do not run, but some scanners do.
David's own opens (signed-in staff) must not count.

## 7. Command box

A search box on every admin screen, opened with Ctrl+K (Cmd+K on Mac) or a button. Fixed
commands, not free AI chat, so it is fast and predictable:

| Type | Does |
|---|---|
| `new quote` / `new quote Müller` | Starts a quote, optionally with that contact |
| `find <text>` | Searches contacts, organisations, quote numbers |
| `open Q-1024` | Opens that quote |
| `list open` / `list won` / `list expiring` | Filtered quote lists |
| `share Q-1024` | Opens the share dialog for that quote |
| `report month` | Opens the monthly report |

Plain typing without a command searches. An AI assistant that understands free text can be added
later on top of the same commands if David wants it.

## 8. How other companies do this

This kind of tool is usually called **CPQ** (configure, price, quote). Companies that sell
configurable products through a showroom or sales rep (furniture, kitchens, windows, cars, solar
and similar) generally work like this:

1. The **salesperson** drives the configurator with the customer. Customers rarely build the
   final order alone; they get a proposal. This matches David's rule.
2. Each quote has a **number, a version, and a validity date**. Changes create a new version
   instead of overwriting.
3. The quote has **extra lines** next to the configured product: delivery, installation, removal
   of an old unit, discounts, special requests.
4. Discounts above a limit often need **approval**. For a single owner this does not apply, but
   it will matter when a wholesaler has many resellers.
5. The customer gets a **proposal link or PDF**. Proposal tools such as PandaDoc or DocSend
   show the sender when and how often the document was opened. This is the same idea as David's
   tracking.
6. The customer **accepts** online (button or signature), then pays a deposit. That is phase 2.

What this means for the plan: the main gaps compared to that usual flow are quote versions,
extra line items, quantity, and an "accept" step. They are in the plan above.

## 9. Delivery model

- **Repo:** a new private repo for David's version, separate from this one. We keep admin access
  to ship updates.
- **Hosting:** this repo deploys to AWS with Terraform (Aurora/RDS, Cognito, S3, CloudFront,
  WAF, Lambda, SES, SQS: `infra/modules/`). That is sized for a platform with many resellers. For
  one store it works but has a fixed monthly cost even when idle. A smaller setup is possible
  later but is extra work. **Assumption:** we start with the same AWS setup and a smaller database
  size; decision needed (question 6).
- **Environments:** one test copy for us and one live copy for David's store.
- **Updates:** fixes go to the big repo first when they are shared code, then get picked into
  David's repo; David-only features go only to David's repo.
- **Store hardware:** the 3D view runs in the browser. The tablet or PC in the store should be
  tested early for speed (**assumption:** not tested yet).

## 10. Open risks and loopholes in the current idea

1. **Code ownership.** If David receives the repository, he has our code and could take it to
   someone else or stop paying. Usually the vendor keeps the repo and hosting and David gets the
   running app plus a contract. Decide before handing over (question 2).
2. **Two codebases drift.** Every fix may need doing twice. The switch-off approach and the
   `upstream` remote keep this small, but someone has to do it.
3. **Prices.** In the big app the manufacturer sets list prices and caps discounts. In David's
   version someone has to own the price list. If prices are wrong, every quote is wrong.
4. **Link expiry vs price validity.** Prices freeze for 30 days today, links can live up to 90.
   A customer could open a link showing a price that is no longer honoured. The link expiry
   should never be longer than the price validity.
5. **Quantity and extra lines.** The pricing engine has no quantity and no free lines today. The
   itemised PDF will look incomplete without delivery and installation.
6. **Customer changes by phone.** Every change is a new version. Without versions, David cannot
   tell what the customer saw.
7. **Tracking and the law.** IP tracking without a privacy notice can be a problem in the EU and
   Switzerland. Needs David as the responsible party, and a notice on the page.
8. **Watermark expectations.** It cannot stop screenshots. It should be presented to David as a
   deterrent and a branding mark.
9. **Score expectations.** The score is a hint, not a forecast, until there is history.
10. **Demo vs live.** The preview/demo build uses mock data (`apps/web/src/api/mock.ts`,
    loaded from `apps/web/src/main.tsx`). The store version must run against the real database
    and API, which means real hosting, backups and a real login.

## 11. Order of work (when you say go)

1. ~~Create David's repo~~ (done, synced to saunaKlar `0357ad9`). Next: single-reseller seed,
   hide manufacturer and customer-account screens, fixed domain via `__SK_CONFIG__`, add
   `kide-glass-corner` to the mock data so the demo shows all models. Deploy to a test
   environment.
2. Contacts and quotes (number, version, quantity, comments, extra lines), 3D configurator inside
   David's admin.
3. View-only share page with inside view, expiry chosen by David, call button.
4. Tracking (IP, repeats, time, inside view) and the likelihood score.
5. Watermark on 3D, server-side downloads (image and PDF).
6. Command box, reports and lists.
7. Test in the store on David's device, fix, go live.
8. Phase 2: payments and invoices.

## 12. Where the work lives

The big platform's code lives on GitHub (`anikeaty08/saunaklar`), David's in
`shashikiranbs2006/souna_david`. Each Claude session clones it fresh into a
temporary cloud machine, works on a branch, and pushes back. Nothing is saved on your computer
unless you connect a folder. GitHub is the safe copy. You can keep working this way. Connecting a
local folder is only useful if you want to run the app on your own PC or hand files over
directly.

---

## 13. What I need from you

1. ~~Name for David's repository~~ (done: `shashikiranbs2006/souna_david`).
2. **Who owns the code and hosting:** you (David gets access to the app only) or David (he gets
   the repo). And whether David gets read access to the repo at all.
3. **David's business details:** store name, country and address, the one currency and the
   languages his customers use, VAT rate and whether prices are shown with or without VAT.
4. **Who sets prices:** David himself, or a wholesaler/manufacturer price list he follows. And the
   real price list: base prices per model and per option, in his currency. Since PR #17 David
   can set option prices himself; the base price per model is still set on the manufacturer
   side (by us, in a single-reseller setup). Is that split right, or should David also edit
   base prices?
5. **Which models and options** David sells (all seven catalogue models now, including the new
   Kide Glass Corner, or a subset), and any rules missing today (for example "this heater only
   with this size").
6. **Hosting choice:** same AWS setup as the big app (an AWS account, region, budget), or a
   cheaper simpler host. And who pays the hosting bill.
7. **Domain** for David's app and for the customer links (for example `offers.davidsauna.ch`),
   and access to its DNS.
8. **Branding:** logo (SVG or high-resolution PNG), colours, and the watermark text or logo.
   Should the watermark also show the quote number?
9. **Quote versions:** when David changes a quote, should the old link keep showing the old
   version, or be withdrawn automatically?
10. **"Clean image" meaning:** an image without the app's buttons but still watermarked, or an
    image without watermark that only David can download?
11. **Extra lines on quotes:** delivery, installation, other? Can David give a manual discount
    or override the total?
12. **Staff:** only David, or more people in the store? Each with their own login?
13. **E-mail or WhatsApp:** how does David send the link? We can generate it to copy, or send an
    e-mail from the app (needs a sender address on his domain).
14. **Privacy text:** who writes the privacy notice (David's lawyer, or we draft it for review),
    and how long tracking data is kept.
15. **Store device:** which tablet or PC will run it, so we can test speed early.
16. **Phase 2 provider preference** for payments (for example Stripe, or a local provider) and
    invoice format rules in David's country. Not needed now, only to keep room in the design.
17. **The six-sided glass-front sauna** (from the `.skp` file): it is parked in saunaKlar and its
    sizes and prices are marked as not confirmed by a manufacturer. Should David's version
    include it at launch, wait until it is finished in saunaKlar, or leave it out?
18. **Syncing rule:** after David's work starts, should every saunaKlar change be brought over,
    or only fixes and the parts you name (for example 3D and pricing), with each sync done on
    request?
19. **Clean-up:** may I remove the two committed Python cache files
    (`tools/blender/__pycache__/*.pyc`) in David's repo? They look accidental. (Fixing it in
    saunaKlar too is Aniket's call.)

---

## 14. Answers from David's website (read 2026-11-05)

You confirmed the plan on 2026-11-05 and pointed to David's site for the answers. Everything
below was read from these pages; nothing is guessed. Where the site does not answer, the
question stays open in section 15.

Sources: [product page](https://www.holzsauna.ch/designsauna-zirbe-massivholz-swissmade-6-eck-glasfront-schieferplatten),
[home](https://www.holzsauna.ch/), [Impressum](https://www.holzsauna.ch/Impressum),
[Versandinformationen](https://www.holzsauna.ch/Versandinformationen),
[Zahlungsmöglichkeiten](https://www.holzsauna.ch/Zahlungsmoeglichkeiten).

| Question | Answer from the site |
|---|---|
| 3. Business | **Holzbau Boscheri GmbH**, Geschäftsführer **David Boscheri**, shop name **Holzsauna** ("Saunabau by Holzsauna"), Hauptstrasse 40, CH-8507 Hörhausen TG, info@holzsauna.ch, Mon–Fri 9:00–18:00. VAT number CHE-329.191.810 MWST. |
| 3. Currency, VAT | **CHF only.** Prices are shown **including 8.1% MwSt**, shipping extra ("inkl. 8,1% MwSt., zzgl. Versand"). |
| 3. Languages | **German** (main) and **English** (language switcher DE / EN). |
| 4. Prices | David sets his own prices: the 6-Eck page is "ab CHF 19'990,00". |
| 5. Models | The home page lists 14 saunas, mostly Zirbe (stone pine) Swissmade made-to-measure cabins from CHF 15'990 to 35'990, plus a few bought-in models (Sentiotec Arktis Infra+, Huum Saunafass 280). |
| 5. Options of the 6-Eck model | Width 150–250 cm and depth 150–250 cm in 10 cm steps, each with its own surcharge (width 160 cm +127 up to 250 cm +1'459; depth 160 cm +96 up to 250 cm +1'156). Heater sets: none (0), Harvia Virta 9 kW + Huum UKU Glass Wifi (+2'425), Harvia Virta Combi 9 kW (+3'115), EOS Mythos S35 black 9 kW + EmoStyle Hi (shown as CHF 0,00), EOS Mythos Vapro S35 black 9 kW (shown as CHF 0,00). Accessories: Saunaset Nova (+229), LED band warm white 5 m (+299). Construction: 40 mm Zirbe walls and ceiling, slate outside, knot-free aspen benches (alder optional, price not shown), 8 mm clear glass front, glass door about 67 × 187.5 cm. |
| 8. Branding | Logo `https://www.holzsauna.ch/bilder/intern/shoplogo/Holzsauna-Logo.gif`. No brand colour is defined on the site (theme colour #FFFFFF). |
| 11. Extra lines | Delivery to the kerb anywhere in Switzerland: **CHF 100** within 150 road km of Frauenfeld, **CHF 200** beyond. Abroad on request. Installation price is not shown. |
| 16. Payment (phase 2) | **Prepayment by invoice before delivery**, or **cash on delivery**. No card payment. So phase 2 needs invoices, not a card provider. |

**What this changes in the plan:**

1. **Currency and tax.** David's shop runs in CHF, and the database already supports CHF.
   Quotes show prices including 8.1% VAT, with the VAT amount listed on the PDF.
2. **Languages.** German first, English second. Both already exist in the app.
3. **Catalogue.** David's real products replace the demo saunas. The first one is the 6-Eck
   Glasfront Schiefer model, with his sizes, heaters and accessories at his prices.
4. **The six-sided model.** It is David's flagship product, so it goes in (question 17). The
   parked renderer in `apps/web/src/three/reference/` is built for 2400–3600 mm, while David
   sells 1500–2500 mm. It needs re-checking at his sizes before it goes live. Until then the
   6-Eck model uses the kit's `hex` form.
5. **Extra lines.** Quotes get a delivery line (CHF 100 or 200), an installation line, and free
   lines.
6. **Phase 2.** Invoices with prepayment are the main need. Online card payment is not needed.

**Defaults I am using where the site has no answer** (each can be changed later without
rework):

- Question 9, quote versions: an open link keeps showing the version it was created for.
  A new version gets a new link.
- Question 10, "clean image": every download carries the watermark.
- Question 12, staff: David is the owner and can invite staff (this already exists).
- Question 13, sending: David copies the link (WhatsApp, e-mail, anything). Sending e-mail from
  the app comes later.
- Question 18, syncing: saunaKlar changes come over only on request, starting with fixes.
- Question 19: the `.pyc` files are removed in the CI fix PR.

## 15. Still open (the site does not answer these)

1. **Phone number:** the header says +41 52 552 43 23, the Impressum says 0041 52 552 43 21.
   Which one goes on quotes and the share page?
2. **EOS heater sets** show CHF 0,00 on the site. Is that their real price (included), or a
   site error?
3. **Alder benches:** the site says alder costs extra but shows no price.
4. **Installation:** price, or "on request"?
5. **Which of the 14 saunas** go into the app first (all of them, or the Zirbe Swissmade range)?
6. **Brand colour** for the app (the site has none; the logo GIF is the only brand asset).
7. **Watermark text:** "Holzsauna", the logo, and should the quote number be included?
8. **Domain** for the app and the customer links, and who has DNS access.
9. **Hosting:** the same AWS setup, who pays, and whether David gets the repo or only the app
   (questions 2 and 6).
10. **Privacy notice and tracking retention** (question 14), and the store device (question 15).
