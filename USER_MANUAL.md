# ClearEdge Outreach — User Manual

ClearEdge Outreach is a lead-generation and outreach platform that combines **Google business-lead discovery + email outreach** with **LinkedIn multi-step campaigns**, all backed by AI message generation, A/B testing, and compliance tooling.

This manual covers everyday use. For deployment/hosting, see [DEPLOYMENT.md](DEPLOYMENT.md).

---

## Contents

1. [Getting started](#1-getting-started)
2. [The dashboard at a glance](#2-the-dashboard-at-a-glance)
3. [Google Leads](#3-google-leads)
4. [LinkedIn Leads](#4-linkedin-leads)
5. [Campaigns](#5-campaigns)
6. [Send Queue](#6-send-queue)
7. [Inbox](#7-inbox)
8. [GBP Profiles](#8-gbp-profiles)
9. [Email Outreach](#9-email-outreach)
10. [Analytics & Reports](#10-analytics--reports)
11. [Settings](#11-settings)
12. [Team & invitations](#12-team--invitations)
13. [Billing & plans](#13-billing--plans)
14. [Notifications & live updates](#14-notifications--live-updates)
15. [Compliance: unsubscribe, suppression, GDPR](#15-compliance-unsubscribe-suppression-gdpr)
16. [Common workflows](#16-common-workflows)
17. [Troubleshooting & FAQ](#17-troubleshooting--faq)
18. [Glossary](#18-glossary)

---

## 1. Getting started

### Signing in
1. Open the app URL. On the login page, tick **"I agree to the Terms & Privacy Policy"** (links open in new tabs).
2. Click **Sign in with Google** and authorize.
3. On first login a personal **workspace** is created for you automatically. Everything you create — leads, campaigns, suppression entries — lives inside your workspace.

### The onboarding checklist
New workspaces see a 4-step onboarding banner above the dashboard:
1. **Connect email** — set your Resend API key (server-side) and your **From address** in Settings.
2. **Connect LinkedIn** — enter your Unipile account ID in Settings.
3. **Create your first campaign.**
4. **Discover or import leads.**

Steps check themselves off as you complete them. You can **Skip** the checklist at any time; it won't come back.

---

## 2. The dashboard at a glance

The top navigation has ten tabs:

| Tab | What it's for |
|-----|---------------|
| **Google Leads** | Find local businesses via Google, enrich, AI-score, and email them |
| **LinkedIn Leads** | Search LinkedIn prospects via Unipile and save them as leads |
| **Campaigns** | Build email or LinkedIn sequences with steps and A/B message variants |
| **Send Queue** | Review, edit, approve, and dispatch generated messages |
| **Inbox** | See replies and connection acceptances with sentiment labels |
| **GBP Profiles** | Manage Google Business Profile locations |
| **Email Outreach** | One-off and historical email sends |
| **Analytics** | Cross-channel pipeline metrics + live usage bars |
| **Reports** | Campaign comparison, A/B leaderboard, AI cost, CSV export |
| **Settings** | Integrations, limits, team, billing, compliance, webhooks, audit log |

The header also shows a **notification bell** (unread alerts) and your **logout** button. A yellow banner appears at the top when any LinkedIn action is ≥80% of its daily cap.

---

## 3. Google Leads

Find and work local-business leads sourced from Google.

### Discover leads
1. Go to **Google Leads**.
2. Enter a search query (e.g. *"dentists in Austin TX"*) and run the search. Results come from Google Custom Search + Places.
3. Discovered businesses appear in the table with name, address, phone, website, rating, and category.

### Enrich & score
- **Enrich** a lead to pull richer detail (hours, place types, business status) from the Places API.
- **Score** a lead to get an AI analysis and a 0–100 fit score with reasoning.

### Verify emails
- Click **Verify emails** (bulk, next to Search) or open a lead and click **Verify email** (single). This runs a Hunter.io deliverability check and badges the lead **green (verified)**, **yellow (risky)**, or **red (undeliverable)**. Undeliverable addresses are blocked from sending so you don't waste reputation on guaranteed bounces.

### Send outreach
- Open a lead → **Send outreach** generates an AI email and sends it. The message passes through suppression checks, your daily limit, and the CAN-SPAM footer automatically.

### The lead detail modal
Click any lead to open its modal: source badge (Google/LinkedIn), business-status and email-verification badges, full detail, **Export**, **Push to HubSpot**, **Verify email**, and a red **GDPR delete** (see [§15](#15-compliance-unsubscribe-suppression-gdpr)).

---

## 4. LinkedIn Leads

Prospect on LinkedIn through your connected Unipile account.

1. Go to **LinkedIn Leads**.
2. Fill in any of: keyword, title, company, industry, location.
3. Run the search (rate-limited — if you hit the cap, the remaining quota is shown).
4. Select profiles from the results table and **Save** them. They become leads with `lead_source = linkedin` and can be enrolled in campaigns just like Google leads.

> LinkedIn searches and sends are governed by daily caps for ToS safety (see [§11 Rate Limits](#rate-limits--compliance)).

---

## 5. Campaigns

A campaign is a sequence of steps sent to enrolled leads. Campaigns are **email** or **LinkedIn**.

### Create a campaign
1. Go to **Campaigns** → **New campaign**.
2. Set name, description, **channel** (email/LinkedIn), tone, **daily send limit**, and **max touches**.
3. Add **steps** in order. Each step has:
   - **Type** — connection request, message, InMail, or email
   - **Delay (days)** before this step fires
   - **Prompt template** — the instruction the AI uses to write the message (supports placeholders for lead fields)
   - **Character limit**

### Enroll leads
From a campaign, enroll leads (Google or LinkedIn). The system generates the first step's message into the **Send Queue** on schedule, respecting delays, max touches, and daily limits.

### A/B prompt variants
Inside a campaign, the **Prompt Versions** panel lets you create multiple message variants per step. The engine weights selection toward under-used variants, then learns: each variant tracks its **reply rate** and **positive-reply rate** so winners surface over time. Replies are credited back to the exact variant that generated the message.

### Activate / pause / delete
Each campaign has activate, pause, and delete controls. Paused campaigns generate no new queue items.

---

## 6. Send Queue

The queue is your review-and-approve gate before anything goes out.

- Tabs: **Pending · Approved · Sent · Skipped · Failed** (counts refresh live).
- On **Pending**: review each generated message, **edit** the draft inline, then **Approve** or **Skip**. Use **bulk approve/skip** to act on many at once.
- Click **Dispatch Approved** to send approved items immediately, or let the scheduler dispatch them automatically.
- Items that fail to send land on **Failed** with the reason.

> Nothing sends without passing suppression, plan, and daily-limit checks — even after approval.

---

## 7. Inbox

The inbox surfaces engagement, not raw email.

- Click **Sync** (or let the scheduler poll) to pull new LinkedIn replies and connection acceptances from Unipile.
- Each item shows a **sentiment badge**: positive / negative / neutral / **out-of-office**.
- **Out-of-office** replies don't count as real replies — the lead isn't marked "replied," and the campaign pauses that enrollment for 14 days instead of stopping it.
- A genuine reply pauses the enrollment so you can respond personally.
- Click an item to open the lead modal.

---

## 8. GBP Profiles

Manage Google Business Profile locations connected to your workspace — view and edit profile details. Used alongside Google Leads for local-presence work.

---

## 9. Email Outreach

The history and one-off view of email sends: drafts, previews, and sent messages with their status (sent, opened, clicked, bounced, spam). Use the **Outreach Preview** modal to review a generated email before it goes out.

---

## 10. Analytics & Reports

### Analytics
Cross-channel pipeline at a glance:
- **LinkedIn Pipeline** card — connection requests, accepted, messages sent, replies, positive replies, meetings booked (each with a rate %).
- **Email pipeline** card below it.
- **Daily email usage** progress bar at the top (green <80%, yellow 80–99%, red ≥100%).

### Reports
- **Campaign Comparison** — enrolled / sent / replies / reply % / positive % / meetings, per campaign.
- **A/B Prompt Leaderboard** — top message variants ranked by reply count, with preview and rates.
- **AI Cost Dashboard** — total calls, estimated Claude spend, input/output tokens, calls by provider.
- **CSV export** — **Leads CSV** and **Campaigns CSV** download buttons in the header.

---

## 11. Settings

Settings is the admin control panel. Secrets (API keys) live in the server environment; this page surfaces only operator-tunable values.

### Workspace
Shows your workspace name and current plan.

### Integrations
- **Unipile account ID** and **base URL** (LinkedIn)
- **From address** — the verified sending address for outbound email (its domain must be authenticated in Resend)
- **Calendly / scheduling link** — appended to messages where relevant
- **Slack webhook URL** — for the daily digest and job-failure alerts

### Rate Limits & Compliance {#rate-limits--compliance}
- Per-hour limits for LinkedIn search, LinkedIn dispatch, and email dispatch.
- **LinkedIn compliance mode** toggle.
- Hard daily caps always apply (defaults: **20 connection requests / 50 dispatches / 100 searches / 300 emails** per day) regardless of the toggle, to stay ToS-safe.

### Sending Domain Authentication
A live status card shows whether your Resend sending domain is **verified** (green), **pending DNS** (yellow), or **failed/not configured** (red), and lists the exact DNS records to publish. Resend domain auth covers SPF + DKIM; add a DMARC record separately (see DEPLOYMENT.md).

### Email Warm-Up Checklist
A recommended ramp (Week 1: 20/day → Week 4+: 300/day) to build sender reputation. The system enforces your workspace's daily email limit; sends above the cap are rejected until the next day.

### AI Usage
Total API calls, estimated Claude spend, token totals, and Unipile call counts.

Plus embedded panels: **Members**, **Billing**, **Suppression List**, **Outbound Webhooks**, and **Audit Log** (covered below).

Remember to click **Save settings** after editing fields.

---

## 12. Team & invitations

*(Admins only.)* In **Settings → Members**:

### Invite a teammate
1. Enter their email and pick a role (**member** or **admin**).
2. Click **Invite**. They receive an email with a sign-in link.
3. They click the link and **sign in with Google** — and land directly in your workspace with the role you chose. Invites expire in 7 days.

> If email isn't configured yet, the app returns the invite link so you can share it manually.

### Manage members
- Change any member's **role** with the dropdown.
- **Remove** a member (you can't remove yourself).

### Pending invitations
Outstanding invites are listed with their email, role, and expiry. **Revoke** any pending invite to invalidate its link.

### Roles
- **Admin** — full control: settings, billing, members, integrations, webhooks.
- **Member** — day-to-day use (leads, campaigns, queue, inbox) but not workspace administration.

---

## 13. Billing & plans

*(Admins only.)* **Settings → Billing** shows your plan, usage bars, and upgrade options (powered by Stripe).

| Plan | Price/mo | Emails/mo | LinkedIn/mo | Members | LinkedIn accounts |
|------|---------|-----------|-------------|---------|-------------------|
| Free | $0 | 50 | 50 | 1 | 1 |
| Solo | $49 | 1,000 | 500 | 1 | 1 |
| Team | $149 | 5,000 | 2,000 | 5 | 2 |
| Agency | $399 | 25,000 | 10,000 | Unlimited | 5 |

- **Upgrade** opens Stripe Checkout. **Manage billing** opens the Stripe Customer Portal (update card, cancel, change plan).
- Usage bars turn yellow at 80% and red at 100%. When you hit a monthly limit, further sends are blocked with an upgrade prompt; counters reset on the 1st of each month.

---

## 14. Notifications & live updates

- The **bell** in the header shows unread notifications (replies, etc.) with a red badge. Open it to read items and **mark all read**.
- The app uses live updates (SSE): when a reply arrives or the queue changes, the relevant tab refreshes on its own — no page reload — and you get a toast for new replies.
- A **daily digest** (if a Slack webhook is configured) posts a summary each morning.

---

## 15. Compliance: unsubscribe, suppression, GDPR

ClearEdge is built to keep you CAN-SPAM and GDPR compliant.

- **Unsubscribe** — every outbound email carries a CAN-SPAM footer, a one-click unsubscribe link, and native `List-Unsubscribe` headers. Unsubscribes are recorded automatically.
- **Suppression list** (**Settings → Suppression**) — add an **email** or a whole **domain** (e.g. `@competitor.com`) with a reason (manual / unsubscribed / bounced / spam report). Anyone on the list is permanently blocked from all outreach in your workspace. Hard bounces and spam complaints add entries automatically.
- **GDPR delete** — in a lead's modal, **GDPR delete** runs a transactional wipe of the lead and every related row (queue, send log, engagement events, emails, enrollments). It's irreversible and written to the audit log.
- **Audit log** (**Settings → Audit Log**, admin) — a searchable, filterable trail of sensitive actions (deletes, suppression changes, invites, role changes, LinkedIn sends, webhook deliveries).

---

## 16. Common workflows

### A. Google lead → email
1. **Google Leads** → search → **Verify emails**.
2. Open a strong lead → **Score** → **Send outreach** (or enroll in an email campaign).
3. Track opens/clicks/bounces in **Email Outreach** and **Analytics**.

### B. LinkedIn prospecting sequence
1. **LinkedIn Leads** → search → select → **Save**.
2. **Campaigns** → create a LinkedIn campaign with steps (connection request → message → follow-up) and A/B variants.
3. Enroll the saved leads.
4. **Send Queue** → review/approve generated messages → dispatch.
5. **Inbox** → sync → respond to replies; positive replies pause the sequence automatically.

### C. Optimize messaging
1. Add 2–3 prompt variants per step in a campaign.
2. Let sends accumulate.
3. **Reports → A/B Prompt Leaderboard** → keep the top variant, retire the rest.

### D. Onboard a teammate
1. **Settings → Members** → enter email + role → **Invite**.
2. They accept via the emailed link + Google sign-in and appear in **Members**.

---

## 17. Troubleshooting & FAQ

**My outreach email didn't send.**
Check the lead isn't on the suppression list, isn't marked undeliverable, and that you haven't hit your daily or monthly limit. The Send Queue **Failed** tab shows the exact reason.

**The Sending Domain card is yellow/red.**
Your Resend domain isn't fully verified. Publish the DNS records shown on the card and wait for propagation (up to 48h). Until then, deliverability suffers.

**An invite email never arrived.**
Email may not be configured. The invite still exists — copy the link from the toast/response and share it directly, or check Pending invitations. Also confirm the invitee uses the **same email** the invite was sent to.

**LinkedIn search/send says rate-limited.**
You hit an hourly or daily cap (caps exist for ToS safety). The message shows remaining quota; try again after the window resets.

**A reply looks like an out-of-office.**
The system detects OOO replies and holds the enrollment for 14 days rather than treating it as a real reply.

**Billing says "not configured."**
Stripe isn't set up on this deployment yet. Billing is optional until you're ready to charge.

---

## 18. Glossary

- **Workspace** — your tenant; everything you create is scoped to it. Team members share it.
- **Lead** — a prospect, either `google` or `linkedin` sourced, in one unified list.
- **Campaign** — an ordered sequence of message steps for one channel.
- **Step** — a single message in a campaign (connection request / message / InMail / email) with a delay and a prompt.
- **Enrollment** — a lead's participation in a campaign; tracks current step and status.
- **Send Queue** — generated messages awaiting review/approval/dispatch.
- **Prompt variant (A/B)** — alternate message templates for a step, scored by reply performance.
- **Suppression list** — emails/domains permanently blocked from outreach.
- **Engagement event** — a recorded reply, connection acceptance, open, click, or meeting booking.
- **Unipile** — the service that connects the platform to LinkedIn.
- **Resend** — the email-delivery provider (bounce/spam/open/click webhooks + domain auth).
