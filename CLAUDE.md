# CLAUDE.md — Merge Instant Site into SuperLeads

This file drives a multi-phase merge in the **ClearEdgeSuperLeads** repo. Read all of it before
touching code. Work one phase at a time, in order. Each phase ends with its exit criteria met,
CI green, and a short report to Tim. Do not start the next phase until he says go.

## Goal

One codebase (this repo) that runs the whole ClearEdge "Presence" offer:
lead → audit → website → Google Business Profile management → monthly report → Front Desk upsell.

Today that is split across three repos:

| Repo | Role after the merge |
|---|---|
| `clearedgeintel/ClearEdgeSuperLeads` (this repo) | **The base.** Auth, workspaces, roles, leads, outreach, jobs, CI. Everything lands here. |
| `clearedgeintel/clearedge-instant-site` | **Ported in, then archived.** ~2,800 lines: site renderer, enrichment providers, generator/editor UI, 3 tables. |
| `clearedgeintel/ConsultantCRM-GBP` | **Archived, nothing ported.** It is the April ancestor of this repo. |

Tim clones Instant Site next to this repo as `../clearedge-instant-site`. Read source from there.
Never modify that repo.

## Target architecture

```
ClearEdgeSuperLeads/
  shared/schema.ts           + sites, site_submissions, site_views, clients, gbp_connections
  shared/sites.ts            BusinessData, Theme, SiteStatus, Site types (ported)
  server/index.ts            ADMIN APP — unchanged role: sessions, API, scheduler, SPA
  server/public.ts           NEW PUBLIC SITE SERVER — serves client/demo sites only
  server/sites/
    template/                render.ts, themes.ts, sampleData.ts (ported)
    enrich/                  index.ts, webSearch.ts, lead.ts, shared.ts (ported)
    maps.ts, slug.ts         (ported)
    repository.ts            Drizzle data access for sites/submissions/views
    publish.ts               publish validation (demo → live)
    notify.ts                owner notification on quote requests
    routes.ts                authed admin routes, mounted at /api/sites
    publicRoutes.ts          public routes, mounted only in server/public.ts
  server/gbp/                STUB ONLY in this merge (see Phase 5)
  client/src/components/sites/  Sites tab: list, generator, editor (ported, restyled)
```

**Two Railway services, one repo.**

- **`app`** runs `server/index.ts`: admin UI, API, scheduler and background jobs. Same as today.
- **`public`** runs `server/public.ts`: site pages, quote form, view pixel, robots/sitemap and
  custom-domain routing. It imports **no** session, auth, scheduler, queue or outreach code.

The reason for the split: a bad deploy or runaway job in the admin app must not take a paying
client's website offline.

## Ground rules (apply to every phase)

1. **The production database is shared and live.** The current Instant Site service and this app
   both use it today, and Instant Site stays running until Phase 6. Every schema change must
   be **additive and backward compatible**:
   - no drops
   - no renames
   - no type changes
   - no NOT NULL added to existing columns
2. **Never run `drizzle-kit push` against production.** Tim runs schema changes himself.
   - Write changes as reviewed SQL migration files in `migrations/` (create the folder) or as
     schema edits he can push.
   - If a `drizzle-kit push` or `generate` diff proposes dropping or altering an existing table
     or column, **stop and report**. Never accept a destructive prompt.
3. **Every query on tenant data is scoped to `req.workspace.id`.** This includes sites,
   submissions, views, clients and GBP data. No exceptions in admin routes. Public routes resolve
   a site by slug or host, and only ever touch that one site.
4. **This repo is public until Tim makes it private.** No secrets, sample keys, real client data
   or real phone numbers in code, tests or fixtures. New config goes in `.env.example` with
   empty values.
5. **Don't change existing outreach, LinkedIn, Unipile, campaign or queue behavior.** The only
   allowed touch points are `instantSiteService` (Phase 2) and demo-login/API-key gating (Phase 0).
6. **One phase = one branch = one PR**, titled `merge/phase-N-<name>`. Before reporting a phase
   done:
   - `npm run check`, `npm run lint` and `npm run test:ci` all pass
   - new code has tests
7. **Reuse what exists:**
   - `withRetry` and `trackApiCall` for every Anthropic call
   - `emailService` (Resend) for transactional email
   - `express-rate-limit` patterns in `server/middleware/rateLimit.ts`
   - the existing `notifications` table and `useSSE` for in-app alerts
   - the existing UI kit in `client/src/components/ui`
