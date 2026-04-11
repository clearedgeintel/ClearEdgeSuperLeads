-- Migration 002: Unipile integration fields

-- Add Unipile member ID to leads for matching
alter table leads add column unipile_member_id text;
create index idx_leads_unipile on leads (unipile_member_id);

-- App config table for storing Unipile account ID and other settings
create table app_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table app_config enable row level security;
create policy "app_config_all" on app_config for all to authenticated using (true) with check (true);

-- Seed default config
insert into app_config (key, value) values
  ('unipile_account_id', 'YOUR_LINKEDIN_ACCOUNT_ID'),
  ('unipile_base_url', 'https://api1.unipile.com:13465');
