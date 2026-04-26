# Pre-Launch Peer Code Review — ClearEdge Outreach

**Reviewer guide for the full Phase 1-12 codebase.** This doc is the entry
point — use it as a table of contents and comment thread anchor. Each
numbered finding below has a file path and line range so you can jump
directly to the code and leave review comments inline.

---

## Scope of this review

All 18 commits on `master` from `3e87f86` (initial scaffold) to `b33d249`
(latest critical-fix commit). Roughly 20,800 LOC across 129 TypeScript
files. Built over 12 roadmap phases; see [ROADMAP.md](ROADMAP.md) for
the phase-by-phase narrative and [TEST_CHECKLIST.md](TEST_CHECKLIST.md)
for the manual browser walkthrough.

**Reviewer's attention budget should go to:**
1. The 3 "critical" findings marked **FIXED** (verify the fix is correct)
2. The 4 "high" findings marked **OPEN** (decide: block launch or defer)
3. The `server/routes.ts` (2300 lines) and `server/storage.ts` (1600 lines)
   monoliths — general architectural sanity check
4. Any area where the comments say "deferred" — confirm the deferral is
   acceptable

---

## Key files, in order of review priority

| Priority | File | Why |
|----------|------|-----|
| 1 | [shared/schema.ts](shared/schema.ts) | 22 tables, foundation of correctness |
| 2 | [server/routes.ts](server/routes.ts) | 2300 lines, 83 routes, monolith concern |
| 3 | [server/storage.ts](server/storage.ts) | 1600 lines, single DB access layer |
| 4 | [server/services/promptEngine.ts](server/services/promptEngine.ts) | Core AI logic + injection sanitizer |
| 5 | [server/services/emailService.ts](server/services/emailService.ts) | SendGrid + suppression + daily cap gates |
| 6 | [server/lib/unsubscribe.ts](server/lib/unsubscribe.ts) | HMAC token generation + verification |
| 7 | [server/services/unipileDispatchService.ts](server/services/unipileDispatchService.ts) | LinkedIn dispatch flow |
| 8 | [server/jobs/scheduler.ts](server/jobs/scheduler.ts) | All 6 cron jobs in-process |
| 9 | [server/lib/planLimits.ts](server/lib/planLimits.ts) | Plan enforcement |
| 10 | [__tests__/lifecycle.test.ts](__tests__/lifecycle.test.ts) | Integration coverage |

---

## Audit findings

Every finding has **Status**, **File**, **Severity**, and **Fix notes**.

### CRITICAL (launch blockers)

