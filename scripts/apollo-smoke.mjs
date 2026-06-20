// Apollo RapidAPI smoke test — exercises the live two-step enrichment flow
// for the "Apollo.io (no cookies required)" proxy without touching the DB:
//
//   1. GET /search_organization?q_organization_name=<name>  → match primary_domain
//   2. GET /search_people?organization_ids=<id>             → decision-maker
//
// This proxy's /search_people IGNORES domain/keyword filters and only honours
// organization_ids, which is why we resolve the org id first.
//
// Run after setting APOLLO_RAPIDAPI_KEY in .env:
//   node --env-file=.env scripts/apollo-smoke.mjs "<business name>" <domain>
//   node --env-file=.env scripts/apollo-smoke.mjs "Stripe" stripe.com

const name = process.argv[2] ?? 'Stripe';
const domain = (process.argv[3] ?? 'stripe.com').toLowerCase();
const apiKey = process.env.APOLLO_RAPIDAPI_KEY;
const host =
  process.env.APOLLO_RAPIDAPI_HOST ?? 'apollo-io-no-cookies-required.p.rapidapi.com';

if (!apiKey) {
  console.error('APOLLO_RAPIDAPI_KEY is not set. Add it to .env and re-run.');
  process.exit(1);
}

const DECISION_MAKER_TITLES = [
  'owner', 'founder', 'co-founder', 'ceo', 'president',
  'managing director', 'partner', 'general manager',
];

const clean = (u) =>
  (u ?? '').replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase().trim();

const get = async (path) => {
  const res = await fetch(`https://${host}${path}`, {
    headers: { 'x-rapidapi-key': apiKey, 'x-rapidapi-host': host },
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    console.error(`Non-JSON from ${path}:\n`, text.slice(0, 500));
    process.exit(1);
  }
  return { status: res.status, json };
};

// Step 1 — resolve org id by name, matched on domain.
const orgQ = new URLSearchParams({ page: '1', q_organization_name: name });
const org = await get(`/search_organization?${orgQ.toString()}`);
console.log(`[1] search_organization "${name}" -> HTTP ${org.status}`);
const orgs = org.json.data?.organizations ?? [];
console.log(`    ${orgs.length} orgs returned`);
const match = orgs.find((o) => clean(o.primary_domain ?? o.website_url) === domain);
if (!match) {
  console.log(`    no org with primary_domain === ${domain}. Top results:`);
  orgs.slice(0, 5).forEach((o) => console.log(`      - ${o.name} (${o.primary_domain})`));
  console.log('\nResult: would SKIP Apollo (no domain match) and fall through to Hunter.');
  process.exit(0);
}
console.log(`    matched: ${match.name} (${match.primary_domain}) id=${match.id}`);

// Step 2 — people at that org.
const pplQ = new URLSearchParams({ page: '1', organization_ids: match.id });
const ppl = await get(`/search_people?${pplQ.toString()}`);
console.log(`\n[2] search_people organization_ids=${match.id} -> HTTP ${ppl.status}`);
const people = ppl.json.data?.people ?? [];
console.log(`    ${people.length} people returned`);

// Priority-ordered match: owner > founder > … > general manager.
let chosen;
for (const t of DECISION_MAKER_TITLES) {
  chosen = people.find((p) => (p.title ?? '').toLowerCase().includes(t));
  if (chosen) break;
}
chosen ??= people[0];

if (!chosen) {
  console.log('\nNo people returned.');
  process.exit(0);
}

const emailUnlocked =
  typeof chosen.email === 'string' && !chosen.email.includes('not_unlocked');

console.log('\nChosen decision-maker:');
console.log({
  name: chosen.name,
  title: chosen.title,
  linkedin_url: chosen.linkedin_url,
  email: emailUnlocked ? chosen.email : `(locked: ${chosen.email})`,
});