8. **Keep existing demo URLs working.** Leads already carry `demo_site_url` values pointing at the
   old Instant Site host, and those links are in sent emails. Every existing `/s/:slug` URL must
   still resolve after the cutover (Phase 6).

---

## Phase 0 — Security cleanup (do first; small)

1. **Gate demo login.** `server/fallbackAuth.ts` registers `POST /api/auth/demo-login`
   unconditionally.
   - Register it only when `NODE_ENV !== 'production'` **or** `ENABLE_DEMO_LOGIN === 'true'`.
   - Add `GET /api/auth/config` → `{ demoLoginEnabled }`, and have `client/src/pages/Login.tsx`
     hide the demo button when it's false.
2. **Make `apiKeyAuth` fail closed in production.** In `server/middleware/auth.ts`, if
   `NODE_ENV === 'production'` and `API_KEY` is unset, refuse to start: throw at module load with
   a clear message. Dev behavior stays as it is today (no-op without a key).
3. **Stop logging secrets.** `server/routes.ts` (~line 314) logs full request headers in the
   OAuth callback, which includes cookies.
   - Remove that line.
   - Search the server for any other `console.log` of headers, tokens, `req.session`, or the
     OAuth `tokens` object, and remove those too.
   - Remove any debug routes such as `/api/test-callback` or `/auth/test`, if present.
4. Add `ENABLE_DEMO_LOGIN` and `API_KEY` to `.env.example` with comments.

**Exit:**
- In production mode, demo login returns 404.
- Starting in production without `API_KEY` fails loudly.
- No header or token logging remains.
- Tests cover all three.

---

## Phase 1 — Adopt Instant Site's tables into the Drizzle schema (no data change)

