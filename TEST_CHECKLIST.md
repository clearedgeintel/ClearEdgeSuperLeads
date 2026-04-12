# ClearEdge Outreach — Manual Test Checklist

Run through this checklist after every significant deploy. Each section
maps to a roadmap phase so failures trace back to the responsible code.

## Prerequisites

```bash
cp .env.example .env
# Fill in: DATABASE_URL, SESSION_SECRET, ANTHROPIC_API_KEY
# Optional: UNIPILE_API_KEY, UNIPILE_ACCOUNT_ID, SENDGRID_API_KEY,
#           HUNTER_API_KEY, APOLLO_API_KEY, STRIPE_SECRET_KEY
npm install
npm run db:push
DISABLE_SCHEDULER=1 npm run dev   # disable cron so it doesn't fire mid-test
```

Open http://localhost:5000 in the browser.

---

## Phase 1 — Foundation

- [ ] Login page loads with Google + Demo buttons
- [ ] Terms checkbox blocks login until checked
- [ ] `/privacy` and `/terms` pages load (static HTML)
- [ ] Click "Demo Login" — redirects to Dashboard
- [ ] Sidebar shows 10 tabs
- [ ] User avatar + name appear in header
- [ ] NotificationBell icon appears next to logout

## Phase 2 — Google Lead Discovery

- [ ] Click "Google Leads" tab
- [ ] Search bar is visible with location field
- [ ] Search for "plumbers San Francisco" (requires GOOGLE_CUSTOM_SEARCH_API_KEY)
- [ ] Results appear in the table
- [ ] Click a lead → LeadModal opens
- [ ] LeadModal shows "Google" badge (indigo)
- [ ] Close modal

## Phase 3 — LinkedIn Module

- [ ] Click "LinkedIn Leads" tab
- [ ] Search form has 5 fields (keywords, title, company, industry, location)
- [ ] Search for "sales operations" (requires UNIPILE_API_KEY)
- [ ] Results appear with connection degree badges
- [ ] Select 2-3 results → click "Save"
- [ ] Toast confirms saved count
- [ ] Click "Campaigns" tab
- [ ] "No campaigns" empty state shows
- [ ] Click "New Campaign" → wizard dialog opens
- [ ] Create a LinkedIn campaign with name, consultative tone, 20/day limit
- [ ] Campaign card appears in the list
- [ ] Click the card → step editor loads
- [ ] Add a connection_request step with a prompt template
- [ ] Click "Send Queue" tab
- [ ] "Queue is empty" empty state shows
- [ ] Click "Inbox" tab
- [ ] "Nothing new yet" empty state shows
- [ ] Click "Sync Inbox" (requires UNIPILE_API_KEY)

## Phase 4 — AI Engine

- [ ] In CampaignBuilder, open a campaign detail
- [ ] Scroll down to "A/B Prompt Variants" section
- [ ] Click "New variant" → form appears
- [ ] Add a variant B with a different prompt
- [ ] Both variants show with "Sent 0 · Reply rate 0%" stats

## Phase 5 — Analytics & Reports

- [ ] Click "Analytics" tab
- [ ] LinkedIn Pipeline card shows at the top (all zeros is fine)
- [ ] Email Pipeline card shows below
- [ ] Email sends today progress bar shows at the very top
- [ ] Click "Reports" tab
- [ ] Campaign Comparison table shows (empty or with test campaign)
- [ ] A/B Prompt Leaderboard shows
- [ ] AI Cost Dashboard shows (may show $0.0000 if no Claude calls yet)
- [ ] "Leads CSV" button triggers download
- [ ] "Campaigns CSV" button triggers download

## Phase 6 — Settings & Hardening

- [ ] Click "Settings" tab
- [ ] Workspace panel shows name + plan
- [ ] Integrations card has 5 fields (Unipile ID, base URL, Calendly, SendGrid, Slack)
- [ ] Rate Limits card has 3 number inputs + compliance toggle
- [ ] Email Warm-Up Checklist card shows the 4-week ramp
- [ ] AI Usage card shows call counts + estimated spend
- [ ] Click "Save settings" → toast confirms

