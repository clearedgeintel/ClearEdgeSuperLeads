-- Migration 006: Phase 3 — API usage tracking, lead scoring improvements

-- ============================================================
-- 1. API usage log for cost tracking
-- ============================================================
create table api_usage_log (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('claude', 'unipile')),
  endpoint text not null,
  model text,
  input_tokens integer,
  output_tokens integer,
  campaign_id uuid references campaigns(id),
  lead_id uuid references leads(id),
  created_at timestamptz not null default now()
);

create index idx_api_usage_provider on api_usage_log (provider);
create index idx_api_usage_created on api_usage_log (created_at);
create index idx_api_usage_campaign on api_usage_log (campaign_id);

alter table api_usage_log enable row level security;
create policy "api_usage_log_all" on api_usage_log for all to authenticated using (true) with check (true);

-- ============================================================
-- 2. Score tracking on leads
-- ============================================================
alter table leads add column if not exists score_updated_at timestamptz;
alter table leads add column if not exists score_factors jsonb;
