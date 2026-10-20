// Site repository against a real Postgres (PGlite, in-process). The schema is
// generated from shared/schema.ts, so these run against the same tables,
// constraints and indexes as production.
//
// Run with `npm run test:db` (needs --experimental-vm-modules for PGlite's WASM loader).

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { createRequire } from 'module';
import * as schema from '../../shared/schema';
import { createSiteRepository, CustomDomainTakenError, type SitesDb } from '../../server/sites/repository';
import { createGenerator } from '../../server/sites/generator';
import { SAMPLE_BUSINESS } from '../../server/sites/template/sampleData';

const require = createRequire(import.meta.url);

let client: PGlite;
let db: SitesDb;
let repo: ReturnType<typeof createSiteRepository>;

beforeAll(async () => {
  const { generateDrizzleJson, generateMigration } = require('drizzle-kit/api');
  const ddl: string[] = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema));
  client = new PGlite();
  for (const stmt of ddl) await client.exec(stmt);
  db = drizzle(client, { schema }) as unknown as SitesDb;
  repo = createSiteRepository(db);
  await client.exec(`INSERT INTO workspaces (id, name) VALUES ('ws-a', 'A'), ('ws-b', 'B')`);
  await client.exec(
    `INSERT INTO leads (id, workspace_id, business_name) VALUES ('lead-a', 'ws-a', 'Acme'), ('lead-b', 'ws-b', 'Bolt')`
  );
}, 120_000);

afterAll(async () => {
  await client?.close();
});

const data = (name: string, mapsUrl = '') => ({ ...SAMPLE_BUSINESS, name, mapsUrl });

describe('workspace scoping', () => {
  test('workspace A cannot read, change or delete workspace B’s sites', async () => {
    const b = await repo.create({ data: data('Bolt Electric'), theme: 'slate', workspaceId: 'ws-b', leadId: 'lead-b' });

    expect(await repo.getForWorkspace(b.id, 'ws-a')).toBeNull();
    expect((await repo.listForWorkspace('ws-a')).map((s) => s.id)).not.toContain(b.id);
    expect(await repo.updateForWorkspace(b.id, 'ws-a', { theme: 'warm' })).toBeNull();
    expect(await repo.publishForWorkspace(b.id, 'ws-a')).toBeNull();
    expect(await repo.unpublishForWorkspace(b.id, 'ws-a')).toBeNull();
    expect(await repo.listSubmissionsForWorkspace(b.id, 'ws-a')).toBeNull();
    expect(await repo.softDeleteForWorkspace(b.id, 'ws-a')).toBe(false);
    expect(await repo.hardDeleteForWorkspace(b.id, 'ws-a')).toBe(false);
    expect(await repo.getByLeadForWorkspace('lead-b', 'ws-a')).toBeNull();

    // Untouched, and still visible to its own workspace.
    const still = await repo.getForWorkspace(b.id, 'ws-b');
    expect(still).toMatchObject({ id: b.id, theme: 'slate', status: 'draft' });
  });

  test('maps-URL dedupe lookups stay inside the workspace', async () => {
    const url = 'https://www.google.com/maps/place/Scoped+Co/@1,2,15z';
    await repo.create({ data: data('Scoped Co', url), theme: 'clean', workspaceId: 'ws-b' });
    expect(await repo.getByMapsUrlForWorkspace(url, 'ws-a')).toBeNull();
    expect(await repo.getByMapsUrlForWorkspace(url, 'ws-b')).not.toBeNull();
  });

  test('sites with no workspace (old standalone Instant Site rows) are invisible to admins', async () => {
    const orphan = await repo.create({ data: data('Orphan Roofing'), theme: 'slate', workspaceId: null });
    expect(await repo.getForWorkspace(orphan.id, 'ws-a')).toBeNull();
    expect(await repo.getBySlug(orphan.slug)).not.toBeNull(); // still public
  });

  test('malformed ids are a miss, not an error', async () => {
    expect(await repo.getForWorkspace('not-a-uuid', 'ws-a')).toBeNull();
    expect(await repo.softDeleteForWorkspace("1' OR '1'='1", 'ws-a')).toBe(false);
  });
});

describe('list aggregates (SQL GROUP BY)', () => {
  test('counts submissions and views per site, with last-viewed time', async () => {
    const s = await repo.create({ data: data('Counted Plumbing'), theme: 'slate', workspaceId: 'ws-a' });
    const other = await repo.create({ data: data('Quiet Painting'), theme: 'slate', workspaceId: 'ws-a' });
    await repo.createSubmission(s, { name: 'Ann', email: 'ann@example.com', phone: null, message: 'Hi' });
    await repo.createSubmission(s, { name: 'Bo', email: null, phone: '555-0100', message: null });
    await repo.recordView(s.id, { referrer: 'https://example.com', userAgent: 'Mozilla/5.0' });
    await repo.recordView(s.id);
    await repo.recordView(s.id);

    const list = await repo.listForWorkspace('ws-a');
    const row = list.find((r) => r.id === s.id)!;
    expect(row).toMatchObject({ submissionCount: 2, viewCount: 3 });
    expect(row.lastViewedAt).toEqual(expect.any(String));
    expect(list.find((r) => r.id === other.id)).toMatchObject({
      submissionCount: 0,
      viewCount: 0,
      lastViewedAt: null,
    });
  });
});