## Phase 7 — Compliance

- [ ] In Settings, Suppression List card is visible
- [ ] Select "Email" mode, type a test email, click "Add"
- [ ] Entry appears in the list with "manual" badge
- [ ] Switch to "Domain" mode, type a test domain, click "Add"
- [ ] Both entries show
- [ ] Delete one entry → confirm dialog → toast
- [ ] Open a lead in LeadModal
- [ ] "GDPR delete" button visible (red)
- [ ] Click it → confirm dialog spells out the cascade scope
- [ ] (Only do this on a test lead you don't need)
- [ ] LinkedIn daily limit banner does NOT show (limits not close to cap)

## Phase 8 — Email Infrastructure

- [ ] In LeadModal, "Verify email" button shows for leads with email
- [ ] Click it (requires HUNTER_API_KEY) → badge updates (green/yellow/red)
- [ ] In Google Leads, "Verify emails" bulk button is visible
- [ ] In Analytics, email sends today bar shows at top

## Phase 9 — Multi-Tenancy & Billing

- [ ] In Settings, Billing & Plan card shows
- [ ] Current plan shows "FREE" badge
- [ ] Usage bars for email + LinkedIn are green
- [ ] Plan upgrade cards show Solo/Team/Agency with prices
- [ ] Click "Upgrade" on any plan → toast "billing_disabled" (expected without Stripe keys)
- [ ] Members panel shows your test user
- [ ] Role dropdown shows admin/member
- [ ] (Don't remove yourself)

## Phase 11 — Real-Time

- [ ] NotificationBell shows in header
- [ ] Click it → dropdown opens (likely empty)
- [ ] Open DevTools Network tab → verify EventSource connects to /api/events
- [ ] Verify heartbeat pings arrive every ~30s (`:ping\n\n` frames in EventSource)

## Phase 12 — Onboarding

- [ ] On first login, "Getting Started" card shows above the main content
- [ ] 4 steps visible with completion status
- [ ] Steps 1-2 auto-complete if Unipile/SendGrid are configured
- [ ] "Skip" button dismisses the card
- [ ] Sidebar collapses to horizontal scroll strip on mobile viewport (resize to <768px)

---

## End-to-End Flow (the golden path)

This is the most important test. If this works, the core product works.

1. Demo login
2. Google Leads → search "restaurants Austin TX"
3. Click a result → LeadModal → "Send Outreach Email" (requires GMAIL_USER)
4. Check "Email Outreach" tab → sent email appears
5. LinkedIn Leads → search "sales manager" (requires UNIPILE_API_KEY)
6. Save 3 results
7. Campaigns → create a new LinkedIn campaign
8. Add a connection_request step
9. Go back to LinkedIn Leads → the saved leads should appear in Google Leads tab too (they're all leads)
10. Enroll a lead: Campaigns → click campaign → (would need an enroll button — currently enroll is API-only via POST /api/campaigns/:id/enroll)
11. POST to `/api/messages/trigger-batch` via curl or the browser console:
    ```js
    fetch('/api/messages/trigger-batch', { method: 'POST', credentials: 'include' })
      .then(r => r.json()).then(console.log)
    ```
12. Send Queue → "pending" tab should show the generated message
13. Approve it → "approved" tab
14. Click "Dispatch Approved" (requires UNIPILE_API_KEY for real dispatch)
15. Inbox → "Sync Inbox" → check for any replies

If steps 2-15 all succeed, the platform is functionally operational.

---

## Automated Test Suite

```bash
# Pure function tests (always pass, no DB needed)
npm test -- --testPathPattern retry
npm test -- --testPathPattern linkedinLimiter
npm test -- --testPathPattern languageDetect
npm test -- --testPathPattern promptEngine

# Integration tests (needs DATABASE_URL in .env)
npm test -- --testPathPattern lifecycle

# Full suite
npm test
```