#### 🔴 C1 — XSS in unsubscribe HTML response — **FIXED** (`b33d249`)
- **File:** [server/routes.ts:1940-1985](server/routes.ts#L1940-L1985)
- The public `/unsubscribe/:token` endpoint was interpolating the email
  address directly into the HTML body without escaping. Although the
  email is HMAC-verified (so forged tokens can't reach the code path),
  a legitimately-registered malicious address could contain HTML that
  executes when the confirmation page renders.
- **Fix:** Added `escapeHtml()` helper; applied to the email injection
  point. Verify the helper escapes `&`, `<`, `>`, `"`.

#### 🔴 C2 — Unvalidated PATCH `/api/campaigns/:id` — **FIXED** (`b33d249`)
- **File:** [server/routes.ts:803](server/routes.ts#L803), [shared/validators.ts:62-72](shared/validators.ts#L62-L72)
- Route accepted `req.body` directly, allowing authenticated users to
  set arbitrary fields including `workspaceId`, `createdBy`, internal
  counters, or Stripe metadata.
- **Fix:** Added `updateCampaignSchema` with `.strict()` and an explicit
  allowlist of 8 updatable fields. Wired via `validateBody` middleware.

#### 🔴 C3 — SQL wildcard injection in VoC `ilike` — **FIXED** (`b33d249`)
- **File:** [server/storage.ts:1427-1450](server/storage.ts#L1427-L1450)
- `findSimilarVocInsight` concatenated `'%' + contentPrefix + '%'` into
  an `ilike` clause. Not classic SQL injection (Drizzle parameterizes),
  but user-controlled `%` / `_` / `\` could manipulate the match scope.
- **Fix:** Escape `\`, `%`, `_` before wrapping in the pattern.

### HIGH (should block launch unless explicitly accepted)

#### 🟠 H1 — Missing CASCADE on FK deletes — **OPEN**
- **File:** [shared/schema.ts](shared/schema.ts) — leads, campaigns, users FKs
- `gdprDeleteLead()` manually cascades, but user deletion leaves
  orphaned campaigns/profiles/emails. Campaign deletion leaves orphaned
  enrollments/queue/log rows.
- **Fix:** Add `{ onDelete: 'cascade' }` on 5+ FKs OR document the
  manual cascade invariant in storage.ts comments.
- **Decision needed:** block launch, or accept that GDPR works correctly
  (the only legally-required cascade) and defer others?

#### 🟠 H2 — SendGrid webhook verification optional — **OPEN**
- **File:** [server/routes.ts:1801](server/routes.ts#L1801)
- Signature verification only runs if `SENDGRID_WEBHOOK_PUBLIC_KEY` is
  set. In production, a missing env var silently disables verification,
  so any attacker can poison the suppression list with forged bounces.
- **Fix:** Throw on boot if the key is missing AND
  `NODE_ENV === 'production'`.
- **Decision needed:** block launch. This is a production safety net,
  not a dev convenience.

#### 🟠 H3 — `/api/health` leaks service configuration — **OPEN**
- **File:** [server/routes.ts:2281-2294](server/routes.ts#L2281-L2294)
- Unauthenticated endpoint reveals which integrations are configured
  (email, anthropic, googleAuth, googlePlaces, hubspot). Enumeration
  aid for attackers.
- **Fix:** Require auth OR return only `{ok: true}` to unauthenticated
  callers.

#### 🟠 H4 — Email-address HTML escaping on success page — **FIXED** (`b33d249`)
- Same root cause as C1; patched in the same commit.

### MEDIUM (defer to next sprint)

#### 🟡 M1 — `routes.ts` monolith — **OPEN**
- 2300 lines, 83 route definitions. Split into
  `server/routes/{auth,leads,campaigns,queue,webhooks,workspace}.ts`.

#### 🟡 M2 — Storage queries unbounded — **OPEN**
- `getLeads()`, `getCampaigns()`, `getEnrollments()` return all rows. Risk
  of OOM at >1000 leads per workspace. Add pagination (limit/offset).

#### 🟡 M3 — Import routes unvalidated — **OPEN**
- `/api/suppression/import-domains` and `/api/leads/import` accept
  arbitrary JSON. Add Zod schemas.

#### 🟡 M4 — Error handling inconsistent — **OPEN**
- Some routes leak `error.message` (stack traces / DB details). Add a
  centralized errorHandler middleware using the existing
  `server/middleware/errorHandler.ts`.

#### 🟡 M5 — `app_config` missing primary key — **OPEN**
- Composite unique index exists but no explicit PK. Add `id: varchar`
  for audit trail + migration safety.

#### 🟡 M6 — No CSRF protection on state-changing POST — **OPEN**
- Session-authenticated routes accept cross-origin POSTs. Either add
  CSRF tokens or rely on `SameSite=Strict` cookies (check session.ts).

#### 🟡 M7 — Missing cascade on campaign child tables — **OPEN**
- Same family as H1 but scoped to campaign deletion. Add `onDelete:
  'cascade'` to `campaignEnrollments`, `sendQueue`, `sendLog`
  campaignId FKs.

#### 🟡 M8 — No transaction abstraction — **OPEN**
- Direct `db.transaction()` calls scattered. Create `withTransaction`
  helper for consistency.

### LOW (quality-of-life)

#### 🟢 L1 — Test routes in production code — **OPEN**
- [server/routes.ts:187](server/routes.ts#L187), 246 — wrap in `NODE_ENV === 'development'` or remove.

#### 🟢 L2 — No rate limit on public unsubscribe — **OPEN**
- Add `rateLimit()` middleware even though HMAC makes brute-force infeasible.

#### 🟢 L3 — Unused imports in routes.ts — **OPEN**
- `emit`, `PlanTier`, `nanoid` flagged as declared but unused. Clean up.

#### 🟢 L4 — A/B prompt weighting needs doc — **OPEN**
- [server/services/promptEngine.ts:106-118](server/services/promptEngine.ts#L106-L118) — add comment explaining the
  `maxUsed + 1 - timesUsed` bias strategy.

#### 🟢 L5 — Type casts to `any` in error handlers — **OPEN**
- Use `error instanceof Error ? error.message : String(error)`.

#### 🟢 L6 — Storage interface too large — **OPEN**
- 161+ methods in one `IStorage`. Split into domain interfaces
  (`ILeadStorage`, `ICampaignStorage`, ...).

---

## What's operationally untested

**Zero** runtime verification of:
- Any UI component rendering in a browser
- Any API route via real HTTP
- Any external integration (Unipile, Claude, SendGrid, Hunter, Apollo, Stripe)
- The SSE connection actually fanning events to a browser client
- The six cron jobs firing in production

Verified only:
- 59 unit + integration tests pass (against real Supabase DB for 33 of them)
- TypeScript compiles (`tsc --noEmit`)
- ESLint passes with 0 errors
- Vite + esbuild produce a valid build bundle

See [TEST_CHECKLIST.md](TEST_CHECKLIST.md) for the manual walkthrough
that will close this gap.

---

## Decisions the reviewer should help make

1. **H1, H2, H3** — block launch, or defer?
2. **M1** — refactor `routes.ts` now or after production bake-in?
3. **M6 (CSRF)** — adopt CSRF tokens or rely on `SameSite=Strict`
   cookies + per-origin CORS?
4. **Phase 12 remaining work** (audit log UI, outbound webhooks,
   meeting booking) — land before or after the browser test pass?

---

## Review comment anchors

To leave a comment tied to a specific finding, quote the heading line
(e.g., "re: H2 — SendGrid webhook verification optional") in your review
comment. GitHub's inline file comments work best for implementation
questions on the actual code.
