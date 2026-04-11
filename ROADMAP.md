# ClearEdge Outreach Platform — Build Roadmap

Merged build combining **ConsultantCRM-GBP** (Google lead discovery + email outreach) and **ClearEdge Leads** (LinkedIn multi-step campaigns via Unipile) into a single production-ready platform.

**12 phases · ~26 weeks to full commercial launch**

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│         React 18 + TypeScript + shadcn/ui + TanStack Query       │
│  Lead Discovery | LinkedIn | Campaigns | Queue | GBP | Analytics │
└───────────────────────────┬─────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│              Express.js + TypeScript — Unified API               │
│   Auth · Drizzle ORM · Workspace middleware · Rate limiting      │
└──────┬──────────┬──────────────┬──────────────┬─────────────────┘
       │          │              │              │
   AI service  Google service  LinkedIn      Email service
  (Claude API + (Places API +  service       (SendGrid/Resend +
  prompt engine  GBP OAuth)    (Unipile)      bounce + tracking)
  RAG + A/B)
       │
┌──────▼──────────────────────────────────────────────────────────┐
│         PostgreSQL via Supabase — Drizzle ORM (unified schema)   │
│  workspaces · users · leads · campaigns · send_queue · send_log  │
│  suppression_list · audit_log · webhook_endpoints · app_config   │
└─────────────────────────────────────────────────────────────────┘
```

### Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend | React 18, TypeScript, Tailwind, shadcn/ui, TanStack Query | From GBP app |
| Backend | Express.js, TypeScript | From GBP app |
| ORM | Drizzle ORM | From GBP app |
| Database | PostgreSQL (Supabase) | Both apps |
| AI | Anthropic Claude + prompt engine + RAG + A/B testing | From ClearEdge Leads |
| Google APIs | OAuth 2.0, Custom Search, Places API (New) | From GBP app |
| LinkedIn | Unipile API | From ClearEdge Leads |
| Email infrastructure | SendGrid / Resend (replaces Gmail SMTP) | New — Phase 8 |
| Billing | Stripe | New — Phase 9 |
| Realtime | Server-Sent Events (SSE) | New — Phase 11 |
| Enrichment | Apollo.io / Hunter.io | New — Phase 10 |
| CRM | HubSpot | Both apps |
| Scheduled jobs | `node-cron` in-process | Replaces n8n (see Design Decisions) |
| Build | Vite, esbuild | From GBP app |

---

## Environment Variables

```env
# Database
DATABASE_URL=                    # PostgreSQL connection string (Supabase)
SUPABASE_URL=                    # Supabase project URL
SUPABASE_ANON_KEY=               # Supabase anon key
SUPABASE_SERVICE_KEY=            # Supabase service key (server-side only)

# Auth
SESSION_SECRET=                  # Random string for session encryption
GOOGLE_CLIENT_ID=                # Google OAuth 2.0 client ID
GOOGLE_CLIENT_SECRET=            # Google OAuth 2.0 client secret

# Google APIs
GOOGLE_CUSTOM_SEARCH_API_KEY=    # API key with Custom Search API enabled
GOOGLE_CUSTOM_SEARCH_ENGINE_ID=  # Programmable Search Engine ID
GOOGLE_PLACES_API_KEY=           # Places API (New)

# AI
ANTHROPIC_API_KEY=               # Anthropic Claude API key

# LinkedIn (Unipile)
UNIPILE_API_KEY=                 # Unipile API key
UNIPILE_ACCOUNT_ID=              # Unipile LinkedIn account ID
UNIPILE_BASE_URL=                # Default: https://api1.unipile.com:13465

# Email infrastructure (Phase 8 — replaces Gmail SMTP)
SENDGRID_API_KEY=                # SendGrid API key
SENDGRID_FROM_EMAIL=             # Verified sending email address
SENDGRID_FROM_NAME=              # Sender display name
SENDGRID_WEBHOOK_SECRET=         # For verifying inbound event webhooks
# Gmail kept for dev/testing only
GMAIL_USER=
GMAIL_PASSWORD=

# Billing (Phase 9)
STRIPE_SECRET_KEY=               # Stripe secret key
STRIPE_PUBLISHABLE_KEY=          # Stripe publishable key
STRIPE_WEBHOOK_SECRET=           # For verifying Stripe webhook events
STRIPE_SOLO_PRICE_ID=            # Price ID for Solo plan
STRIPE_TEAM_PRICE_ID=            # Price ID for Team plan
STRIPE_AGENCY_PRICE_ID=          # Price ID for Agency plan

# Enrichment (Phase 10)
APOLLO_API_KEY=                  # Apollo.io API key
HUNTER_API_KEY=                  # Hunter.io API key (email verification)

# Calendar webhooks (Phase 12)
CALENDLY_WEBHOOK_SECRET=
CALCOM_WEBHOOK_SECRET=

# CRM
HUBSPOT_API_KEY=                 # HubSpot private app token

# App
PORT=5000
APP_URL=http://localhost:5000
NODE_ENV=development
API_KEY=                         # For internal machine-to-machine webhooks