The `sites`, `site_submissions` and `site_views` tables already exist in the production database
(created by Instant Site's SQL migrations 001–005). They are **not** in `shared/schema.ts`, so a
future `drizzle-kit push` would try to drop them. Fix that first.

1. Run `drizzle-kit pull` into a **scratch directory** (never over `shared/schema.ts`) to get the
   exact current definitions.
2. Add matching `pgTable` definitions to `shared/schema.ts`. They must match column for column:
   - **`sites`:**
     - `id uuid pk default gen_random_uuid()`
     - `slug text unique not null`
     - `business_name text not null`
     - `maps_url text`
     - `theme text not null default 'slate'`
     - `status text not null default 'draft'`
     - `data jsonb not null`
     - `created_at`, `updated_at` `timestamptz not null default now()`
     - `workspace_id text` → FK to `workspaces`, on delete set null
     - `lead_id text` → FK to `leads`, on delete set null
     - `created_by text`
     - `deleted_at timestamptz`
     - plus its indexes
   - **`site_submissions`:**
     - `id uuid`
     - `site_id uuid` → FK to `sites`, on delete cascade
     - `lead_id`, `workspace_id`, `name`, `email`, `phone`, `message`: all `text`
     - `created_at timestamptz`
     - plus indexes
   - **`site_views`:**
     - `id uuid`
     - `site_id uuid` → FK to `sites`, on delete cascade
     - `referrer`, `user_agent`: `text`
     - `created_at timestamptz`
     - plus indexes
   - **Verify against the pull output, not this list.** The pull output wins.
3. Generate a migration and confirm the diff against the live schema is **empty** for these three
   tables. Show Tim the diff.
4. Add the new **additive** columns as a separate, reviewed SQL migration:
   - **`sites.custom_domain`** — `text`, unique where not null, stored lowercased without `www.`
   - **`sites.photos`** — `jsonb not null default '[]'`. Array of `{ url, alt, role: 'hero' | 'gallery' }`.
   - **`sites.notify_email`** — `text`
   - **`sites.notify_phone`** — `text`, reserved for SMS later
   - **`sites.published_at`** — `timestamptz`
   - **`sites.client_id`** — `varchar`, FK added in Phase 5. Leave the column un-constrained for now.
   - `status` stays `text`. The new value `'live'` joins `'draft' | 'sent'`. The old Instant Site
     service ignores statuses it doesn't know, so this stays compatible.
5. Add Zod insert/select schemas and types the way the rest of `shared/schema.ts` does.

**Exit:**
- A Drizzle diff against production shows only the additive columns from step 4.
- Tim has applied that migration.
- The old Instant Site service still works (smoke test: open an existing `/s/:slug` on the old
  host).

---

## Phase 2 — Port Instant Site into this app

### 2a. Domain code

Port from `../clearedge-instant-site`. Keep behavior identical unless this section says otherwise.

| From (instant-site) | To (this repo) | Notes |
|---|---|---|
| `shared/types.ts` | `shared/sites.ts` | Add `'live'` to `SiteStatus`; add `photos`, `customDomain`, `notifyEmail` to `Site`. |
| `server/lib/template/*` | `server/sites/template/` | Renderer changes are in Phase 3. Port it unchanged first, with a snapshot test. |
| `server/lib/enrich/*` | `server/sites/enrich/` | Details below. |
| `server/lib/maps.ts` + `maps.test.ts` | `server/sites/maps.ts` + `__tests__/maps.test.ts` | Convert vitest → jest. |
| `server/lib/slug.ts` | `server/sites/slug.ts` | |
| `server/lib/sites.ts`, `submissions.ts`, `views.ts` | `server/sites/repository.ts` | Rewrite on Drizzle (`server/db.ts`). Drop supabase-js. Workspace-scoped variants for admin use. |

**Enrichment details:**

- `webSearch.ts`:
  - Use this repo's `@anthropic-ai/sdk` version, and verify the server-side `web_search` tool
    call still type-checks and works.
  - Wrap the call in `withRetry` + `trackApiCall`.
  - Model comes from `ANTHROPIC_MODEL`, defaulting to Instant Site's current default.
- `lead.ts` (`LeadProvider`) currently reads `leads` and `gbp_profiles` through supabase-js.
  - Rewrite it on `storage`/Drizzle.
  - `gbp_profiles` is **never populated today** (`createGbpProfile` has no callers). Keep reading
    it when a row exists, but don't depend on it.

### 2b. Replace the HTTP integration with direct calls

`server/services/instantSiteService.ts` POSTs to `INSTANT_SITE_BASE_URL/api/generate` with no
credentials.

- Keep the class and its public methods (`isConfigured`, `generateForLead`, `ensureDemoForLead`)
  so `queueGenerationService.ts` and the route around `routes.ts:569` don't change.
- Re-implement the methods as in-process calls to the ported generator. Keep the idempotency
  rules: reuse the lead's existing site unless `force` is set; dedupe cold input by `maps_url`.
- `demo_site_url` must use `PUBLIC_SITE_BASE_URL`.
- `isConfigured()` now means "the Anthropic key or lead data is available," not "a remote URL is
  set."
- Delete `INSTANT_SITE_BASE_URL` from `.env.example`.

### 2c. Admin API (authed)

Mount at `/api/sites`, behind `requireAuth`, `requireWorkspace` and `aiLimiter` (on generate).
All queries are scoped to `req.workspace.id`.

- `GET /api/sites` — list with submission count, view count and last-viewed time. Aggregate in
  SQL (`GROUP BY`), not in JS: the original loads every row.
- `POST /api/sites/generate` — `{ leadId } | { input, locHint? }`, with `force?`
- `GET /api/sites/:id`
- `PATCH /api/sites/:id` — `{ data?, theme?, photos?, notifyEmail?, customDomain? }`
  - Validate with Zod. Reject unknown keys; no mass assignment.
  - `status` changes go through publish (below), not PATCH.
- `POST /api/sites/:id/publish` — runs `publish.ts` validation, then sets `status='live'` and
  `published_at`.
- `POST /api/sites/:id/unpublish`
- `GET /api/sites/:id/submissions`
- `POST /api/sites/:id/photos` — multipart upload to Supabase Storage bucket `site-photos`.
  - This is the only part of the app that needs `SUPABASE_URL` + a service key, so keep it
    server-side.
  - Store the public URL in `sites.photos`.
  - Max 10 MB; jpeg/png/webp only.
- `DELETE /api/sites/:id` — soft delete; `?hard=true` requires role `owner` (`requireRole`).

### 2d. UI

Add a **Sites** tab to `client/src/pages/Dashboard.tsx`, following the existing tab pattern.

- Port Instant Site's `Dashboard`, `Generator` and `Editor` pages into
  `client/src/components/sites/`. Restyle them with this repo's `components/ui` kit and TanStack
  Query.
- Editor needs:
  - a live preview iframe pointing at the public server, with `?preview=1`
  - a photo manager
  - the notification email field
  - the custom domain field, showing the DNS target to set (from Phase 4)
  - a **Publish** button that shows the validation errors from 2c
- The existing "Generate demo site" action on a lead keeps working and opens the site in the Sites
  tab.

**Exit:**
- Generate from a lead and from a Maps URL both work in-app.
- Existing sites list correctly for the workspace.
- `instantSiteService` makes no network calls.
- Tests cover: repository workspace scoping (workspace A cannot read B's sites), generate
  idempotency, the maps resolver (ported tests), and PATCH rejecting unknown keys.

---

## Phase 3 — Public site server + live mode

### 3a. `server/public.ts`

A separate Express entrypoint. It imports only `server/db.ts`, `server/sites/*`, `emailService`
and logging. It must not import sessions, `routes.ts`, the scheduler, or any queue or outreach
service. Add a test that fails if those imports appear.

**Routes:**

- `GET /healthz`
- `GET /s/:slug` — renders the site.
  - Demo sites always render here.
  - Live sites with a `custom_domain` 301 to their domain.
  - `?preview=1` works only with a short-lived signed token issued by the admin app (reuse
    `server/lib/signedToken.ts`). Preview requests are never counted as views.
- `POST /s/:slug/contact` — the quote form. Note the path moved out of `/api`, so everything under
  `/api` is authed in the admin app.
  - Keep the honeypot.
  - Add a per-IP rate limit (5/hour/site).
  - Validate with Zod.
  - On success, call `notify.ts` (3d).
- `GET /s/:slug/pixel.gif` — the view pixel. Don't record views from bots (see 3b), and keep it
  `no-store`.
- **Host routing:** if the request `Host` (lowercased, `www.` stripped) matches a live site's
  `custom_domain`, then on that host serve:
  - `/` → the site
  - `POST /contact`
  - `/pixel.gif`
  - `/robots.txt`
  - `/sitemap.xml`
  
  Unknown hosts return 404. Never fall through to another site.
- `GET /robots.txt` on the default public host → `Disallow: /` (demo sites are never indexed).
- **Caching:** an in-memory LRU of rendered HTML keyed by `(site.id, site.updated_at)`, max 500
  entries.

**Build and deploy:**

- Build both entrypoints with esbuild (`dist/index.js`, `dist/public.js`).
- Add `start:public`.
- Document the second Railway service:
  - same repo
  - start command `npm run start:public`
  - healthcheck `/healthz`
  - env vars: only `DATABASE_URL`, `PUBLIC_SITE_BASE_URL`, `RESEND_*`, `SIGNED_TOKEN_SECRET`
    (or whatever `signedToken.ts` uses)

### 3b. Renderer changes (`server/sites/template/render.ts`)

Add `mode: 'demo' | 'live'` to the render options, derived from `status === 'live'`.

- **Demo mode:**
  - `<meta name="robots" content="noindex,nofollow">`
  - Keep the "Demo site built by ClearEdge Intelligence" footer and the sample-review note.
  - These pages portray real businesses that haven't agreed to anything. They must never be
    indexed.
- **Live mode:**
  - No noindex.
  - Footer reads "Website by ClearEdge Intelligence" (small, link to clearedgeintel.com).
  - Sample-review UI is never rendered.
  - `<link rel="canonical">` pointing at `https://<custom_domain>/` when set, otherwise the
    `/s/:slug` URL.
- **`LocalBusiness` JSON-LD (live only):**
  - `@type` from a small category map (e.g. landscaping → `LandscapingBusiness` if that's a
    valid schema.org type, else `HomeAndConstructionBusiness`; verify each type you map to on
    schema.org).
  - Fields: `name`, `telephone`, `url`, `areaServed` (service areas), `address` only if
    present, `openingHours` only if parseable.
  - **Omit `aggregateRating` and `review`.** Self-serving review markup on a business's own site
    isn't eligible for rich results, and the counts aren't independently verified.
- **Photos:**
  - A hero image when a `role: 'hero'` photo exists. Use `<img>` with width/height,
    `fetchpriority="high"` and alt text.
  - A gallery section for `gallery` photos, using `loading="lazy"`.
  - Pages with no photos render as today.
- **Escaping:** all new fields go through `esc()`.
  - JSON-LD is built as an object and serialized with `JSON.stringify`, then `<` is escaped to
    `<`.
  - `custom_domain` is validated as a hostname before use.
- **Bot filter:** a `isBot(userAgent)` regex (googlebot, bingbot, `bot`, `crawler`, `spider`,
  `preview`, `facebookexternalhit`, `slackbot`, `headless`, etc.), applied in the pixel route.
- **Snapshot tests:** demo, live with no photos, live with photos, sample data.

### 3c. Publish validation (`server/sites/publish.ts`)

Going live fails, with a list of reasons, if any of these hold:

- any testimonial's author equals `SAMPLE_TESTIMONIAL_AUTHOR`
- `phone` is null
- `notify_email` is empty
- `services` is empty
- `custom_domain` is set but malformed

Return all errors at once so the editor can show them together.

### 3d. Owner notification (`server/sites/notify.ts`)

On each valid submission:

1. Insert the `site_submissions` row (as today).
2. Send an email to `sites.notify_email` via `emailService`, using the transactional from-address
   (`RESEND_TRANSACTIONAL_FROM_EMAIL`), never the outreach domain.
   - Subject: `New quote request — <business name>`.
   - Body: name, phone, email, message, the site link, and a reply-to set to the customer's email
     when present.
3. Insert a `notifications` row for the site's workspace so it shows in the bell.

Email failure must not lose the submission: log it, keep the row, and add a `notified_at` column
(additive migration) that stays null for retry. Add a scheduler job in the **admin** app that
retries un-notified submissions older than 5 minutes, up to 3 attempts.

**Exit:**
- `public` runs standalone with the admin app stopped: sites render and the form saves.
- Demo pages carry noindex; live pages don't, and they carry valid JSON-LD (validate one with the
  Schema.org validator and paste the result in the PR).
- A test submission emails the owner.
- Bot user-agents aren't counted as views.

---

## Phase 4 — Custom domains

1. Admin UI (site editor): set `custom_domain`, then show the DNS records to create.
   - **Railway** needs the domain added to the **public** service, which gives a CNAME target.
     **v1 is manual:** the UI shows a checklist ("add `<domain>` to the public service in
     Railway, then create this CNAME") instead of calling Railway's API.
   - **Apex domains** need ALIAS/CNAME-flattening at the DNS provider. Say so in the checklist
     and recommend `www` as the canonical host, with the apex redirecting to it.
2. `GET /api/sites/:id/domain-check` (admin) — resolves the domain's DNS, reports whether it
   points at the public service, then requests `https://<domain>/healthz` to confirm SSL is
   issued.
3. Host routing from 3a handles the rest.
4. Write `docs/custom-domains.md`: steps for Tim, including moving an existing site (e.g.
   summitlandscaper.com) without downtime. Lower the TTL first, publish the site, verify via
   `/s/:slug`, then switch DNS.

**Exit:**
- A test domain (Tim provides it) serves a live site over HTTPS.
- `/robots.txt` and `/sitemap.xml` on that host are correct.
- `/s/:slug` for that site 301s to the domain.

---

## Phase 5 — Clients + Google Business Profile module (stub only)

API access is pending Google approval. Build the data model and interfaces now; **make no live
Business Profile API calls in this phase.**

1. **`clients` table** (additive migration):
   - `id`
   - `workspace_id` (FK)
   - `lead_id` (FK, nullable)
   - `business_name`
   - `tier` (`'presence' | 'presence_plus'`)
   - `status` (`'onboarding' | 'active' | 'paused' | 'cancelled'`)
   - `started_at`
   - `minimum_term_months`
   - `notes`
   - timestamps
   
   Then:
   - Add the FK from `sites.client_id`.
   - Add "Convert to client" on a lead: it creates the client, links the lead's site, and sets
     the lead status to `converted`.
2. **`gbp_connections` table:**
   - `id`
   - `workspace_id`
   - `client_id`
   - `google_account_email`
   - `refresh_token_encrypted`
   - `scopes`
   - `status` (`'pending' | 'connected' | 'revoked' | 'error'`)
   - `last_error`
   - timestamps
   
   Encrypt tokens with AES-256-GCM using `TOKEN_ENCRYPTION_KEY` (32-byte base64). Never return
   them to the client and never log them.
3. **A separate OAuth flow** for `https://www.googleapis.com/auth/business.manage`, at
   `/api/gbp/connect/:clientId` → callback. **Do not add this scope to the login flow in
   `googleAuth.ts`.** Login stays `openid email profile`. Use `state` with a signed token tying
   the callback to the workspace and client.
4. **`server/gbp/client.ts`** — a typed interface:
   - `listAccounts`
   - `listLocations`
   - `getLocation`
   - `listReviews`
   - `replyToReview`
   - `createLocalPost`
   - `fetchDailyMetrics` (Performance API v1)
   - `fetchSearchKeywordImpressions`
   
   Ship only a `NotEnabledGbpClient` that throws a typed `GbpNotEnabledError`, selected while
   `GBP_API_ENABLED !== 'true'`. Endpoint notes for the future implementation:
   - Reviews, localPosts and media live on the v4 `mybusiness.googleapis.com` host.
   - Metrics live on `businessprofileperformance.googleapis.com/v1`.
   - Account and business info use the v1 APIs.
   - Verify each against Google's current docs when implementing.
5. **UI:** a client detail view showing the linked site, a GBP connection card ("Connect Google
   Business Profile," disabled with an explanation while not enabled) and the submissions list.
6. **`gbp_profiles`** stays as it is. A later sync job will populate it from
   `listLocations`/`getLocation`.

**Exit:**
- Clients can be created from leads.
- The connect flow runs end-to-end against Google OAuth in dev and stores an encrypted token.
- Every GBP client method throws `GbpNotEnabledError`.
- Tests cover encryption round-trip, the state-token check, and workspace scoping.

---

## Phase 6 — Cutover and decommission (Tim runs this with you)

1. Deploy the `public` service.
2. **Point the old Instant Site domain at the `public` service.** Paths are identical (`/s/:slug`,
   `/s/:slug/pixel.gif`), so every `demo_site_url` already in sent emails keeps working.
   - If the old host can't be moved, write `scripts/rewrite-demo-urls.mjs`. It defaults to dry
     run, prints the old → new count, and writes only with `--apply`.
   - Old pages POST their form to `/api/sites/:slug/contact`, but pages render fresh on every
     request, so the form action updates automatically. Still, keep a public-server route for
     that old path that 308-redirects to `/s/:slug/contact` for 90 days.
3. Verify against a list of 10 existing slugs taken from the `sites` table:
   - each page renders
   - the form saves and notifies
   - the pixel counts
4. Stop the old Instant Site Railway service.
5. Archive the `clearedge-instant-site` and `ConsultantCRM-GBP` repos on GitHub. This is Tim's
   action; give him the checklist.
6. Update `README.md`, `DEPLOYMENT.md` (two services, env vars per service) and `ROADMAP.md`.

**Exit:** the old service is off, every checked slug works, and the docs are updated.

---

## New environment variables

| Var | Service | Notes |
|---|---|---|
| `ENABLE_DEMO_LOGIN` | app | `true` only in dev/staging |
| `API_KEY` | app | Required in production (Phase 0) |
| `ANTHROPIC_MODEL` | app | Web-search enrichment model |
| `PUBLIC_SITE_BASE_URL` | app, public | e.g. `https://sites.clearedgeintel.com` |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | app only | Photo uploads to Storage. Never in `public`, never in client code. |
| `SITE_PHOTOS_BUCKET` | app | Default `site-photos` |
| `TOKEN_ENCRYPTION_KEY` | app | 32-byte base64; GBP tokens |
| `GBP_API_ENABLED` | app | `false` until Google approves API access |
| `RESEND_TRANSACTIONAL_FROM_EMAIL` | app, public | Already exists; owner notifications use it |

Removed: `INSTANT_SITE_BASE_URL`.

## Out of scope for this merge (do not build)

- **Real GBP API calls:** sync, posting, review replies, metrics. They come after Google approves
  access.
- **The monthly report generator.**
- **Rewriting the audit.** The current AI score guesses from eight Places fields. It gets replaced
  with deterministic checks on real fields (photo count, editorial summary, hours, primary type,
  review recency) plus a Claude write-up, as its own project.
- **Static publishing to Cloudflare Pages** (possible later step; the public service is designed
  so it can be swapped for a static export).
- **SMS notifications** (`notify_phone` is reserved).
- **Multi-page sites** (service-area pages).
- **Any change to outreach, LinkedIn, campaigns or billing.**

## When unsure

Stop and ask Tim rather than guess, especially about:
- anything that touches production data
- DNS
- billing
- a schema diff that isn't purely additive
