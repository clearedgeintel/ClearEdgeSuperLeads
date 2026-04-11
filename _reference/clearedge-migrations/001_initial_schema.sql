-- ClearEdge LinkedIn Outreach — Initial Schema
-- Migration 001: All core tables, indexes, RLS policies, triggers

-- ============================================================
-- Updated_at trigger function
-- ============================================================
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ============================================================
-- 1. leads
-- ============================================================
create table leads (
  id uuid primary key default gen_random_uuid(),
  linkedin_url text unique not null,
  full_name text,
  title text,
  company text,
  industry text,
  company_size text,
  headline text,
  connection_degree integer check (connection_degree in (1, 2, 3)),
  status text not null default 'new'
    check (status in ('new','contacted','connected','replied','meeting_booked','disqualified')),
  score integer not null default 0 check (score >= 0 and score <= 100),
  notes text,
  enrichment_data jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_leads_status on leads (status);
create index idx_leads_linkedin_url on leads (linkedin_url);

create trigger trg_leads_updated_at
  before update on leads
  for each row execute function update_updated_at();

-- ============================================================
-- 2. campaigns
-- ============================================================
create table campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  status text not null default 'draft'
    check (status in ('draft','active','paused','completed')),
  tone text not null default 'consultative'
    check (tone in ('consultative','direct','curiosity-led')),
  daily_send_limit integer not null default 20 check (daily_send_limit > 0 and daily_send_limit <= 50),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_campaigns_updated_at
  before update on campaigns
  for each row execute function update_updated_at();

-- ============================================================
-- 3. campaign_steps
-- ============================================================
create table campaign_steps (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  step_order integer not null,
  step_type text not null
    check (step_type in ('connection_request','message','inmail','post_engage')),
  delay_days integer not null default 0,
  prompt_template text,
  character_limit integer,
  created_at timestamptz not null default now()
);

create index idx_campaign_steps_campaign on campaign_steps (campaign_id);

-- ============================================================
-- 4. campaign_enrollments
-- ============================================================
create table campaign_enrollments (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id),
  lead_id uuid not null references leads(id),
  current_step_order integer not null default 0,
  status text not null default 'active'
    check (status in ('active','paused','completed','disqualified')),
  enrolled_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, lead_id)
);

create index idx_enrollments_campaign on campaign_enrollments (campaign_id);
create index idx_enrollments_lead on campaign_enrollments (lead_id);

create trigger trg_enrollments_updated_at
  before update on campaign_enrollments
  for each row execute function update_updated_at();

-- ============================================================
-- 5. send_queue
-- ============================================================
create table send_queue (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references campaign_enrollments(id),
  lead_id uuid not null references leads(id),
  campaign_step_id uuid not null references campaign_steps(id),
  ai_draft text,
  edited_draft text,
  status text not null default 'pending'
    check (status in ('pending','approved','sent','skipped','failed')),
  char_count integer,
  over_limit boolean not null default false,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create index idx_send_queue_status on send_queue (status);
create index idx_send_queue_lead on send_queue (lead_id);

-- ============================================================
-- 6. send_log
-- ============================================================
create table send_log (
  id uuid primary key default gen_random_uuid(),
  queue_item_id uuid references send_queue(id),
  lead_id uuid not null references leads(id),
  campaign_id uuid not null references campaigns(id),
  message_text text,
  step_type text,
  dispatched_at timestamptz not null default now(),
  unipile_message_id text,
  dispatch_status text check (dispatch_status in ('success','failed'))
);

-- ============================================================
-- 7. engagement_events
-- ============================================================
create table engagement_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id),
  event_type text not null
    check (event_type in ('connection_accepted','reply_received','post_liked','post_commented','meeting_booked')),
  event_data jsonb,
  occurred_at timestamptz not null default now()
);

create index idx_engagement_lead on engagement_events (lead_id);
create index idx_engagement_type on engagement_events (event_type);

-- ============================================================
-- Row-Level Security (single-user tool — allow all for authenticated)
-- ============================================================
alter table leads enable row level security;
alter table campaigns enable row level security;
alter table campaign_steps enable row level security;
alter table campaign_enrollments enable row level security;
alter table send_queue enable row level security;
alter table send_log enable row level security;
alter table engagement_events enable row level security;

-- Policies: full access for authenticated users
create policy "leads_all" on leads for all to authenticated using (true) with check (true);
create policy "campaigns_all" on campaigns for all to authenticated using (true) with check (true);
create policy "campaign_steps_all" on campaign_steps for all to authenticated using (true) with check (true);
create policy "enrollments_all" on campaign_enrollments for all to authenticated using (true) with check (true);
create policy "send_queue_all" on send_queue for all to authenticated using (true) with check (true);
create policy "send_log_all" on send_log for all to authenticated using (true) with check (true);
create policy "engagement_events_all" on engagement_events for all to authenticated using (true) with check (true);