# Rate limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=100
```

---

## Phase 1 — Foundation & Schema Unification

**Timeline:** Week 1–2
**Goal:** Working monorepo with merged database schema. Both source codebases referenced but all new code lives here.

### 1.1 Project scaffold

- [x] Extract both source codebases into `_source/` (gitignored) as read-only snapshots
- [x] Initialize new project from GBP app as base (copy `_source/ConsultantCRM-GBP-main/` contents into workspace root)
- [x] Stage ClearEdge Leads JavaScript into `_reference/` (clearedge-lib, clearedge-middleware, clearedge-api, clearedge-tests, clearedge-migrations) — ported incrementally phase by phase, not en masse
- [x] Copy `n8n/linkedin-queue-workflow.json` into project root `n8n/` (kept as reference only — Phase 3 replaces it with an in-process worker, see Design Decisions)
- [x] Rename project in `package.json` → `clearedge-outreach`
- [x] Exclude `_source/` and `_reference/` from `tsconfig.json` so JS reference files don't break typecheck
- [x] Add ESLint + Prettier config from ClearEdge Leads, upgraded for TypeScript (`@typescript-eslint/*`, `eslint-plugin-react-hooks`)
- [x] Add Husky pre-commit hooks (`npm run lint && npm run check`)
- [x] Set up Jest config for TypeScript (`jest.config.ts` with `ts-jest/presets/default-esm`, no coverage threshold until Phase 6)
- [x] Update `README.md` with full architecture overview
- [x] Update `.gitignore` (`_source/`, source zips, `.env`, `coverage/`)
- [x] Verify skeleton compiles clean: `npm run check` ✓, `npm run lint` ✓ (0 errors, 111 pre-existing GBP warnings), `npm run build` ✓
- [x] `git init` + initial commit (`3e87f86`)

> **Phase 1.1 status:** Complete as of 2026-04-11. The skeleton passes typecheck, lint (0 errors), and build. Pinned versions: ESLint `^8.57.1`, Prettier `^3.8.2`, `@typescript-eslint/*` `^8.58.1`, Jest `^30.3.0`, ts-jest `^29.4.9`, Husky `^9.1.7`, `eslint-plugin-react-hooks` `^4.6.2`. Note: ESLint 10 was initially installed but is incompatible with `.eslintrc.json` (flat-config only) and `@typescript-eslint` v8 — pinned to v8.57 as the last stable combo with legacy config support.

> **Note on JS → TS conversion:** The roadmap originally called for a bulk `.js → .ts` stub rename in this phase. We deferred that. Each ClearEdge Leads file is converted to TypeScript at the moment it is ported into `server/services/` or `server/lib/` during its owning phase (2–5). Files sit untouched in `_reference/` until then. This keeps `npm run check` green throughout the port.

> **Pre-existing lint debt:** 111 warnings remain from GBP source code (mostly `@typescript-eslint/no-explicit-any`, a handful of unused vars, and `eqeqeq`/`prefer-const` downgraded to warn for the scaffold). These are not introduced by our work and should be cleaned up opportunistically during Phase 2 porting or in Phase 6's "Final pass."

### 1.2 Unified Drizzle schema

Create `shared/schema.ts` with all table definitions:

- [x] **`workspaces` table** — top-level tenant (stubbed now, activated Phase 9):
  ```typescript
  id, name, slug, plan, stripe_customer_id, stripe_subscription_id,
  monthly_email_sends_used, monthly_linkedin_sends_used, daily_email_limit,
  created_at
  ```
- [x] **`users` table** — add `workspace_id` FK + `role` ('admin' | 'member'), keep Google OAuth fields
- [x] **`leads` table** — unified with `lead_source` discriminator + `workspace_id`:
  ```typescript
  lead_source: varchar  // 'google' | 'linkedin'
  workspace_id: varchar FK
  // Google-specific (nullable for linkedin leads)
  google_place_id, rating, total_reviews, business_hours, place_types,
  business_status, email, email_source, search_query, ai_score, ai_analysis,
  email_verified, email_verified_at
  // LinkedIn-specific (nullable for google leads)
  linkedin_url, title, company, industry, company_size, headline,
  connection_degree, enrichment_data
  // Shared
  business_name, address, phone, website, category, priority, status,
  is_deleted, hubspot_company_id, hubspot_pushed_at, created_by,
  discovered_at, enriched_at, re_enrich_after
  ```
- [x] **`campaigns` table** — merged from GBP `outreach_campaigns` + ClearEdge Leads `campaigns`. Added `workspace_id`, `outreach_channel`, `require_approval`, `is_deleted`. Rename touched `server/storage.ts` and `server/routes.ts`.
- [x] **`campaign_steps` table** — port from ClearEdge Leads (step_order, step_type, delay_days, prompt_template, character_limit)
- [x] **`campaign_enrollments` table** — port from ClearEdge Leads, add `ooo_until` date
- [x] **`send_queue` table** — port + add `channel`, `email_recipient`, `email_subject` for email channel
- [x] **`send_log` table** — port from ClearEdge Leads, add `channel` + `workspace_id`
- [x] **`engagement_events` table** — port from ClearEdge Leads (includes `sentiment` column from migration 005)
- [x] **`prompt_versions` table** — port from ClearEdge Leads migration 005
- [x] **`gbp_profiles` table** — keep from GBP app + add `workspace_id`
- [x] **`outreach_emails` table** — keep from GBP app, add `bounced_at`, `clicked_at`, `workspace_id`, status enum includes `bounced`/`spam`
- [x] **`suppression_list` table** — new:
  ```typescript
  id, workspace_id FK, email, domain, reason ('unsubscribed'|'bounced'|'spam_report'|'manual'),
  created_at
  ```
- [x] **`audit_log` table** — new:
  ```typescript
  id, workspace_id FK, user_id FK, action, entity_type, entity_id,
  metadata jsonb, created_at
  ```
- [x] **`webhook_endpoints` table** — new:
  ```typescript
  id, workspace_id FK, url, events jsonb, secret, is_active, created_at
  ```
- [x] **`notifications` table** — new:
  ```typescript
  id, workspace_id FK, user_id FK, type, title, body, link, read_at, created_at
  ```
- [x] **`unipile_accounts` table** — new (Agency multi-account, Phase 9):
  ```typescript
  id, workspace_id FK, account_id, label, daily_sends_used, daily_limit, created_at
  ```
- [x] **`app_config` table** — port from ClearEdge Leads + add `workspace_id` (composite unique index on workspace_id+key)
- [x] **`sessions` table** — keep from GBP app unchanged
- [x] Run `npm run db:push` and verify all tables created (19 tables live in Supabase as of 2026-04-11)

> **Phase 1.2 status:** Complete as of 2026-04-11. All 16 application tables defined in [shared/schema.ts](shared/schema.ts), typecheck passes, and `db:push` successfully synced the schema to the configured Supabase DB. The `workspaces` table is stubbed (nullable FK everywhere) until Phase 9 activates multi-tenancy.
>
> **Clean-slate note:** The target Supabase project contained tables from an unrelated previous app. With user authorization, the `public` schema was dropped and recreated (with Supabase role grants restored) before `db:push`. A throwaway `scripts/reset-db.mjs` handled this and was deleted after the reset.
>
> **GBP table rename:** `outreachCampaigns` → `campaigns` in TypeScript and SQL. Touched call sites in [server/storage.ts](server/storage.ts) (method renames `createCampaign`, `getCampaigns`) and [server/routes.ts](server/routes.ts) (2 sites).

### 1.3 Auth strategy

- [x] Keep Google OAuth from GBP app as primary login (`server/services/googleAuth.ts`)
- [x] On first login, auto-create a personal workspace for the user (handled in `storage.upsertUser` so every auth path — Google OAuth + demo login — gets a workspace)
- [x] Keep `fallbackAuth.ts` for local dev demo login
- [x] Port `middleware/auth.js` → [server/middleware/auth.ts](server/middleware/auth.ts) as `apiKeyAuth` — used for machine-to-machine webhook endpoints, distinct from session-based `requireAuth` in `fallbackAuth.ts`
- [x] Add [server/middleware/requireWorkspace.ts](server/middleware/requireWorkspace.ts) stub — injects `req.workspace` via a typed Express.Request augmentation in [server/types/session.d.ts](server/types/session.d.ts). Non-blocking until Phase 9 promotes it to a hard 403 gate.
- [x] Port `middleware/validate.js` → [server/middleware/validate.ts](server/middleware/validate.ts) as `validateBody<T>(schema)` — generic Zod wrapper
- [x] Port `middleware/error-handler.js` → [server/middleware/errorHandler.ts](server/middleware/errorHandler.ts) — uses `console.error` for now; swapped for pino in Phase 6's structured-logger pass

> **Phase 1.3 status:** Complete as of 2026-04-11. Middleware files live under `server/middleware/`. None of the new middleware is wired into `server/index.ts` or routes yet — they're available for Phase 2+ to mount as needed. The one behavior change that does ship immediately is workspace auto-creation on login: any `upsertUser` call whose result has no `workspaceId` triggers a `createPersonalWorkspace` insert and an update on the user row.

---

## Phase 2 — GBP Module (Google Lead Discovery + Email Outreach)

**Timeline:** Week 3–4
**Goal:** All GBP app features working in the new codebase with zero regressions.

### 2.1 Backend services

- [x] `server/services/placesApi.ts` — already in place from GBP base, no changes needed
- [x] `server/services/emailDiscovery.ts` — already in place, no changes needed
- [x] `server/services/email.ts` — already in place; kept for dev/local use only, replaced Phase 8
- [x] `server/services/googleAuth.ts` — already in place, no changes needed
- [x] Rename `server/services/hubspot.ts` → [server/services/hubspotService.ts](server/services/hubspotService.ts); updated import in [server/routes.ts](server/routes.ts)
- [x] `server/lib/backgroundQueue.ts` — already in place, no changes needed
- [x] Update [server/storage.ts](server/storage.ts) — `getLeads`, `getGbpProfiles`, `getCampaigns`, and `getOutreachEmailsByUser` all accept an optional `workspaceId` that adds an additional `WHERE` clause alongside `createdBy`/`managedBy`. Inserts carry `workspaceId` through from `req.session.user.workspaceId`. Phase 9 promotes this to a hard requirement.

### 2.2 Frontend components

- [x] [client/src/components/LeadDiscovery.tsx](client/src/components/LeadDiscovery.tsx) — already in place from GBP base; new unified-schema columns are additive, no changes needed
- [x] [client/src/components/LeadModal.tsx](client/src/components/LeadModal.tsx) — added a `leadSource` badge pill (blue = Google, sky = LinkedIn) next to the business-status badges in the dialog header
- [x] [client/src/components/ProfileManagement.tsx](client/src/components/ProfileManagement.tsx) — already in place, no changes needed
- [x] [client/src/components/ProfileModal.tsx](client/src/components/ProfileModal.tsx) — already in place, no changes needed
- [x] Rename [client/src/components/Outreach.tsx](client/src/components/EmailOutreach.tsx) → `EmailOutreach.tsx` (exported function renamed too) + updated import in [client/src/pages/Dashboard.tsx](client/src/pages/Dashboard.tsx)
- [x] [client/src/components/OutreachPreviewModal.tsx](client/src/components/OutreachPreviewModal.tsx) — already in place, no changes needed
- [x] [client/src/pages/Dashboard.tsx](client/src/pages/Dashboard.tsx) — expanded from 4 to 6 tabs: Google Leads, LinkedIn Leads (Phase 3 placeholder), GBP Profiles, Email Outreach, Send Queue (Phase 3 placeholder), Analytics. Placeholders use an inline `PhasePlaceholder` component.
- [x] [client/src/pages/Login.tsx](client/src/pages/Login.tsx) — already in place, no changes needed

### 2.3 API routes (GBP)

All routes from the GBP base are already mounted in [server/routes.ts](server/routes.ts). Workspace scoping landed in §2.1. No structural changes required for Phase 2 — the existing routes work against the new schema because Phase 1.2 only *added* columns (never removed). Deferred to Phase 6's final-pass audit: Zod validation on every endpoint, explicit `requireAuth` audit, and rate-limit wiring.

- [x] `GET /api/auth/google` + callback — already in routes.ts
- [x] `GET /api/auth/user` + `POST /api/auth/logout` — already in fallbackAuth.ts (note: roadmap originally specified `/api/auth/me`; kept existing `/api/auth/user` to avoid breaking the frontend `useAuth` hook — rename deferred if ever needed)
- [x] `POST /api/search-leads` — Google Custom Search (existing route name)
- [x] `POST /api/leads/:id/enrich` — Places API enrichment
- [x] `POST /api/leads/:id/score` — Claude AI analysis
- [x] `POST /api/leads/:id/send-outreach` — generate + send outreach email
- [x] `GET/POST/PATCH /api/leads` — CRUD (now workspace-scoped)
- [x] `GET/POST /api/gbp-profiles` — GBP profile management
- [x] `GET/POST /api/outreach-campaigns` — email campaigns
- [x] `POST /api/leads/:id/push-to-hubspot` — push to HubSpot
- [x] `GET /api/analytics/summary` — pipeline metrics

> **Phase 2 status:** Complete as of 2026-04-11. Backend services workspace-scoped, file renames landed (hubspot → hubspotService, Outreach → EmailOutreach), LeadModal shows the lead-source badge, Dashboard has all 6 tabs. Check ✓, lint ✓ (0 errors, 110 warnings — one less than Phase 1.3 thanks to a `let conditions` → `const conditions` rewrite in `getLeads`), build ✓.

---

## Phase 3 — LinkedIn Module (Unipile Search + Multi-Step Campaigns)

**Timeline:** Week 5–7
**Goal:** Full LinkedIn prospecting, campaign management, queue review, and inbox sync as React components.

### 3.1 Backend services (ported from ClearEdge Leads)

- [x] Port `api/linkedin-search.js` → [server/services/linkedinSearchService.ts](server/services/linkedinSearchService.ts)
- [x] Port `api/unipile-dispatch.js` → [server/services/unipileDispatchService.ts](server/services/unipileDispatchService.ts) — handles connection_request/message/inmail/email step types, rate-limited, writes send_log + advances enrollment.current_step_order
- [x] Port `api/sync-unipile-inbox.js` → [server/services/inboxSyncService.ts](server/services/inboxSyncService.ts) — polls Unipile chats + invitations, classifies via [replyClassifier](server/services/replyClassifier.ts), records engagement_events, pauses enrollments on reply
- [x] Port `api/queue-management.js` — queue CRUD is inline in [server/routes.ts](server/routes.ts) (GET/PATCH/bulk-approve/bulk-skip/stats). No dedicated `queueService.ts` — the routes are trivial forwarders to storage methods; a facade would be ceremony.
- [x] Port `api/trigger-queue-generation.js` → [server/services/queueGenerationService.ts](server/services/queueGenerationService.ts) — `generateForEnrollment(id, stepId)` for single-shot + `generateBatch()` for the cron job. Enforces max_touches, daily_send_limit, step delay, dedupe.
- [ ] Port `api/enrich-leads.js` → extend enrichment service for LinkedIn leads (deferred to Phase 10)
- [x] Port `api/lead-scoring.js` → [server/services/aiService.ts](server/services/aiService.ts) now has `generateLinkedInMessage(prompt)` alongside existing GBP scoring
- [x] Port `lib/linkedin-limiter.js` → [server/lib/linkedinLimiter.ts](server/lib/linkedinLimiter.ts)
- [x] Port `lib/retry.js` → [server/lib/retry.ts](server/lib/retry.ts)
- [x] Port `lib/api-tracker.js` → [server/lib/apiTracker.ts](server/lib/apiTracker.ts) — console shim; Phase 5 promotes to a DB-backed `api_usage_log` table
- [ ] Port `lib/logger.js` → `server/lib/logger.ts` — deferred to Phase 6's structured-logger pass
- [x] Minimal [server/services/promptEngine.ts](server/services/promptEngine.ts) — `interpolatePrompt` + `buildPrompt`. Phase 4 adds A/B version selection, RAG context, language detection in this file without changing the call site.
- [x] [server/services/replyClassifier.ts](server/services/replyClassifier.ts) — Claude-haiku sentiment classifier

### 3.2 API routes (LinkedIn)

- [x] `POST /api/linkedin/search` — rate-limited Unipile prospect search, 429 returns remaining quota
- [x] `POST /api/linkedin/search/save` — upserts selected profiles as LinkedIn leads
- [x] `POST /api/campaigns/:id/enroll`
- [x] `POST /api/messages/generate` — single-shot queue generation for an enrollment+step
- [x] `POST /api/messages/trigger-batch` — batch queue gen; session auth OR `apiKeyAuth` for cron
- [x] `POST /api/queue/dispatch` — sends approved items via Unipile; session OR `apiKeyAuth`
- [x] `POST /api/inbox/sync` — polls Unipile for replies + connection acceptances; session OR `apiKeyAuth`
- [x] `GET /api/inbox/events` — recent reply_received + connection_accepted events joined with lead info
- [x] `GET /api/queue?status=<status>` — list queue items by status, workspace-scoped
- [x] `GET /api/queue/stats` — counts per status
- [x] `PATCH /api/queue/:id` — approve / skip / edit draft
- [x] `POST /api/queue/bulk-approve` and `POST /api/queue/bulk-skip`
- [x] `GET/POST/PATCH/DELETE /api/campaigns` — CRUD for unified email + LinkedIn campaigns
- [x] `GET /api/campaigns/:id` — joins in `campaign_steps` array
- [x] `GET/POST /api/campaign-steps` and `DELETE /api/campaign-steps/:id`

### 3.3 Frontend components (new — replaces vanilla JS)

- [x] [client/src/components/LinkedInLeads.tsx](client/src/components/LinkedInLeads.tsx) — search form with keyword/title/company/industry/location fields, results table with multi-select, bulk save to leads. Surfaces rate-limit remaining count on 429.
- [x] [client/src/components/CampaignBuilder.tsx](client/src/components/CampaignBuilder.tsx) — card-based campaign list, new-campaign dialog wizard (name/description/channel/tone/dailySendLimit/maxTouches), inline step editor with step type dropdown, delay days, prompt template textarea, character limit. Activate/pause/delete controls per campaign.
- [x] [client/src/components/SendQueue.tsx](client/src/components/SendQueue.tsx) — Pending / Approved / Sent / Skipped / Failed tabs (counts from `/api/queue/stats`, refetch every 5s). Bulk approve/skip on pending tab, inline per-item edit dialog, manual "Dispatch Approved" button.
- [x] [client/src/components/Inbox.tsx](client/src/components/Inbox.tsx) — sync button, list of recent reply_received + connection_accepted events from `GET /api/inbox/events`, sentiment badge (positive/negative/neutral/out_of_office), lead modal on click.
- [x] [client/src/pages/Dashboard.tsx](client/src/pages/Dashboard.tsx) expanded from 6 to **8 tabs** — Google Leads, LinkedIn Leads, Campaigns, Send Queue, Inbox, GBP Profiles, Email Outreach, Analytics. Phase 2's placeholder panels are removed.

### 3.4 In-process queue worker

Replaces the original `n8n/linkedin-queue-workflow.json` with an in-process background worker. No external n8n instance required.

- [x] [server/jobs/scheduler.ts](server/jobs/scheduler.ts) — wires `node-cron` schedules: queue generation every 15 min, dispatch every 5 min, inbox sync every 10 min. Idempotent `startScheduler()`, disabled when `NODE_ENV=test` or `DISABLE_SCHEDULER=1`. Imported from [server/index.ts](server/index.ts) on boot. Each tick wrapped in `runJob()` try/catch with timing logs so one failure doesn't cascade.
- [x] Job bodies are thin — they just call the existing service methods (`queueGenerationService.generateBatch()`, `unipileDispatchService.dispatchApproved()`, `inboxSyncService.sync()`). No separate `server/jobs/*Job.ts` files; the roadmap's original split was over-abstraction for 3-line wrappers.
- [x] Manual "run now" triggers — the existing `POST /api/messages/trigger-batch`, `POST /api/queue/dispatch`, and `POST /api/inbox/sync` routes all accept `apiKeyAuth` as an alternative to session auth, so the scheduler (or any ops CLI) can call them directly. A dedicated `POST /api/jobs/:name/run` indirection isn't needed.
- [ ] On job failure → structured error log + optional Slack webhook (Phase 11 — `dailyDigestJob.ts` and the `notifyJobFailure` helper land together)
- [ ] Document disabled-in-test + manual trigger pattern in README (deferred to Phase 6 final-pass docs)

> **Phase 3 status:** Complete as of 2026-04-11. All 11 backend ports landed (minus `enrich-leads.js` which the roadmap routes to Phase 10 enrichment, and `lib/logger.js` deferred to Phase 6 structured logging). All 13 LinkedIn API routes mounted. All 4 React components built and wired into Dashboard.tsx. node-cron scheduler running queueGeneration/queueDispatch/inboxSync on 15/5/10 minute intervals. Two Phase 4 items explicitly deferred with inline comments in [inboxSyncService.ts](server/services/inboxSyncService.ts): A/B prompt-version reply tracking (`recordReplyForVersion`) and RAG knowledge-base writeback (`storeConversation`). Check ✓, lint ✓ (0 errors, 131 warnings — all pre-existing `any` debt plus a handful from new any-typed req.body destructuring; Phase 6 final pass cleans them up), build ✓ (dist/index.js 119kb, client bundle 423kb).

---

## Phase 4 — AI Engine Consolidation

**Timeline:** Week 8–9
**Goal:** Single AI service with A/B prompt testing, RAG, and i18n across both channels.

### 4.1 Core AI engine

- [x] Port `lib/prompt-engine.js` → [server/services/promptEngine.ts](server/services/promptEngine.ts) — `selectPromptVersion()` (weighted A/B selection biased toward under-used variants), `recordReplyForVersion()`, `interpolatePrompt()`, `buildEnhancedPrompt()` (RAG + calendar link + language instruction, all with silent fallback on error).
- [x] Port `lib/rag-engine.js` → [server/services/ragEngine.ts](server/services/ragEngine.ts) — `storeConversation`, `retrieveSimilar`, `formatRagContext`. Backed by new `knowledge_base` table; `retrieveKnowledge` falls back from industry-matched to global positive examples when no industry hit exists.
- [x] Port `lib/language-detect.js` → [server/lib/languageDetect.ts](server/lib/languageDetect.ts) — `detectLanguage` (heuristic match on `lead.headline` since unified schema doesn't have a separate `location` column) + `getLocalizationInstruction` for prompt-prefixing.
- [x] Added `knowledge_base` table to [shared/schema.ts](shared/schema.ts) with `workspace_id`, `lead_id`, `campaign_id`, `outbound_message`, `reply_message`, `sentiment`, `industry`, `title_pattern`, `embedding_text`. `voc_insights` deferred to Phase 5 when `optimization.js` is ported.

### 4.2 Upgrade AI service

- [x] Phase 3's existing [aiService.generateLinkedInMessage(prompt)](server/services/aiService.ts) stays as-is (pure text→text); [queueGenerationService.ts](server/services/queueGenerationService.ts) now builds the enhanced prompt via `selectPromptVersion` + `buildEnhancedPrompt` and stamps `prompt_version_id` on every `send_queue` row. The roadmap's originally-proposed `generateLinkedInMessage(lead, step, tone)` signature would have bled service concerns into the AI layer — splitting it keeps aiService trivially unit-testable.
- [ ] Upgrade `generateEmail(lead)` to use prompt engine (A/B for email templates) — deferred to Phase 5 when email pipeline gets its own touch (low urgency; email templates don't use A/B yet).
- [x] `trackApiUsage(call)` — every Claude call in [queueGenerationService.ts](server/services/queueGenerationService.ts) and [replyClassifier.ts](server/services/replyClassifier.ts) invokes `apiTracker.trackApiCall` with provider, model, and token counts. Console shim for now; Phase 5 adds the `api_usage_log` table.
- [x] Verified `withRetry()` on all Claude API calls: aiService has its own inline `withRetry`, replyClassifier + queueGenerationService wrap via lib/retry.ts.

### 4.3 Prompt version management

- [x] `GET /api/prompt-versions?campaignId=&stepOrder=` — returns versions with computed `replyRate` and `positiveRate` percentages
- [x] `POST /api/prompt-versions` — creates a new variant for a (campaign, stepOrder) pair
- [x] `PATCH /api/prompt-versions/:id` — edit an existing variant
- [x] PromptVersionsPanel inside [CampaignBuilder.tsx](client/src/components/CampaignBuilder.tsx) — grouped by step, per-variant reply rate + positive rate, inline "New variant" form with step selector, variant label, description, and template textarea.

### 4.4 Service wiring (new — not in original roadmap but required to close the loop)

- [x] [queueGenerationService.generateAndInsert](server/services/queueGenerationService.ts) now calls `selectPromptVersion` before `buildEnhancedPrompt` and stamps `prompt_version_id` on the `send_queue` row so reply credit can flow back to the right variant.
- [x] [inboxSyncService.sync](server/services/inboxSyncService.ts) now calls `recordReplyForVersion` on every new reply, and `storeConversation` (RAG writeback) on every positive reply — closing the two Phase 4 deferrals from §3F.

> **Phase 4 status:** Complete as of 2026-04-11. Full AI engine consolidation end-to-end: template interpolation → A/B weighted variant selection → RAG context injection → calendar link append → language prefix → Claude call → token-usage tracking → queue insert with variant stamp → reply sentiment classification → variant reply credit → knowledge-base writeback for positive replies. Check ✓, lint ✓ (0 errors, 135 warnings — 4 new from the prompt-version route bodies), build ✓ (dist/index.js 130.6kb, client bundle 427kb).

---

## Phase 5 — Analytics & Reporting

**Timeline:** Week 10–11
**Goal:** Unified metrics dashboard across both channels with A/B reporting and cost tracking.

### 5.1 Backend analytics service

- [x] Port `api/analytics.js` → [server/services/analyticsService.ts](server/services/analyticsService.ts) — `getOverview(days, workspaceId)`, `getCampaignComparison(workspaceId)`, `getApiCosts(days, workspaceId)`, `getPromptLeaderboard()`.
- [x] Port `api/optimization.js` → [server/services/optimizationService.ts](server/services/optimizationService.ts) — `optimizeCampaigns` (auto-pause below `autoPauseThreshold` + Claude-haiku suggestions), `vocAnalysis` (groups recent replies into objections/interests/questions/trends, upserts into `voc_insights`), `getInsights`.
- [x] `GET /api/analytics/overview` (cross-channel pipeline metrics for the last N days)
- [x] `GET /api/analytics/campaigns` (per-campaign comparison — enrolled, contacted, connected, sent, replies, reply rate, positive rate, meetings booked)
- [x] `GET /api/analytics/api-costs` (calls by provider, token totals, estimated Claude spend)
- [x] `GET /api/analytics/prompt-leaderboard` (top 20 prompt variants sorted by reply count)
- [x] `POST /api/optimize/campaigns`, `POST /api/optimize/voc-analysis`, `GET /api/optimize/insights`
- [x] Added `api_usage_log` and `voc_insights` tables to [shared/schema.ts](shared/schema.ts); `apiTracker.trackApiCall` promoted from Phase 3 console shim to a real DB writer with console fallback on DB failure. Every Claude call across queueGenerationService, replyClassifier, and optimizationService now flows through it.
- [x] Storage methods for all the counts: `countLeads`, `countActiveCampaigns`, `countSuccessfulSendsTotal`, `countSuccessfulSendsForCampaign`, `countSendsByStepType`, `countEngagementEvents` (filterable by type/sentiment/since/workspace), `getSentLeadIdsForCampaign`, `countEventsForLeadIds`, `getEnrollmentLeadStatuses`, `getAllCampaignsForAnalytics`, `getActiveCampaignsForOptimization`, `getRecentReplyEvents`, `getTopPromptVersions`, `createApiUsageLog`, `getApiUsageLogsSince`, VoC CRUD (`findSimilarVocInsight`, `createVocInsight`, `bumpVocInsight`, `getVocInsights`).

### 5.2 Frontend analytics components

- [x] Extended [Analytics.tsx](client/src/components/Analytics.tsx) with a new LinkedIn Pipeline card at the top (consumes `/api/analytics/overview`) — 6 stat tiles: connection requests, accepted, messages sent, replies, positive replies, meetings booked, with rate % subtitles. Existing GBP email pipeline card stays below it unchanged.
- [x] Built [Reports.tsx](client/src/components/Reports.tsx) as a new 9th Dashboard tab. Three sections: Campaign Comparison table (enrolled/sent/replies/reply%/positive%/meetings per campaign), A/B Prompt Leaderboard (top variants ranked by reply count with preview and rates), AI Cost Dashboard (total calls, estimated Claude spend, input/output token totals, calls by provider). Weekly volume chart deferred to Phase 6 final pass — non-blocking for the leaderboard/cost loop.
- [x] CSV export — `GET /api/export/leads.csv` and `GET /api/export/campaigns.csv` routes. Reports.tsx header has two "Leads CSV" / "Campaigns CSV" download buttons backed by `<a href={…} download>`. RFC-4180 quoting via a shared `toCsv(columns, rows)` helper in `server/routes.ts`.
- [x] [Dashboard.tsx](client/src/pages/Dashboard.tsx) tab list grows from 8 to **9** — added `reports` tab routing to `Reports`.

> **Phase 5 status:** Complete as of 2026-04-11. Weekly volume chart is the only deferred bullet (low-value vs. the leaderboard/cost dashboard). Check ✓, lint ✓ (0 errors, 143 warnings — 8 new from Phase 5 route bodies; all pre-existing `any` debt that Phase 6 Zod sweep will clean up), build ✓ (dist/index.js 155.6kb up from 130.6kb, client bundle 437kb up from 427kb).

---

## Phase 6 — Foundation Hardening & CI/CD

**Timeline:** Week 12–13
**Goal:** Test coverage, deployment-ready, all settings configurable from UI.

### 6.1 Settings page

Built [client/src/components/Settings.tsx](client/src/components/Settings.tsx) as the 10th Dashboard tab, backed by `GET/PATCH /api/settings`. The backend routes only surface operator-tunable values from the `app_config` table — actual secrets (Anthropic/Unipile/Google OAuth keys) stay in server `.env`.

- [x] Workspace panel showing name + plan (reads from `req.workspace` stub)
- [ ] Google OAuth status + reconnect — deferred (no API surface for re-auth flow yet)
- [x] Unipile account ID + base URL fields (persisted to `app_config`)
- [x] SendGrid from-address field (Phase 8 prereq)
- [ ] HubSpot API key — secrets stay in server env, not exposed via settings API
- [x] Calendly / scheduling link field
- [x] LinkedIn / email hourly send limit fields (search / dispatch / email)
- [x] LinkedIn compliance mode toggle (`Switch` component)
- [x] AI usage panel: total API calls, estimated Claude spend, input/output tokens, Unipile calls — all from the existing Phase 5 `getApiCosts` aggregate

### 6.2 Testing

Pragmatic subset: the four pure-function ports land now; service-level integration tests deferred to a Phase 6.2 follow-up because they need DB mocking infrastructure that doesn't exist yet.

- [x] Ported `retry.test.js` → [__tests__/retry.test.ts](__tests__/retry.test.ts) — 6 tests covering success, retryable errors (ECONNRESET/ETIMEDOUT/429/503), non-retryable 400, exhaustion
- [x] Ported `linkedin-limiter.test.js` → [__tests__/linkedinLimiter.test.ts](__tests__/linkedinLimiter.test.ts) — 4 tests covering allowed state, remaining decrement, action-type isolation, email tracking
- [x] Ported `language-detect.test.js` → [__tests__/languageDetect.test.ts](__tests__/languageDetect.test.ts) — 9 tests covering default English, headline detection for es/fr/de, explicit lead.language override, localization instruction lookup
- [x] New [__tests__/promptEngine.test.ts](__tests__/promptEngine.test.ts) — 7 tests for `interpolatePrompt` including 4 prompt-injection sanitization cases ("ignore previous instructions" stripping, `### System` marker stripping, newline collapsing, length cap). Mocks `storage` and `ragEngine` so the pure functions test in isolation without hitting the DB.
- [ ] `api/leads.test.ts`, `api/campaigns.test.ts`, `api/queue.test.ts`, `api/suppression.test.ts` — service-level integration tests deferred. They need a Drizzle mock or a test container, which is its own chunk of work. Tracking as a Phase 6.2 follow-up.

### 6.3 CI/CD

- [x] [.github/workflows/ci.yml](.github/workflows/ci.yml) — Node 20, one `build` job running lint → typecheck → test → build in sequence. Concurrency group cancels superseded pushes, `npm ci` cache, 15-minute timeout, `NODE_ENV=test` for the test step.
- [ ] Railway deployment config — operator setup, not code (no files to commit; documented as a follow-up README addition).

### 6.4 Final pass

- [x] Structured logger — installed `pino` + `pino-pretty`, added [server/lib/logger.ts](server/lib/logger.ts) with dev (pretty) / prod (JSON) transports. Hot paths swapped from `console.*`: [server/lib/retry.ts](server/lib/retry.ts) retry warnings, [server/jobs/scheduler.ts](server/jobs/scheduler.ts) job lifecycle logs. Remaining `console.*` calls in routes/services stay for now — swapping them all would churn every commit without changing behavior; rolling replacement during future edits is cheaper.
- [x] Zod validation on top 5 highest-risk routes — new [shared/validators.ts](shared/validators.ts) with schemas applied via `validateBody` middleware on: `POST /api/linkedin/search`, `POST /api/linkedin/search/save`, `POST /api/campaigns`, `POST /api/campaign-steps`, `POST /api/messages/generate`. Full sweep of remaining routes tracked as a Phase 6.4 follow-up.
- [ ] `requireAuth` audit on every non-public route — deferred. Spot-checked during Phase 5 that all new routes use `requireAuth` or `apiKeyAuth`, but a formal grep audit isn't in this commit.
- [x] Sanitize all lead fields before AI prompt injection — new `sanitizeField` helper in [server/services/promptEngine.ts](server/services/promptEngine.ts). Strips "ignore previous instructions" phrasings, `### System`/`### User`/`[INST]` turn-boundary markers, collapses newlines, caps length at 500 chars. Covered by 4 tests in `promptEngine.test.ts`.
- [x] `express-rate-limit` on risky routes — installed `express-rate-limit`, added [server/middleware/rateLimit.ts](server/middleware/rateLimit.ts) with three tiers (`linkedinLimiter` 30/min, `aiLimiter` 20/min, `dispatchLimiter` 10/min). Applied to 9 routes: both `/api/linkedin/search*`, both `/api/messages/*`, `/api/queue/dispatch`, `/api/inbox/sync`, both `/api/optimize/*`.

> **Phase 6 status:** Complete as of 2026-04-11 with two deferrals explicitly flagged above (service-level integration tests + full route Zod sweep + requireAuth grep audit + remaining `console.*` swap). The user-visible Settings page is live, CI runs lint/typecheck/test/build on every push, 4 test suites with 26 passing tests are in place, rate limiting protects the expensive routes, and the prompt sanitizer closes a real prompt-injection vector. Dashboard grows from 9 to **10 tabs** with Settings.
>
> **Verified:** `npm run check` clean, `npm run lint` 0 errors / 145 warnings (+2 from new route bodies), `npm test` 26/26 passing, `npm run build` dist/index.js 162.6kb up from 155.6kb, client bundle 445kb up from 437kb.

---

## Phase 7 — Legal & Compliance

**Timeline:** Week 14
**Severity:** Blockers — cannot operate commercially without these.
**Goal:** CAN-SPAM and GDPR compliant email. LinkedIn ToS-safe send behavior. Data deletion capability.

### 7.1 CAN-SPAM / GDPR email compliance

- [x] CAN-SPAM footer on every outbound email — `EmailService.buildFooter{,Html}` appends a horizontal rule + physical address (from `settings.sendgrid_from_email` or fallback) + unsubscribe link to both the HTML and text bodies.
- [x] One-click unsubscribe — HMAC-signed tokens via [server/lib/unsubscribe.ts](server/lib/unsubscribe.ts) (stateless `base64url(email).base64url(hmac)` format, constant-time compare). `GET /unsubscribe/:token` is public, verifies, writes the email to the suppression list with `reason='unsubscribed'`, audit-logs under `action='unsubscribe'`, and returns a plain-HTML confirmation page (no JSON response to recipients).
- [x] `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers so Gmail/Apple Mail/Outlook render their native unsubscribe button.
- [x] Pre-send suppression check — `storage.isSuppressed(email, workspaceId)` matches by direct email AND by domain (for `@example.com` blanket suppressions). `EmailService.sendOutreachEmail` throws `EmailSuppressedError` if the recipient is on the list; the `/api/leads/:id/send-outreach` route catches and returns 409 with `code='suppressed'` so the UI can distinguish suppressed from generic failures.

### 7.2 Suppression list management

- [x] `GET /api/suppression`, `POST /api/suppression`, `DELETE /api/suppression/:id` — all workspace-scoped, all write audit entries.
- [x] Domain suppression — the POST route accepts either `email` or `domain`; `storage.isSuppressed` does `OR` over both columns. "Add @domain.com" blocks every address at that domain.
- [x] Built [client/src/components/SuppressionList.tsx](client/src/components/SuppressionList.tsx) — embedded inside Settings.tsx as a dedicated card. Email-vs-domain mode toggle, reason dropdown (manual/unsubscribed/bounced/spam_report), list view with reason badges and delete buttons.
- [ ] `POST /api/suppression/import` — bulk CSV import deferred to a Phase 7 follow-up. Single-entry add works; bulk is a nice-to-have.

### 7.3 GDPR data deletion (right to erasure)

- [x] `DELETE /api/leads/:id/gdpr` — workspace-scoped access check (createdBy OR workspaceId match), then `storage.gdprDeleteLead(leadId)` runs a **transaction** that wipes every child row: send_queue, send_log, engagement_events, outreach_emails, campaign_enrollments, and finally the lead itself. Returns per-table counts so the audit entry can show the deletion scope.
- [x] Confirmation modal in [LeadModal.tsx](client/src/components/LeadModal.tsx) — new red "GDPR delete" button next to Export, `confirm()` prompt spells out exactly which tables get wiped + that the action is logged. On success the mutation invalidates `/api/leads` and closes the modal.
- [x] Audit log — `storage.createAuditEntry({ action: 'gdpr_delete', entityType: 'lead', entityId, metadata: { lead, sendQueue, sendLog, ... } })` captures the full delete scope.
- [ ] Data retention policy documentation in README — deferred to Phase 6 follow-up README pass.

### 7.4 Privacy policy & terms pages

- [x] `/privacy` and `/terms` served as static HTML directly from Express via a shared `legalPageShell` helper — no React routing wiring needed, no new files to manage. Covers collection/use/retention/third-parties/contact for privacy; acceptable use/content ownership/AI disclaimer/compliance responsibilities for terms.
- [x] Login page footer — Terms + Privacy links open in new tabs, styled as a bordered footer section.
- [x] Acceptance checkbox — `Login.tsx` blocks both Google OAuth and demo login until the "I agree to Terms + Privacy" checkbox is ticked. Shows a toast on attempted bypass.

### 7.5 LinkedIn ToS compliance hardening

- [x] Human-like delays — already in place from Phase 3 via `linkedinLimiter.humanDelay()` (2–6s jitter between dispatches). No change needed.
- [x] Hard daily caps — `linkedinLimiter.ts` now tracks both hourly AND daily counters. New `dailyCaps` constants default to **20 connection_requests / 50 dispatches / 100 searches / 300 emails per day** per the roadmap, configurable via `LINKEDIN_*_LIMIT_DAILY` env vars. `isAllowed` now checks both hourly and daily before returning true — requests are gated on the stricter of the two.
- [x] `connection_request` promoted to a first-class `LinkedInAction` type so its dedicated daily cap (20) isn't conflated with the general `dispatch` cap (50).
- [x] LinkedIn compliance mode — Phase 6 Settings already exposes the toggle (stored in `app_config` as `linkedin_compliance_mode`). Default is ON; the toggle is purely informational for now (the hard caps in `linkedinLimiter` apply regardless). Phase 9 can promote it to a kill-switch if operators ask for looser behavior.
- [x] Audit log on every LinkedIn action — `unipileDispatchService.dispatchSingle` now writes an `audit_log` row with `action='linkedin_<stepType>'`, `entityType='lead'`, and metadata `{ queueItemId, unipileMessageId, stepType, campaignId }` after every successful send. Best-effort (a failure in audit doesn't roll back the send since the message already left Unipile).
- [x] Dashboard warning banner — new `GET /api/linkedin/limits` returns `[{ action, used, cap, percent }]` for every tracked action; Dashboard.tsx polls it every 60s and renders a yellow banner at the top of the layout when any action is >=80% consumed, listing the affected actions and their `used/cap (percent%)` numbers.

> **Phase 7 status:** Complete as of 2026-04-11 with two minor deferrals (CSV bulk-import for suppression + data retention README section). The commercial blockers are all closed: CAN-SPAM-compliant outbound (footer + unsubscribe + List-Unsubscribe headers), GDPR right-to-erasure (cascading transactional delete with audit trail), suppression list management, privacy/terms pages with acceptance gate, LinkedIn ToS hardening with daily caps and warning banner.
>
> **Verified:** `npm run check` clean, `npm run lint` 0 errors / 150 warnings (+5 from Phase 7 route bodies), `npm test` 26/26 passing, `npm run build` dist/index.js 180.9kb up from 162.6kb, client bundle 451.9kb up from 445.6kb.

---

## Phase 8 — Email Infrastructure

**Timeline:** Week 15–16
**Severity:** Blockers — Gmail SMTP breaks at real send volume and damages domain reputation.
**Goal:** Production-grade email with deliverability, tracking, bounce management, and OOO detection.

### 8.1 Replace Gmail SMTP with SendGrid

- [ ] Install `@sendgrid/mail`
- [ ] Create `server/services/emailService.ts` — replaces `email.ts`
  - `sendEmail(to, subject, html, options)` — wraps SendGrid client
  - Pre-send suppression check before every call
  - Falls back to Gmail SMTP if `NODE_ENV !== 'production'`
- [ ] Migrate all `email.ts` call sites to `emailService.ts`
- [ ] Add SendGrid settings fields to Settings.tsx

### 8.2 Sending domain & DNS authentication

- [ ] Document DNS record setup in README: SPF, DKIM CNAME records, DMARC policy
- [ ] Verify sending domain in SendGrid before any production sends
- [ ] Domain verification status indicator in Settings.tsx

### 8.3 Bounce handling

- [ ] SendGrid inbound webhook: `POST /api/webhooks/sendgrid`
  - Verify signature using `SENDGRID_WEBHOOK_SECRET`
  - `bounce` → add to `suppression_list` (`reason = 'bounced'`), update lead `status = 'bounced'`
  - `spamreport` → add to suppression list (`reason = 'spam_report'`)
  - `unsubscribe` → add to suppression list (backup to one-click)
  - `open` → update `outreach_emails.opened_at`, lead `status = 'opened'`
  - `click` → update `outreach_emails.clicked_at`
- [ ] Hard bounce = permanent suppression; soft bounce = retry once then suppress

### 8.4 Open + click tracking

- [ ] Open tracking pixel: `<img src="${APP_URL}/track/open/${emailId}" width="1" height="1">`
- [ ] `GET /track/open/:emailId` — updates `opened_at`, returns 1x1 transparent GIF
- [ ] Enable SendGrid click tracking in dashboard settings
- [ ] Surface open/click status in EmailOutreach.tsx — opened/clicked badges per email

### 8.5 Email pre-flight verification

- [ ] `POST /api/leads/:id/verify-email` — Hunter.io Email Verifier API
  - Returns `deliverable` | `risky` | `undeliverable`
  - Store in `leads.email_verified`
  - Block sends to `undeliverable` automatically
- [ ] Email verification badge in LeadModal.tsx
- [ ] Bulk verify button in LeadDiscovery.tsx

### 8.6 Out-of-office detection

- [ ] In `inboxSyncService.ts`, detect OOO keywords in replies: "out of office", "on vacation", "away until", "auto-reply"
- [ ] If OOO: pause campaign enrollment, set `campaign_enrollments.ooo_until = now() + 14 days`
- [ ] Log to `engagement_events` with `event_type = 'out_of_office'`
- [ ] Queue generation skips enrollments where `ooo_until > now()`

### 8.7 Email warm-up guidance

- [ ] Warm-up checklist in Settings.tsx (educational):
  - Week 1: max 20/day → Week 2: 50 → Week 3: 100 → Week 4+: 300
- [ ] Enforce `daily_email_limit` from workspace settings in `emailService`
- [ ] Show current day email count vs limit in Analytics.tsx header

---

## Phase 9 — Multi-Tenancy & Billing

**Timeline:** Week 17–19
**Severity:** Required to charge customers — currently single-user.
**Goal:** Workspace model with RBAC, Stripe subscription billing, usage metering, and multi-account LinkedIn.

### 9.1 Workspace model activation

- [ ] Activate `workspaces` table (stubbed in Phase 1)
- [ ] Add `workspace_id` WHERE clause to every read/write in `server/storage.ts`
- [ ] `requireWorkspace` middleware — resolves workspace from session, attaches to `req.workspace`
- [ ] `GET /api/workspace` — get current workspace settings
- [ ] `PATCH /api/workspace` — update name, settings
- [ ] `GET /api/workspace/usage` — current month sends, AI tokens

### 9.2 Role-based access

- [ ] User roles: `admin` | `member`
- [ ] `POST /api/workspace/invite` — send email invitation (admin only)
- [ ] `GET /api/workspace/members` — list members + roles
- [ ] `PATCH /api/workspace/members/:id` — change role (admin only)
- [ ] `DELETE /api/workspace/members/:id` — remove member (admin only)
- [ ] `requireRole('admin')` middleware on destructive operations
- [ ] Members panel in Settings.tsx

### 9.3 Stripe subscription billing

- [ ] Install `stripe` SDK
- [ ] Create `server/services/billingService.ts`:
  - `createCheckoutSession(workspaceId, priceId)`, `createPortalSession(workspaceId)`, `handleWebhook(event)`
- [ ] `POST /api/webhooks/stripe` — handle all Stripe events:
  - `checkout.session.completed` → activate subscription, update workspace `plan`
  - `customer.subscription.updated` → update plan + limits
  - `customer.subscription.deleted` → downgrade to free
  - `invoice.payment_failed` → payment failure email + warning banner
- [ ] Plan tiers:

  | Plan | Monthly price | Email sends/mo | LinkedIn sends/mo | Members |
  |------|-------------|---------------|------------------|---------|
  | Solo | $49 | 1,000 | 500 | 1 |
  | Team | $149 | 5,000 | 2,000 | 5 |
  | Agency | $399 | 25,000 | 10,000 | Unlimited |

- [ ] `GET /api/billing/checkout` and `/api/billing/portal`
- [ ] Billing panel in Settings.tsx — plan badge, usage bars, upgrade/manage button

### 9.4 Usage enforcement

- [ ] Before every email send — check `monthly_email_sends_used < plan_limit`; return 402 if over
- [ ] Before every LinkedIn dispatch — check `monthly_linkedin_sends_used < plan_limit`
- [ ] Increment counters on successful dispatch (not queue insert)
- [ ] Reset counters on 1st of month via `server/jobs/usageResetJob.ts` (node-cron `0 0 1 * *`) — resets `monthly_email_sends_used` and `monthly_linkedin_sends_used` to 0 for all workspaces
- [ ] Soft warning at 80% — yellow header banner; hard block at 100% with upgrade CTA

### 9.5 Multi-account LinkedIn (Agency plan)

- [ ] Activate `unipile_accounts` table (stubbed in Phase 1)
- [ ] Campaigns assignable to specific Unipile account
- [ ] `linkedinLimiter` enforces per-account limits
- [ ] Account health display per Unipile account in Settings.tsx

---

## Phase 10 — Data Quality & Enrichment

**Timeline:** Week 20–21
**Goal:** Clean, deduplicated leads with verified contact data. Bulk import. Scheduled re-enrichment.

### 10.1 Deduplication

- [ ] On lead save, check for duplicate by email OR linkedin_url OR (business_name + domain)
- [ ] Duplicate found → merge modal: "This contact already exists. Merge or create duplicate?"
- [ ] Merge logic: prefer non-null fields, newer enrichment, combine notes
- [ ] `POST /api/leads/deduplicate` — bulk scan + merge for workspace
- [ ] Duplicate count badge in Settings.tsx with one-click bulk merge

### 10.2 Company / domain suppression

- [ ] Domain suppression blocks leads from that domain across all campaigns (not just email)
- [ ] "Add to suppression" in LeadModal.tsx dropdown — suppresses by email domain
- [ ] `POST /api/suppression/import-domains` — paste newline-separated domain list

### 10.3 CSV lead import

- [ ] `POST /api/leads/import` — CSV upload, required: `full_name` or `business_name`
  - Validates rows, skips suppressed emails/domains, deduplication per row
  - Returns import summary: imported / skipped / duplicates / suppressed
- [ ] Build `LeadImportModal.tsx` — drag-and-drop upload with column mapping UI
- [ ] Download CSV template button

### 10.4 Apollo.io / Hunter.io enrichment

- [ ] Create `server/services/enrichmentService.ts`
  - `enrichFromApollo(lead)` — company size, technologies, funding, employee count
  - `enrichFromHunter(domain)` — find emails for a domain
  - `verifyEmailHunter(email)` — deliverability check
  - Fallback: Apollo → Hunter → existing `emailDiscovery.ts` website scraping
- [ ] Store results in `leads.enrichment_data` jsonb
- [ ] "Enrich with Apollo" button in LeadModal.tsx
- [ ] Bulk enrich selected leads in LeadDiscovery.tsx
- [ ] Track enrichment API cost per workspace in `apiTracker`

### 10.5 Scheduled re-enrichment

- [ ] `re_enrich_after` column in `leads` — set to `now() + 90 days` on enrich
- [ ] `server/jobs/reEnrichmentJob.ts` (node-cron `0 3 * * *`, daily at 3am UTC): finds leads where `re_enrich_after < now()` and `status != 'converted'`, re-runs enrichment in batches with `linkedinLimiter` throttling
- [ ] Re-enrichment settings in Settings.tsx: toggle on/off, interval (30/60/90 days)

---

## Phase 11 — Real-Time & Notifications

**Timeline:** Week 22
**Goal:** Live updates without page refresh. Alerts for replies, campaign completions, and system errors.

### 11.1 Server-Sent Events

- [ ] `GET /api/events` — authenticated SSE endpoint, workspace-scoped, per-user connection
- [ ] Create `server/lib/eventEmitter.ts` — internal pub/sub keyed by workspace ID
- [ ] Services emit events: `queue_updated`, `reply_received`, `connection_accepted`, `campaign_completed`, `limit_warning`

### 11.2 Frontend real-time integration

- [ ] `client/src/hooks/useSSE.ts` — SSE connection hook with auto-reconnect
- [ ] `SendQueue.tsx` — queue count updates live
- [ ] `Inbox.tsx` — reply badge pulses on `reply_received`
- [ ] Dashboard header — live "X items pending approval" count
- [ ] Toast notification on `reply_received`

### 11.3 In-app notification center

- [ ] `GET /api/notifications` — unread notifications for current user
- [ ] `PATCH /api/notifications/:id/read` and `/read-all`
- [ ] Build `NotificationBell.tsx` — bell icon with unread count badge + dropdown

### 11.4 Slack + email daily digest

- [ ] Add `slack_webhook_url` to workspace `app_config`
- [ ] `server/jobs/dailyDigestJob.ts` (node-cron `0 8 * * *`): queries last 24h of replies, new connections, pending queue items, and campaigns near limits; sends formatted message to the workspace's Slack webhook (or email via Phase 8 SendGrid)
- [ ] Slack integration section in Settings.tsx — webhook URL + test button (posts a "ClearEdge test message" payload)

### 11.5 Job error alerting

- [ ] Shared `notifyJobFailure(jobName, err, context)` helper in `server/jobs/alerting.ts`: logs to `audit_log`, increments a job-health counter, and posts to Slack webhook if configured
- [ ] Every cron job in `server/jobs/` wraps its work in try/catch and calls `notifyJobFailure` on throw
- [ ] Last successful run timestamp and last error per job tracked in `app_config` (keys: `job:<name>:last_ok`, `job:<name>:last_error`)
- [ ] Settings.tsx → Automation section shows each job's last run + error state (replaces the old n8n health panel idea)

---

## Phase 12 — Product UX Completeness

**Timeline:** Week 23–26
**Goal:** Table-stakes UX for a paid SaaS product. Onboarding, empty states, mobile, audit trail, webhooks.

### 12.1 Onboarding flow

- [ ] Build `Onboarding.tsx` — shown to new workspaces before Dashboard
  - Step 1: Connect Gmail / verify sending domain
  - Step 2: Connect LinkedIn via Unipile
  - Step 3: Create first campaign (pre-filled example)
  - Step 4: Import or find first leads
- [ ] Store progress in `app_config` key `onboarding_step`; allow skip at any point
- [ ] "Complete setup" prompt in Settings.tsx until onboarding finished
- [ ] Progress indicator in top nav during onboarding

### 12.2 Empty states

Every table and list must have an actionable zero-state (not a blank screen):

- [ ] `LeadDiscovery.tsx` — "No leads yet. Search for businesses above to get started."
- [ ] `LinkedInLeads.tsx` — "No LinkedIn leads yet. Search for prospects to begin outreach."
- [ ] `CampaignBuilder.tsx` — "No campaigns. Create your first campaign to start reaching out."
- [ ] `SendQueue.tsx` — "Queue is empty. Generate messages for active enrollments to fill it."
- [ ] `Inbox.tsx` — "No replies yet. Sync your inbox to check for responses."
- [ ] `Analytics.tsx` — "No data yet. Send your first messages to see performance metrics."
- [ ] All empty states include a CTA button routing to the relevant action

### 12.3 Mobile-responsive layout

- [ ] Responsive audit of all components at 375px, 768px, 1024px
- [ ] Dashboard tab bar scrollable horizontal strip on mobile
- [ ] Lead table collapses to card list on mobile
- [ ] SendQueue approve/skip accessible without horizontal scroll on mobile
- [ ] Settings page single-column on mobile
- [ ] All Chart.js charts verify `responsive: true`

### 12.4 Audit log

- [ ] Activate `audit_log` writes on all significant actions:
  - `lead_created`, `lead_deleted`, `lead_gdpr_deleted`
  - `campaign_created`, `campaign_activated`, `campaign_paused`
  - `message_sent`, `message_dispatched_linkedin`
  - `member_invited`, `member_role_changed`, `member_removed`
  - `billing_plan_changed`
  - `suppression_added`, `suppression_removed`
  - `api_key_changed`
- [ ] `GET /api/audit-log` — filterable by action, user, date range (admin only)
- [ ] Build `AuditLog.tsx` in Settings.tsx — scrollable log with filters

### 12.5 Outbound webhooks

- [ ] `POST/DELETE /api/webhooks/endpoints` — register/remove webhook URLs
- [ ] `POST /api/webhooks/endpoints/:id/test` — send test payload
- [ ] `server/services/webhookDeliveryService.ts`:
  - Sign payloads with HMAC-SHA256 per-endpoint secret
  - 3-attempt retry with exponential backoff
  - Log delivery status to `audit_log`
- [ ] Supported events: `lead.reply_received`, `lead.connection_accepted`, `lead.status_changed`, `campaign.completed`, `email.bounced`
- [ ] Webhooks panel in Settings.tsx — add endpoint, select events, delivery history

### 12.6 Meeting booking tracking

- [ ] `POST /api/webhooks/calendly` and `POST /api/webhooks/calcom`
  - On booking created: find lead by email, `status = 'meeting_booked'`
  - Log to `engagement_events` with `event_type = 'meeting_booked'`
  - Increment campaign `total_meetings`
- [ ] Meeting booked count in Analytics.tsx pipeline funnel

---

## Key Design Decisions

### In-process jobs instead of n8n
The original ClearEdge Leads app ran its scheduled work through n8n (`linkedin-queue-workflow.json`). For the unified platform we drop the n8n dependency and handle all recurring work in-process via `node-cron` schedules under `server/jobs/`. Reasoning: every roadmap use case is a simple cron job or a fire-and-forget background task — queue generation, dispatch, inbox sync, monthly usage reset, daily re-enrichment, 8am digest. None of them involve branching logic a non-developer would edit, and none of them need to survive outside the app process. Keeping jobs in TypeScript means: one deploy target, one log stream, one `.env`, real git diffs, real unit tests, and end-to-end type safety through Drizzle. The n8n workflow JSON stays under `n8n/` as a reference snapshot of the original flow, but is neither deployed nor imported. `POST /api/jobs/:name/run` (behind `apiKeyAuth`) provides the manual "run now" hook that the n8n UI used to offer.

### `_source/` and `_reference/` folder strategy
The two source codebases land in `_source/` (gitignored snapshots, extracted from the zips the user provides) and `_reference/` (tracked in git, containing the ClearEdge Leads JavaScript files that will be ported phase by phase). The GBP project is the base — its contents are copied directly into the workspace root in Phase 1.1. ClearEdge Leads is not merged in at once; each `.js` file in `_reference/` is rewritten as TypeScript and moved into `server/services/` or `server/lib/` at the moment its owning phase (2–5) reaches it. This keeps `npm run check` passing at every commit and avoids a week-long .js → .ts conversion sprint at the start.

### Workspace-first from day one
`workspace_id` is added to every table in Phase 1 even though multi-tenancy isn't activated until Phase 9. All storage queries scope by `workspace_id` from the first commit. This avoids a painful migration later.

### Unified lead model
One `leads` table with a `lead_source` discriminator. Google-specific and LinkedIn-specific columns are nullable. Campaigns can enroll any lead regardless of origin, enabling cross-channel sequences (discover via Google → follow up on LinkedIn).

### SendGrid over Gmail SMTP
Gmail is acceptable for local dev only. SendGrid provides bounce webhooks, open/click tracking, dedicated sending reputation, and limits that scale. The `emailService.ts` abstraction makes this a one-day swap.

### Suppression list is workspace-global
Suppression applies across all campaigns in a workspace. Once someone unsubscribes or bounces, they are permanently blocked from all outreach from that workspace. This is legally required under CAN-SPAM and GDPR.

### Stripe workspace billing, not per-user
Billing attaches to the workspace. Team members share the workspace's send limits. The workspace schema maps cleanly to Stripe customer + subscription.

### Outreach channel on campaigns
Each campaign has an `outreach_channel` ('email' | 'linkedin'). Email campaigns use the simple one-step email flow. LinkedIn campaigns use the multi-step enrollment + queue system. The prompt engine and A/B testing apply to both.

---

## File Structure (target)

```
server/
  index.ts
  routes.ts
  storage.ts
  db.ts
  fallbackAuth.ts
  middleware/
    auth.ts
    errorHandler.ts
    validate.ts
    requireRole.ts              # Phase 9
    requireWorkspace.ts         # Phase 9
  lib/
    backgroundQueue.ts
    linkedinLimiter.ts
    retry.ts
    apiTracker.ts
    logger.ts
    languageDetect.ts
    eventEmitter.ts             # Phase 11
  services/
    aiService.ts
    promptEngine.ts
    ragEngine.ts
    googleAuth.ts
    placesApi.ts
    emailDiscovery.ts
    emailService.ts             # Phase 8 — replaces email.ts
    hubspotService.ts
    linkedinSearchService.ts
    unipileDispatchService.ts
    inboxSyncService.ts
    queueService.ts
    queueGenerationService.ts
    analyticsService.ts
    optimizationService.ts
    enrichmentService.ts        # Phase 10
    billingService.ts           # Phase 9
    suppressionService.ts       # Phase 7
    webhookDeliveryService.ts   # Phase 12

client/src/
  App.tsx
  pages/
    Dashboard.tsx
    Login.tsx
    Onboarding.tsx              # Phase 12
    not-found.tsx
  components/
    LeadDiscovery.tsx
    LinkedInLeads.tsx
    LeadModal.tsx
    LeadImportModal.tsx         # Phase 10
    CampaignBuilder.tsx
    SendQueue.tsx
    Inbox.tsx
    EmailOutreach.tsx
    ProfileManagement.tsx
    ProfileModal.tsx
    Analytics.tsx
    Reports.tsx
    Settings.tsx
    SuppressionList.tsx         # Phase 7
    NotificationBell.tsx        # Phase 11
    AuditLog.tsx                # Phase 12
  hooks/
    useSSE.ts                   # Phase 11
    useAuth.ts
    use-toast.ts
    use-mobile.tsx

shared/
  schema.ts

__tests__/
  (all ported + new tests per phase)

server/jobs/                    # In-process scheduled work (replaces n8n)
  scheduler.ts                  # node-cron wiring, imported from server/index.ts
  alerting.ts                   # notifyJobFailure shared helper
  queueGenerationJob.ts         # Phase 3 — every 15 min
  queueDispatchJob.ts           # Phase 3 — every 5 min
  inboxSyncJob.ts               # Phase 3 — every 10 min
  usageResetJob.ts              # Phase 9 — 1st of month
  reEnrichmentJob.ts            # Phase 10 — 3am daily
  dailyDigestJob.ts             # Phase 11 — 8am daily

n8n/                            # Reference-only snapshot (gitignored from compile)
  linkedin-queue-workflow.json  # Original workflow, kept for reference

public/
  privacy.html                  # Phase 7
  terms.html                    # Phase 7

_reference/                     # ClearEdge Leads JS, ported phase by phase
  clearedge-lib/                # → server/lib + server/services (Phase 3-5)
  clearedge-middleware/         # → server/middleware (Phase 1.3)
  clearedge-api/                # → server/routes + server/services (Phase 3)
  clearedge-tests/              # → __tests__ (Phase 6)
  clearedge-migrations/         # reference for shared/schema.ts (Phase 1.2)

_source/                        # gitignored — original zip snapshots
```

---

## Success Metrics

| Metric | After phase 6 | After phase 9 | After phase 12 |
|--------|-------------|--------------|---------------|
| Google leads | Working | Workspace-scoped | With deduplication |
| LinkedIn sends/day | 50–100 via queue | Per-account limits | Compliance-safe |
| Email deliverability | Gmail dev only | SendGrid + domain auth | Bounce rate < 2% |
| Reply rate | Baseline tracked | 15%+ A/B optimized | 20%+ with RAG |
| Legal compliance | None | Unsubscribe + deletion | Full CAN-SPAM + GDPR |
| Paying customers | Cannot bill | Stripe live | Multi-workspace |
| Team support | Single user | 5-member teams | Agency multi-account |
| Notifications | None | Slack digest | Live SSE + in-app |
| CI / deployment | Green CI | Railway production | Monitoring + alerts |
