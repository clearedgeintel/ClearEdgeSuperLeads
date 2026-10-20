// Generation idempotency: a lead reuses its site and cold input reuses the site
// for the same Maps URL, unless `force` is set; reuse never crosses workspaces.

import {
  createGenerator,
  GenerateInputError,
  GenerateUnavailableError,
  type GeneratorDeps,
} from '../../server/sites/generator';
import type { CreateSiteInput } from '../../server/sites/repository';
import { SAMPLE_BUSINESS } from '../../server/sites/template/sampleData';
import type { Site } from '../../shared/sites';

function fakeRepo() {
  const rows: Site[] = [];
  let n = 0;
  const repo: GeneratorDeps['repo'] = {
    async create(input: CreateSiteInput) {
      const site: Site = {
        id: `site-${++n}`,
        slug: `slug-${n}`,
        theme: input.theme,
        status: input.status ?? 'draft',
        data: input.data,
        workspaceId: input.workspaceId,
        leadId: input.leadId ?? null,
        createdBy: input.createdBy ?? null,
        photos: [],
        customDomain: null,
        notifyEmail: null,
        publishedAt: null,
        createdAt: new Date(Date.now() + n).toISOString(),
        updatedAt: new Date().toISOString(),
      };
      rows.unshift(site);
      return site;
    },
    async getByLeadForWorkspace(leadId, workspaceId) {
      return rows.find((s) => s.leadId === leadId && s.workspaceId === workspaceId) ?? null;
    },
    async getByMapsUrlForWorkspace(mapsUrl, workspaceId) {
      return rows.find((s) => s.data.mapsUrl === mapsUrl && s.workspaceId === workspaceId) ?? null;
    },
  };
  return { repo, rows };
}

const MAPS_URL = 'https://www.google.com/maps/place/Acme+Plumbing/@32.7767,-96.797,15z';

function setup(overrides: Partial<GeneratorDeps> = {}) {
  const { repo, rows } = fakeRepo();
  const fromLead = jest.fn(async (leadId: string, workspaceId: string | null) => ({
    data: { ...SAMPLE_BUSINESS, mapsUrl: '' },
    workspaceId,
    leadId,
  }));
  const lookup = jest.fn(async () => ({ ...SAMPLE_BUSINESS, mapsUrl: '' }));
  const generator = createGenerator({
    repo,
    fromLead,
    lookup,
    anthropicConfigured: () => true,
    ...overrides,
  });
  return { generator, rows, fromLead, lookup };
}

describe('generate from a lead', () => {
  test('reuses the lead’s existing site', async () => {
    const { generator, fromLead, rows } = setup();
    const a = await generator.fromLead({ leadId: 'lead-1', workspaceId: 'ws-a' });
    const b = await generator.fromLead({ leadId: 'lead-1', workspaceId: 'ws-a' });
    expect(a.reused).toBe(false);
    expect(b.reused).toBe(true);
    expect(b.site.id).toBe(a.site.id);
    expect(fromLead).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(1);
  });

  test('force builds a new site', async () => {
    const { generator, rows } = setup();
    const a = await generator.fromLead({ leadId: 'lead-1', workspaceId: 'ws-a' });
    const b = await generator.fromLead({ leadId: 'lead-1', workspaceId: 'ws-a', force: true });
    expect(b.reused).toBe(false);
    expect(b.site.id).not.toBe(a.site.id);
    expect(rows).toHaveLength(2);
  });

  test('records the lead, workspace and creator on the site', async () => {
    const { generator } = setup();
    const { site } = await generator.fromLead({ leadId: 'lead-9', workspaceId: 'ws-a', createdBy: 'u1' });
    expect(site).toMatchObject({ leadId: 'lead-9', workspaceId: 'ws-a', createdBy: 'u1', status: 'draft' });
  });

  test('a missing lead is a 422', async () => {
    const notFound = Object.assign(new Error('That lead was not found.'), { name: 'LeadNotFoundError' });
    const { generator } = setup({ fromLead: jest.fn().mockRejectedValue(notFound) });
    await expect(generator.fromLead({ leadId: 'nope', workspaceId: 'ws-a' })).rejects.toBeInstanceOf(
      GenerateInputError
    );
  });

  test('other lead errors are not turned into 422s', async () => {
    const { generator } = setup({ fromLead: jest.fn().mockRejectedValue(new Error('db down')) });
    await expect(generator.fromLead({ leadId: 'x', workspaceId: 'ws-a' })).rejects.not.toBeInstanceOf(
      GenerateInputError
    );
  });
});

describe('generate from cold input', () => {
  test('dedupes by resolved Maps URL', async () => {
    const { generator, lookup, rows } = setup();
    const a = await generator.fromInput({ input: MAPS_URL, workspaceId: 'ws-a' });
    const b = await generator.fromInput({ input: MAPS_URL, workspaceId: 'ws-a' });
    expect(a.site.data.mapsUrl).toBe(MAPS_URL);
    expect(b.reused).toBe(true);
    expect(b.site.id).toBe(a.site.id);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(1);
  });

  test('never reuses another workspace’s site', async () => {
    const { generator, rows } = setup();
    const a = await generator.fromInput({ input: MAPS_URL, workspaceId: 'ws-a' });
    const b = await generator.fromInput({ input: MAPS_URL, workspaceId: 'ws-b' });
    expect(b.reused).toBe(false);
    expect(b.site.id).not.toBe(a.site.id);
    expect(b.site.workspaceId).toBe('ws-b');
    expect(rows).toHaveLength(2);
  });

  test('force skips the dedupe', async () => {
    const { generator, rows } = setup();
    await generator.fromInput({ input: MAPS_URL, workspaceId: 'ws-a' });
    const b = await generator.fromInput({ input: MAPS_URL, workspaceId: 'ws-a', force: true });
    expect(b.reused).toBe(false);
    expect(rows).toHaveLength(2);
  });

  test('plain "Name, City" input has no Maps URL, so it is not deduped', async () => {
    const { generator, rows } = setup();
    await generator.fromInput({ input: 'Acme Plumbing, Dallas TX', workspaceId: 'ws-a' });
    await generator.fromInput({ input: 'Acme Plumbing, Dallas TX', workspaceId: 'ws-a' });
    expect(rows).toHaveLength(2);
  });

  test('passes the workspace through for usage tracking', async () => {
    const { generator, lookup } = setup();
    await generator.fromInput({ input: MAPS_URL, workspaceId: 'ws-a' });
    expect(lookup).toHaveBeenCalledWith('Acme Plumbing', expect.any(String), { workspaceId: 'ws-a' });
  });

  test('503 when research is not configured', async () => {
    const { generator } = setup({ anthropicConfigured: () => false });
    await expect(generator.fromInput({ input: MAPS_URL, workspaceId: 'ws-a' })).rejects.toBeInstanceOf(
      GenerateUnavailableError
    );
  });

  test('422 for an unusable link', async () => {
    const { generator } = setup();
    await expect(
      generator.fromInput({ input: 'https://www.google.com/maps/@30.2,-97.7,15z', workspaceId: 'ws-a' })
    ).rejects.toBeInstanceOf(GenerateInputError);
  });
});
