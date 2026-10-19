-- Phase 1 (merge Instant Site into SuperLeads): additive columns on `sites`.
--
-- Review, then apply by hand against the shared production database
-- (Supabase SQL editor or psql). Do NOT use drizzle-kit push/migrate.
--
-- Backward compatible with the running Instant Site service:
--   * only ADD COLUMN / CREATE INDEX / ADD CONSTRAINT on new columns
--   * no drops, renames, type changes, or NOT NULL on existing columns
--   * `photos` is NOT NULL but has a default, so Instant Site's INSERTs
--     (which don't name it) keep working; PG 11+ adds it without a rewrite
--   * Instant Site never writes custom_domain, so the CHECK can't reject it
--
-- Idempotent: safe to run twice.

BEGIN;

-- Custom domain for live sites. Stored lowercased, without a leading "www.".
ALTER TABLE sites ADD COLUMN IF NOT EXISTS custom_domain text;

-- Array of { url, alt, role: 'hero' | 'gallery' }.
ALTER TABLE sites ADD COLUMN IF NOT EXISTS photos jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Owner notification targets for quote requests (phone reserved for SMS later).
ALTER TABLE sites ADD COLUMN IF NOT EXISTS notify_email text;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS notify_phone text;

-- Set when the site goes live (status = 'live').
ALTER TABLE sites ADD COLUMN IF NOT EXISTS published_at timestamptz;

-- Link to clients(id). Deliberately unconstrained; the FK is added in Phase 5.
ALTER TABLE sites ADD COLUMN IF NOT EXISTS client_id varchar;

-- One site per domain; NULLs (no custom domain) don't collide.
CREATE UNIQUE INDEX IF NOT EXISTS sites_custom_domain_key
  ON sites (custom_domain)
  WHERE custom_domain IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sites_custom_domain_normalized'
      AND conrelid = 'public.sites'::regclass
  ) THEN
    ALTER TABLE sites ADD CONSTRAINT sites_custom_domain_normalized CHECK (
      custom_domain IS NULL
      OR (custom_domain = lower(custom_domain) AND custom_domain NOT LIKE 'www.%')
    );
  END IF;
END $$;

COMMIT;