describe('writes', () => {
  test('slugs stay unique for same-named businesses', async () => {
    const one = await repo.create({ data: data('Twin Lawn Care'), theme: 'slate', workspaceId: 'ws-a' });
    const two = await repo.create({ data: data('Twin Lawn Care'), theme: 'slate', workspaceId: 'ws-b' });
    expect(one.slug).toBe('twin-lawn-care');
    expect(two.slug).toMatch(/^twin-lawn-care-[a-z0-9]{5}$/);
  });

  test('update sets updated_at and denormalized columns', async () => {
    const s = await repo.create({ data: data('Before Name'), theme: 'slate', workspaceId: 'ws-a' });
    await new Promise((r) => setTimeout(r, 5));
    const u = await repo.updateForWorkspace(s.id, 'ws-a', {
      data: data('After Name', 'https://www.google.com/maps/place/After/@1,2,3z'),
      photos: [{ url: 'https://x.example/h.jpg', alt: 'Hero', role: 'hero' }],
      notifyEmail: 'owner@example.com',
    });
    expect(u!.updatedAt > s.updatedAt).toBe(true);
    expect(u!.photos).toHaveLength(1);
    const [row] = await client
      .query<{ business_name: string; maps_url: string }>(`SELECT business_name, maps_url FROM sites WHERE id = $1`, [s.id])
      .then((r) => r.rows);
    expect(row).toEqual({ business_name: 'After Name', maps_url: 'https://www.google.com/maps/place/After/@1,2,3z' });
  });

  test('a custom domain can belong to only one site', async () => {
    const a = await repo.create({ data: data('Domain One'), theme: 'slate', workspaceId: 'ws-a' });
    const b = await repo.create({ data: data('Domain Two'), theme: 'slate', workspaceId: 'ws-b' });
    await repo.updateForWorkspace(a.id, 'ws-a', { customDomain: 'domain-one.com' });
    await expect(repo.updateForWorkspace(b.id, 'ws-b', { customDomain: 'domain-one.com' })).rejects.toBeInstanceOf(
      CustomDomainTakenError
    );
  });

  test('publish / unpublish and live custom-domain lookup', async () => {
    const s = await repo.create({ data: data('Going Live'), theme: 'slate', workspaceId: 'ws-a' });
    await repo.updateForWorkspace(s.id, 'ws-a', { customDomain: 'going-live.com' });
    expect(await repo.getLiveByCustomDomain('going-live.com')).toBeNull(); // not live yet

    const live = await repo.publishForWorkspace(s.id, 'ws-a');
    expect(live).toMatchObject({ status: 'live', publishedAt: expect.any(String) });
    expect((await repo.getLiveByCustomDomain('going-live.com'))?.id).toBe(s.id);

    const back = await repo.unpublishForWorkspace(s.id, 'ws-a');
    expect(back?.status).toBe('draft');
    expect(await repo.getLiveByCustomDomain('going-live.com')).toBeNull();
  });

  test('soft delete hides the site everywhere; hard delete cascades', async () => {
    const s = await repo.create({ data: data('Short Lived'), theme: 'slate', workspaceId: 'ws-a' });
    await repo.createSubmission(s, { name: 'X', email: 'x@example.com', phone: null, message: null });
    expect(await repo.softDeleteForWorkspace(s.id, 'ws-a')).toBe(true);
    expect(await repo.getForWorkspace(s.id, 'ws-a')).toBeNull();
    expect(await repo.getBySlug(s.slug)).toBeNull();

    expect(await repo.hardDeleteForWorkspace(s.id, 'ws-a')).toBe(true);
    const { rows } = await client.query(`SELECT 1 FROM site_submissions WHERE site_id = $1`, [s.id]);
    expect(rows).toHaveLength(0);
  });
});

describe('generation idempotency against the real repository', () => {
  test('a lead gets one site unless forced', async () => {
    const generator = createGenerator({
      repo,
      fromLead: async (leadId, workspaceId) => ({ data: data('Acme'), workspaceId, leadId }),
      lookup: async () => data('Unused'),
      anthropicConfigured: () => true,
    });
    const first = await generator.fromLead({ leadId: 'lead-a', workspaceId: 'ws-a' });
    const again = await generator.fromLead({ leadId: 'lead-a', workspaceId: 'ws-a' });
    const forced = await generator.fromLead({ leadId: 'lead-a', workspaceId: 'ws-a', force: true });
    expect(again).toMatchObject({ reused: true, site: { id: first.site.id } });
    expect(forced.reused).toBe(false);
    expect(forced.site.id).not.toBe(first.site.id);
    // Reuse returns the newest site for the lead.
    expect((await repo.getByLeadForWorkspace('lead-a', 'ws-a'))?.id).toBe(forced.site.id);
  });
});
