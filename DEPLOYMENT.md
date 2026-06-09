# Deployment Guide

Production deployment notes for the ClearEdge Outreach Platform. Target host: **Railway** (any Node 20+ host works — the app is a standard Express server serving a built Vite SPA).

## Build & run

| Step | Command | Notes |
|------|---------|-------|
| Build | `npm run build` | Vite builds the client to `dist/public`; esbuild bundles the server to `dist/index.js`. |
| Start | `npm start` | Runs `NODE_ENV=production node dist/index.js`. |
| Migrate | `npm run db:push` | Drizzle pushes `shared/schema.ts` to the database. Run against the prod DB once per schema change. |

[railway.json](railway.json) wires `buildCommand`, `startCommand`, and `healthcheckPath: /api/health` so Railway's Nixpacks builder runs the full build and probes health correctly. `engines.node >=20` pins the runtime.

The server binds `0.0.0.0` and reads `process.env.PORT` (Railway injects it), so no host/port changes are needed.

## ⚠️ Single-instance scheduler

`startScheduler()` runs on every boot with **no leader election**. The in-process cron jobs (queue dispatch every 5 min, generation every 15 min, inbox sync every 10 min, daily re-enrichment, monthly usage reset, daily digest) will fire **on every replica**.

**If you scale beyond 1 replica, you will get duplicate LinkedIn/email sends and double API spend.** Mitigation:

- Keep the service at **1 replica**, OR
- Set `DISABLE_SCHEDULER=1` on all replicas except one.

## Required environment variables

Set these in the Railway dashboard (see [.env.example](.env.example) for the full annotated list).

**Always required:**
- `DATABASE_URL` — Postgres connection string (Supabase)
- `SESSION_SECRET` — random string (sessions + signed tokens)
- `APP_URL` — the **public Railway URL** (drives OAuth callbacks + email tracking links). Not localhost.
- `ANTHROPIC_API_KEY`
- `API_KEY` — shared secret for internal/cron webhook endpoints

**Per integration you enable:**
- Google login + discovery: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CUSTOM_SEARCH_API_KEY`, `GOOGLE_CUSTOM_SEARCH_ENGINE_ID`, `GOOGLE_PLACES_API_KEY`
- Email (production): `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_FROM_NAME`, `RESEND_WEBHOOK_SECRET` (+ optional `RESEND_TRANSACTIONAL_FROM_EMAIL`) — see DNS section below
- LinkedIn: `UNIPILE_BASE_URL`, `UNIPILE_API_KEY`, `UNIPILE_ACCOUNT_ID`
- Billing: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_SOLO_PRICE_ID`, `STRIPE_TEAM_PRICE_ID`, `STRIPE_AGENCY_PRICE_ID`
- CRM: `HUBSPOT_ACCESS_TOKEN`
- Enrichment: `APOLLO_API_KEY`, `HUNTER_API_KEY`

## Post-deploy external wiring

These callback URLs must point at your `APP_URL` domain (set in the respective provider consoles):
- **Google OAuth** redirect URI → `${APP_URL}/api/auth/google/callback`
- **Stripe webhook** → `${APP_URL}/api/webhooks/stripe`
- **Resend webhook** → `${APP_URL}/api/webhooks/resend` (subscribe to `email.bounced`, `email.complained`, `email.opened`, `email.clicked`; copy the signing secret into `RESEND_WEBHOOK_SECRET`)
- **Calendly / Cal.com webhooks** → `${APP_URL}/api/webhooks/calendly` / `/calcom`

## Email sending domain — SPF / DKIM / DMARC

Resend will not deliver reliably until the sending domain (the domain of `RESEND_FROM_EMAIL`) is verified. In Resend: **Domains → Add Domain**, then publish the DNS records Resend generates at your registrar. They look like:

| Type | Host (example) | Value | Purpose |
|------|----------------|-------|---------|
| TXT  | `send.yourdomain.com` | `v=spf1 include:amazonses.com ~all` | SPF |
| TXT  | `resend._domainkey.yourdomain.com` | `p=MIGfMA0...` (DKIM public key) | DKIM |
| MX   | `send.yourdomain.com` | `feedback-smtp.<region>.amazonses.com` (priority 10) | Bounce/complaint return path |

(Exact values are unique per domain — copy them from the Resend dashboard or the in-app status card; they are not guessable.)

In addition, publish a **DMARC** record (Resend domain auth covers SPF + DKIM but not DMARC):

```
Type: TXT
Host: _dmarc.yourdomain.com
Value: v=DMARC1; p=none; rua=mailto:dmarc@yourdomain.com
```

Start with `p=none` (monitor only), then tighten to `p=quarantine` / `p=reject` once reports look clean.

**Open/click tracking** is configured per-domain in the Resend dashboard (not per send). To keep transactional mail (invites) untracked, verify a second subdomain with tracking disabled and set `RESEND_TRANSACTIONAL_FROM_EMAIL` to an address on it.

**Verify status in-app:** the Settings → Sending Domain Authentication card shows live Resend domain status (green = verified, yellow = pending DNS propagation, red = failed/not configured) with the exact records to publish, backed by `GET /api/email/domain-status`. DNS changes can take up to 48h to propagate.
