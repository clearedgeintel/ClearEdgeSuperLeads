-- Migration 008: Phase 5 — RAG knowledge base, VoC insights, multi-language

-- ============================================================
-- 1. Knowledge base for RAG (successful outreach examples)
-- ============================================================
create table knowledge_base (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(id),
  campaign_id uuid references campaigns(id),
  outbound_message text not null,
  reply_message text,
  sentiment text check (sentiment in ('positive', 'negative', 'neutral')),
  industry text,
  title_pattern text,
  tags text[],
  embedding_text text,
  created_at timestamptz not null default now()
);

create index idx_kb_sentiment on knowledge_base (sentiment);
create index idx_kb_industry on knowledge_base (industry);

alter table knowledge_base enable row level security;
create policy "kb_all" on knowledge_base for all to authenticated using (true) with check (true);

-- ============================================================
-- 2. Voice-of-Customer insights (aggregated from replies)
-- ============================================================
create table voc_insights (
  id uuid primary key default gen_random_uuid(),
  insight_type text not null check (insight_type in ('objection', 'interest', 'question', 'trend')),
  content text not null,
  frequency integer not null default 1,
  example_replies jsonb,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index idx_voc_type on voc_insights (insight_type);

alter table voc_insights enable row level security;
create policy "voc_all" on voc_insights for all to authenticated using (true) with check (true);

-- ============================================================
-- 3. Language detection on leads
-- ============================================================
alter table leads add column if not exists language text default 'en';

-- ============================================================
-- 4. Campaign optimization tracking
-- ============================================================
alter table campaigns add column if not exists auto_pause_threshold numeric(5,2) default 0;
alter table campaigns add column if not exists last_optimization_at timestamptz;
