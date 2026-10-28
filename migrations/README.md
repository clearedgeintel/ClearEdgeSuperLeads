# migrations/

Hand-written, reviewed SQL for the **shared production database**. The old
Instant Site service uses this database too, so every file here must be
**additive and backward compatible**: no drops, renames, type changes, or
`NOT NULL` on existing columns. `__tests__/migrations.test.ts` enforces this.

- Tim applies these by hand (Supabase SQL editor or `psql`), in filename order.
- Never run `drizzle-kit push` or `drizzle-kit migrate` against production.
- Each file is idempotent (`IF NOT EXISTS` / guarded `DO` blocks) and wrapped
  in a transaction.
- `shared/schema.ts` mirrors the result. After applying a file, a Drizzle diff
  against production should be empty.

| File | Phase | What it does | Applied to production |
|---|---|---|---|
| `0001_sites_additive_columns.sql` | 1 | `sites`: `custom_domain` (unique, normalized), `photos`, `notify_email`, `notify_phone`, `published_at`, `client_id` | 2026-10-18 (Supabase `apply_migration`, name `sites_additive_columns`) |
| `0002_site_submission_notify.sql` | 3 | `site_submissions`: `notified_at`, `notify_attempts`, partial index on un-notified rows | 2026-10-27 (Supabase `apply_migration`, name `site_submission_notify`) |
