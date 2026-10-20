// /api/sites router: strict validation (no mass assignment), workspace
// scoping of every call, publish validation, role gate on hard delete, and
// photo upload checks. Repository and generator are fakes.

import express from 'express';
import request from 'supertest';
import { createSitesRouter, type SitesRouterDeps } from '../../server/sites/routes';
import type { SiteRepository } from '../../server/sites/repository';
import type { SiteGenerator } from '../../server/sites/generator';
import { SAMPLE_BUSINESS } from '../../server/sites/template/sampleData';
import type { Site } from '../../shared/sites';

jest.mock('../../server/lib/logger', () => ({
  logger: { warn: jest.fn(), debug: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

const SITE_ID = '3f2b8a52-6f5e-4a8e-9a43-0d6c1f0b8e11';

function makeSite(overrides: Partial<Site> = {}): Site {
  return {
    id: SITE_ID,
    slug: 'acme',
    theme: 'slate',
    status: 'draft',
    data: { ...SAMPLE_BUSINESS },
    workspaceId: 'ws-a',
    leadId: null,
    createdBy: null,
    photos: [],
    customDomain: null,
    notifyEmail: null,
    publishedAt: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function setup(opts: { workspace?: boolean; role?: string; site?: Site | null; base?: string | null } = {}) {
  const site = opts.site === undefined ? makeSite() : opts.site;
  const repo = {
    listForWorkspace: jest.fn().mockResolvedValue([]),
    getForWorkspace: jest.fn().mockResolvedValue(site),
    updateForWorkspace: jest.fn(async (_id: string, _ws: string, patch: object) =>
      site ? { ...site, ...patch } : null
    ),
    publishForWorkspace: jest.fn().mockResolvedValue(site && { ...site, status: 'live' }),
    unpublishForWorkspace: jest.fn().mockResolvedValue(site),
    softDeleteForWorkspace: jest.fn().mockResolvedValue(true),
    hardDeleteForWorkspace: jest.fn().mockResolvedValue(true),
    listSubmissionsForWorkspace: jest.fn().mockResolvedValue([]),
  };
  const generator = {
    fromLead: jest.fn().mockResolvedValue({ site: makeSite(), reused: false }),
    fromInput: jest.fn().mockResolvedValue({ site: makeSite(), reused: true }),
  };
  const photos = {
    isConfigured: jest.fn().mockReturnValue(true),
    upload: jest.fn().mockResolvedValue('https://storage.example.com/p/new.jpg'),
  };
  const deps: SitesRouterDeps = {
    repo: repo as unknown as SiteRepository,
    generator: generator as unknown as SiteGenerator,
    publicBaseUrl: () => (opts.base === undefined ? 'https://sites.example.com' : opts.base),
    previewSecret: () => 'test-preview-secret',
    photos,
  };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { session: object }).session = { user: { id: 'u1', role: opts.role ?? 'member' } };
    if (opts.workspace !== false) (req as unknown as { workspace: object }).workspace = { id: 'ws-a' };
    next();
  });
  app.use('/api/sites', createSitesRouter(deps));
  return { app, repo, generator, photos };
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);

describe('workspace gate', () => {
  test('403 without a workspace, and nothing is queried', async () => {
    const { app, repo } = setup({ workspace: false });
    await request(app).get('/api/sites').expect(403);
    await request(app).get(`/api/sites/${SITE_ID}`).expect(403);
    expect(repo.listForWorkspace).not.toHaveBeenCalled();
    expect(repo.getForWorkspace).not.toHaveBeenCalled();
  });

  test('every lookup is scoped to the request’s workspace', async () => {
    const { app, repo } = setup();
    await request(app).get('/api/sites').expect(200);
    await request(app).get(`/api/sites/${SITE_ID}`).expect(200);
    await request(app).get(`/api/sites/${SITE_ID}/submissions`).expect(200);
    expect(repo.listForWorkspace).toHaveBeenCalledWith('ws-a');
    expect(repo.getForWorkspace).toHaveBeenCalledWith(SITE_ID, 'ws-a');
    expect(repo.listSubmissionsForWorkspace).toHaveBeenCalledWith(SITE_ID, 'ws-a');
  });

  test('a site the repository does not return (other workspace) is a 404', async () => {
    const { app } = setup({ site: null });
    await request(app).get(`/api/sites/${SITE_ID}`).expect(404);
    await request(app).patch(`/api/sites/${SITE_ID}`).send({ theme: 'warm' }).expect(404);
    await request(app).post(`/api/sites/${SITE_ID}/publish`).expect(404);
  });
});

describe('PATCH /api/sites/:id', () => {
  test.each([
    ['status', { status: 'live' }],
    ['workspaceId', { workspaceId: 'ws-b' }],
    ['slug', { slug: 'stolen' }],
    ['publishedAt', { theme: 'warm', publishedAt: '2026-01-01' }],
  ])('rejects unknown key %s without writing', async (_k, body) => {
    const { app, repo } = setup();
    const res = await request(app).patch(`/api/sites/${SITE_ID}`).send(body).expect(400);
    expect(res.body.details.join(' ')).toMatch(/unrecognized key/i);
    expect(repo.updateForWorkspace).not.toHaveBeenCalled();
  });

  test('rejects unknown keys inside data', async () => {
    const { app, repo } = setup();
    await request(app)
      .patch(`/api/sites/${SITE_ID}`)
      .send({ data: { ...SAMPLE_BUSINESS, isAdmin: true } })
      .expect(400);
    expect(repo.updateForWorkspace).not.toHaveBeenCalled();
  });

  test('rejects an empty patch and bad values', async () => {
    const { app } = setup();
    await request(app).patch(`/api/sites/${SITE_ID}`).send({}).expect(400);
    await request(app).patch(`/api/sites/${SITE_ID}`).send({ theme: 'neon' }).expect(400);
    await request(app).patch(`/api/sites/${SITE_ID}`).send({ notifyEmail: 'nope' }).expect(400);
    await request(app).patch(`/api/sites/${SITE_ID}`).send({ customDomain: 'not a domain' }).expect(400);
    await request(app)
      .patch(`/api/sites/${SITE_ID}`)
      .send({ photos: [{ url: 'https://x.example/a.jpg', alt: '', role: 'banner' }] })
      .expect(400);
  });

  test('normalizes email and domain, scoped to the workspace', async () => {
    const { app, repo } = setup();
    await request(app)
      .patch(`/api/sites/${SITE_ID}`)
      .send({ notifyEmail: ' Owner@Example.com ', customDomain: 'https://WWW.Acme-Plumbing.com/' })
      .expect(200);
    expect(repo.updateForWorkspace).toHaveBeenCalledWith(SITE_ID, 'ws-a', {
      notifyEmail: 'owner@example.com',
      customDomain: 'acme-plumbing.com',
    });
  });

  test('empty strings clear email and domain', async () => {
    const { app, repo } = setup();
    await request(app).patch(`/api/sites/${SITE_ID}`).send({ notifyEmail: '', customDomain: '' }).expect(200);
    expect(repo.updateForWorkspace).toHaveBeenCalledWith(SITE_ID, 'ws-a', {
      notifyEmail: null,
      customDomain: null,
    });
  });

  test('accepts full business data', async () => {
    const { app } = setup();
    await request(app).patch(`/api/sites/${SITE_ID}`).send({ data: SAMPLE_BUSINESS, theme: 'clean' }).expect(200);
  });
});

describe('publish', () => {
  test('422 with every validation error', async () => {
    const { app, repo } = setup();
    const res = await request(app).post(`/api/sites/${SITE_ID}/publish`).expect(422);
    expect(res.body.errors.length).toBeGreaterThanOrEqual(2);
    expect(repo.publishForWorkspace).not.toHaveBeenCalled();
  });

  test('a ready site goes live', async () => {
    const site = makeSite({
      notifyEmail: 'owner@example.com',
      data: {
        ...SAMPLE_BUSINESS,
        phone: '(512) 555-0100',
        testimonials: [{ text: 'Great.', author: 'Pat R.' }],
      },
    });
    const { app, repo } = setup({ site });
    const res = await request(app).post(`/api/sites/${SITE_ID}/publish`).expect(200);
    expect(res.body.status).toBe('live');
    expect(repo.publishForWorkspace).toHaveBeenCalledWith(SITE_ID, 'ws-a');
  });
});

describe('DELETE', () => {
  test('soft delete is open to members', async () => {
    const { app, repo } = setup();
    await request(app).delete(`/api/sites/${SITE_ID}`).expect(200);
    expect(repo.softDeleteForWorkspace).toHaveBeenCalledWith(SITE_ID, 'ws-a');
  });

  test('hard delete needs admin', async () => {
    const member = setup({ role: 'member' });
    await request(member.app).delete(`/api/sites/${SITE_ID}?hard=true`).expect(403);
    expect(member.repo.hardDeleteForWorkspace).not.toHaveBeenCalled();

    const admin = setup({ role: 'admin' });
    await request(admin.app).delete(`/api/sites/${SITE_ID}?hard=true`).expect(200);
    expect(admin.repo.hardDeleteForWorkspace).toHaveBeenCalledWith(SITE_ID, 'ws-a');
  });
});

describe('POST /api/sites/generate', () => {
  test('from a lead, in the request’s workspace', async () => {
    const { app, generator } = setup();
    const res = await request(app).post('/api/sites/generate').send({ leadId: 'lead-1' }).expect(200);
    expect(generator.fromLead).toHaveBeenCalledWith({
      leadId: 'lead-1',
      workspaceId: 'ws-a',
      createdBy: 'u1',
      force: undefined,
    });
    expect(res.body).toMatchObject({ slug: 'acme', url: 'https://sites.example.com/s/acme', reused: false });
  });

  test('from input; url is null without PUBLIC_SITE_BASE_URL', async () => {
    const { app, generator } = setup({ base: null });
    const res = await request(app)
      .post('/api/sites/generate')
      .send({ input: 'Acme Plumbing, Dallas TX', force: true })
      .expect(200);
    expect(generator.fromInput).toHaveBeenCalledWith(
      expect.objectContaining({ input: 'Acme Plumbing, Dallas TX', workspaceId: 'ws-a', force: true })
    );
    expect(res.body.url).toBeNull();
  });

  test('rejects unknown keys and a workspace override', async () => {
    const { app, generator } = setup();
    await request(app).post('/api/sites/generate').send({ leadId: 'l', workspaceId: 'ws-b' }).expect(400);
    await request(app).post('/api/sites/generate').send({}).expect(400);
    expect(generator.fromLead).not.toHaveBeenCalled();
  });
});

describe('POST /api/sites/:id/photos', () => {
  test('rejects files that are not JPEG/PNG/WebP by content', async () => {
    const { app, photos } = setup();
    await request(app)
      .post(`/api/sites/${SITE_ID}/photos`)
      .attach('file', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), {
        filename: 'x.jpg',
        contentType: 'image/jpeg',
      })
      .expect(415);
    expect(photos.upload).not.toHaveBeenCalled();
  });

  test('uploads, and a new hero demotes the old one', async () => {
    const site = makeSite({ photos: [{ url: 'https://storage.example.com/p/old.jpg', alt: 'Old', role: 'hero' }] });
    const { app, photos, repo } = setup({ site });
    await request(app)
      .post(`/api/sites/${SITE_ID}/photos`)
      .field('alt', 'Storefront')
      .field('role', 'hero')
      .attach('file', JPEG, { filename: 'a.jpg', contentType: 'image/jpeg' })
      .expect(201);
    expect(photos.upload).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws-a', siteId: SITE_ID, contentType: 'image/jpeg' })
    );
    expect(repo.updateForWorkspace).toHaveBeenCalledWith(SITE_ID, 'ws-a', {
      photos: [
        { url: 'https://storage.example.com/p/old.jpg', alt: 'Old', role: 'gallery' },
        { url: 'https://storage.example.com/p/new.jpg', alt: 'Storefront', role: 'hero' },
      ],
    });
  });

  test('503 when storage is not configured', async () => {
    const { app, photos } = setup();
    photos.isConfigured.mockReturnValue(false);
    await request(app)
      .post(`/api/sites/${SITE_ID}/photos`)
      .attach('file', JPEG, { filename: 'a.jpg', contentType: 'image/jpeg' })
      .expect(503);
  });
});

test('preview renders HTML without the form or the pixel', async () => {
  const { app } = setup();
  const res = await request(app).get(`/api/sites/${SITE_ID}/preview?theme=warm`).expect(200);
  expect(res.headers['content-type']).toMatch(/text\/html/);
  expect(res.headers['x-robots-tag']).toMatch(/noindex/);
  expect(res.text).toMatch(/^<!doctype html>/i);
  expect(res.text).not.toContain('pixel.gif');
  expect(res.text).not.toContain('<form');
});
