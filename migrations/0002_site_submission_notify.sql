-- Phase 3 (merge Instant Site into SuperLeads): owner-notification tracking on
-- site_submissions.
--
-- Review, then apply by hand against the shared production database
-- (Supabase SQL editor or psql). Do NOT use drizzle-kit push/migrate.
-- Apply BEFORE deploying Phase 3: the app selects these columns.
--
-- Backward compatible with the running Instant Site service: its inserts don't
-- name these columns, so notified_at stays null and notify_attempts takes its
-- default. (Rows it inserts are never emailed by Instant Site; the retry job
-- only looks back 7 days, so a cutover won't mass-email old submissions.)
--
-- Idempotent: safe to run twice.

BEGIN;

-- Set when the owner email is sent, or when no email is needed.
ALTER TABLE site_submissions ADD COLUMN IF NOT EXISTS notified_at timestamptz;

-- Email attempts so far; the retry job stops after 3.
ALTER TABLE site_submissions ADD COLUMN IF NOT EXISTS notify_attempts integer NOT NULL DEFAULT 0;

-- The retry job scans only un-notified rows.
CREATE INDEX IF NOT EXISTS site_submissions_unnotified_idx
  ON site_submissions (created_at)
  WHERE notified_at IS NULL;

COMMIT;
