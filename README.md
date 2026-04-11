# ClearEdge Outreach Platform

A unified LinkedIn + Google lead outreach platform that merges **ConsultantCRM-GBP** (Google lead discovery + email outreach) and **ClearEdge Leads** (LinkedIn multi-step campaigns via Unipile) into a single production-ready build. See [ROADMAP.md](ROADMAP.md) for the 12-phase build plan.

## Architecture

```
React 18 + TypeScript + shadcn/ui + TanStack Query
                        |
         Express.js + TypeScript (unified API)
                        |
    +-----------+-------+-------+--------------+
AI service  Google service  LinkedIn svc   Email service
(Claude)    (Places + GBP)  (Unipile)     (SendGrid — Phase 8)
                        |
       PostgreSQL via Supabase — Drizzle ORM
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Tailwind, shadcn/ui, TanStack Query |
| Backend | Express.js + TypeScript |
| ORM | Drizzle ORM |
| Database | PostgreSQL (Supabase) |
| AI | Anthropic Claude + prompt engine + RAG |
| Google APIs | OAuth 2.0, Custom Search, Places API (New) |
| LinkedIn | Unipile API |
| Email | SendGrid / Resend (Phase 8) |
| Billing | Stripe (Phase 9) |
| CRM | HubSpot |
| Automation | n8n workflows |
| Build | Vite, esbuild |

## Quickstart

```bash
git clone <repo-url> clearedge-outreach
cd clearedge-outreach
cp .env.example .env            # fill in required keys
npm install
npm run db:push                  # sync schema to Supabase (Phase 1.2+)
npm run dev                      # starts server on :5000
```

### Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start dev server (tsx + vite middleware) |
| `npm run build` | Vite client build + esbuild server bundle |
| `npm run start` | Run production build |
| `npm run check` | TypeScript typecheck (`tsc --noEmit`) |
| `npm run lint` | ESLint across `.ts` / `.tsx` |
| `npm run lint:fix` | ESLint with auto-fix |
| `npm run format` | Prettier write on `.ts`, `.tsx`, `.json`, `.md` |
| `npm test` | Jest (TypeScript via ts-jest) |
| `npm run db:push` | Apply Drizzle schema to the configured database |

Pre-commit hook (husky) runs `lint` + `check` on every commit.

## Repository Layout

```
client/          React 18 + shadcn/ui frontend (from GBP base)
server/          Express + Drizzle backend (from GBP base)
shared/          Drizzle schema shared between client and server
n8n/             n8n workflow JSON
_reference/      ClearEdge Leads JavaScript — ported phase by phase
ROADMAP.md       12-phase build plan
```

### About `_reference/`

`_reference/` holds the original ClearEdge Leads JavaScript codebase (lib, middleware, api handlers, tests, SQL migrations). It is **tracked in git** but is neither compiled nor linted — each file is rewritten as TypeScript and moved into `server/services/`, `server/lib/`, `server/middleware/`, or `__tests__/` at the moment its owning phase (2–6) reaches it. This keeps `npm run check` passing at every commit instead of forcing a bulk `.js → .ts` conversion up front.

`_source/` (gitignored) holds the raw zip snapshots of both source codebases for reference only.

## Environment Variables

See [.env.example](.env.example). Required keys expand phase by phase — see the **Environment Variables** section of [ROADMAP.md](ROADMAP.md) for the full list (Supabase, Google OAuth, Anthropic, Unipile, SendGrid, Stripe, Apollo, Hunter, HubSpot).
