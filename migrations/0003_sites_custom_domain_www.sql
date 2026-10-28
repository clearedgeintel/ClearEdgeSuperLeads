-- Phase 4 (merge Instant Site into SuperLeads): www as a site's canonical host.
--
-- custom_domain is stored without "www." (enforced by sites_custom_domain_normalized).
-- This flag says whether the site lives at www.<domain> (recommended: most DNS
-- providers can't point an apex at Railway, so the apex is forwarded to www)
-- or at the bare domain.
--
-- Review, then apply by hand against the shared production database
-- (Supabase SQL editor or psql). Do NOT use drizzle-kit push/migrate.
-- Apply BEFORE deploying Phase 4: both services select this column.
--
-- Backward compatible: Instant Site never names it, so new rows get the default.
-- Idempotent: safe to run twice.

BEGIN;

ALTER TABLE sites ADD COLUMN IF NOT EXISTS custom_domain_www boolean NOT NULL DEFAULT false;

COMMIT;
