-- Migration 004: LinkedIn audit log for compliance tracking

create table linkedin_audit_log (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(id),
  action text not null,
  details jsonb,
  status text not null check (status in ('success', 'failed')),
  created_at timestamptz not null default now()
);

create index idx_audit_log_lead on linkedin_audit_log (lead_id);
create index idx_audit_log_action on linkedin_audit_log (action);
create index idx_audit_log_created on linkedin_audit_log (created_at);

alter table linkedin_audit_log enable row level security;
create policy "audit_log_all" on linkedin_audit_log for all to authenticated using (true) with check (true);
