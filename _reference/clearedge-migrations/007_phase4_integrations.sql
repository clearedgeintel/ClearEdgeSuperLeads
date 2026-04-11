-- Migration 007: Phase 4 — Multi-channel, HubSpot, auth, calendar

-- ============================================================
-- 1. Email support on leads
-- ============================================================
alter table leads add column if not exists email text;
alter table leads add column if not exists preferred_channel text default 'linkedin'
  check (preferred_channel in ('linkedin', 'email'));

-- ============================================================
-- 2. Email step type + channel tracking on send_log
-- ============================================================
alter table send_log add column if not exists channel text default 'linkedin'
  check (channel in ('linkedin', 'email'));

-- Add email step type to campaign_steps
-- (drop and recreate check constraint)
alter table campaign_steps drop constraint if exists campaign_steps_step_type_check;
alter table campaign_steps add constraint campaign_steps_step_type_check
  check (step_type in ('connection_request', 'message', 'inmail', 'post_engage', 'email'));

-- ============================================================
-- 3. HubSpot integration fields
-- ============================================================
alter table leads add column if not exists hubspot_contact_id text;
alter table leads add column if not exists hubspot_synced_at timestamptz;

create index idx_leads_hubspot on leads (hubspot_contact_id) where hubspot_contact_id is not null;

-- Webhook log for inbound CRM events
create table webhook_log (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  event_type text not null,
  payload jsonb,
  processed boolean not null default false,
  created_at timestamptz not null default now()
);

create index idx_webhook_log_source on webhook_log (source);
create index idx_webhook_log_processed on webhook_log (processed) where processed = false;

alter table webhook_log enable row level security;
create policy "webhook_log_all" on webhook_log for all to authenticated using (true) with check (true);

-- ============================================================
-- 4. User management (extends Supabase Auth)
-- ============================================================
create table user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'rep' check (role in ('admin', 'rep')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table user_profiles enable row level security;
create policy "users_read_own" on user_profiles for select to authenticated
  using (id = auth.uid() or exists (select 1 from user_profiles where id = auth.uid() and role = 'admin'));
create policy "users_update_own" on user_profiles for update to authenticated
  using (id = auth.uid());
create policy "admins_all" on user_profiles for all to authenticated
  using (exists (select 1 from user_profiles where id = auth.uid() and role = 'admin'));

-- Add owner to campaigns
alter table campaigns add column if not exists owner_id uuid references auth.users(id);

-- ============================================================
-- 5. Calendar integration config
-- ============================================================
insert into app_config (key, value)
values ('calendly_link', '')
on conflict (key) do nothing;

-- ============================================================
-- 6. Email rate limiting config
-- ============================================================
insert into app_config (key, value)
values ('email_daily_limit', '50')
on conflict (key) do nothing;
