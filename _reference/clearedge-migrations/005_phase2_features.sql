-- Migration 005: Phase 2 — prompt versioning, reply classification, enrichment, approval flow

-- ============================================================
-- 1. Prompt template versions (A/B testing)
-- ============================================================
create table prompt_versions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  step_order integer not null,
  variant text not null default 'A',
  prompt_template text not null,
  description text,
  times_used integer not null default 0,
  reply_count integer not null default 0,
  positive_reply_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index idx_prompt_versions_campaign on prompt_versions (campaign_id, step_order);

alter table prompt_versions enable row level security;
create policy "prompt_versions_all" on prompt_versions for all to authenticated using (true) with check (true);

-- Track which prompt version was used for each queue item
alter table send_queue add column if not exists prompt_version_id uuid references prompt_versions(id);

-- ============================================================
-- 2. Reply sentiment classification
-- ============================================================
alter table engagement_events add column if not exists sentiment text
  check (sentiment in ('positive', 'negative', 'neutral', 'out_of_office', 'unclassified'));

-- ============================================================
-- 3. Enrichment tracking on leads
-- ============================================================
alter table leads add column if not exists enrichment_status text default 'pending'
  check (enrichment_status in ('pending', 'enriched', 'failed', 'skipped'));
alter table leads add column if not exists enriched_at timestamptz;

create index idx_leads_enrichment on leads (enrichment_status);

-- ============================================================
-- 4. Campaign approval flow
-- ============================================================
alter table campaigns add column if not exists require_approval boolean not null default true;

-- ============================================================
-- 5. Follow-up cadence config
-- ============================================================
alter table campaigns add column if not exists max_touches integer not null default 5
  check (max_touches > 0 and max_touches <= 10);
