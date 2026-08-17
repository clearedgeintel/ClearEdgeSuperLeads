// Purge guessed email addresses written by the old pattern fallback.
//
// Until this was removed, emailDiscovery.ts fabricated `info@<domain>` whenever
// a website scrape came up empty, stored it on the lead as a real address, and
// tagged it `email_source = 'pattern'`. Those addresses were never confirmed to
// exist; mailing them bounces and damages the sending domain's reputation.
//
// This clears `email`, `email_source`, `email_verified`, and `email_verified_at`
// on every affected lead. Nothing else on the lead is touched — the business
// stays, with its phone, website, and score intact.
//
// Dry run (default) — counts and samples, changes nothing:
//   node --env-file=.env scripts/purge-guessed-emails.mjs
//
// Apply:
//   node --env-file=.env scripts/purge-guessed-emails.mjs --apply

import pg from 'pg';

const apply = process.argv.includes('--apply');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Add it to .env and re-run.');
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const main = async () => {
  const { rows: summary } = await pool.query(`
    SELECT
      count(*)                                                    AS total,
      count(*) FILTER (WHERE email_verified = 'deliverable')       AS verified_deliverable,
      count(*) FILTER (WHERE email_verified IS NULL)               AS never_verified
    FROM leads
    WHERE email_source = 'pattern' AND email IS NOT NULL
  `);

  const { total, verified_deliverable, never_verified } = summary[0];

  console.log('Guessed addresses (email_source = \'pattern\'):');
  console.log(`  total                 ${total}`);
  console.log(`  never verified        ${never_verified}`);
  console.log(`  verified deliverable  ${verified_deliverable}`);

  if (Number(total) === 0) {
    console.log('\nNothing to purge.');
    return;
  }

  const { rows: sample } = await pool.query(`
    SELECT business_name, email, email_verified
    FROM leads
    WHERE email_source = 'pattern' AND email IS NOT NULL
    ORDER BY discovered_at DESC
    LIMIT 10
  `);

  console.log('\nMost recent 10:');
  for (const r of sample) {
    console.log(`  ${r.email.padEnd(40)} ${r.email_verified ?? 'unverified'}  ${r.business_name}`);
  }

  if (Number(verified_deliverable) > 0) {
    console.log(
      `\nNote: ${verified_deliverable} of these were later confirmed deliverable by Hunter.` +
      '\nThey are guesses that happened to be right. They will be cleared too — rerun' +
      '\ndiscovery or Apollo/Hunter enrichment to re-acquire them from a real source.',
    );
  }

  if (!apply) {
    console.log('\nDry run. Nothing changed. Re-run with --apply to purge.');
    return;
  }

  const { rowCount } = await pool.query(`
    UPDATE leads
    SET email = NULL,
        email_source = NULL,
        email_verified = NULL,
        email_verified_at = NULL,
        updated_at = now()
    WHERE email_source = 'pattern' AND email IS NOT NULL
  `);

  console.log(`\nPurged ${rowCount} guessed address${rowCount === 1 ? '' : 'es'}.`);
};

main()
  .catch((err) => {
    console.error('Purge failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
