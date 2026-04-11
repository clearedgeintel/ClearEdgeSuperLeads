-- Migration 003: Additional indexes, soft deletes, and audit improvements

-- send_log indexes (high-query table missing indexes)
create index idx_send_log_lead on send_log (lead_id);
create index idx_send_log_campaign on send_log (campaign_id);
create index idx_send_log_dispatched on send_log (dispatched_at);

-- campaign_enrollments status index (filtered in trigger-queue-generation)
create index idx_enrollments_status on campaign_enrollments (status);

-- Soft delete on leads (preserve data for audit/compliance)
alter table leads add column if not exists deleted_at timestamptz;
create index idx_leads_deleted on leads (deleted_at) where deleted_at is not null;

-- Soft delete on send_queue
alter table send_queue add column if not exists deleted_at timestamptz;

-- Add updated_at to send_queue for tracking review timing
alter table send_queue add column if not exists updated_at timestamptz not null default now();

create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_send_queue_updated_at
  before update on send_queue
  for each row execute function update_updated_at();
