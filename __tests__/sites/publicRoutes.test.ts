// Public site server: host routing, demo/live rendering, previews, the quote
// form (honeypot, validation, rate limit, notification), the view pixel and
// robots/sitemap. Repository and notifier are fakes.

import request from 'supertest';
import { createPublicApp, type PublicAppDeps } from '../../server/sites/publicRoutes';
import { makePreviewToken } from '../../server/sites/previewToken';
import { SAMPLE_BUSINESS } from '../../server/sites/template/sampleData';
import type { Site, SiteSubmission } from '../../shared/sites';

const BASE = 'https://sites.example.com';
const SECRET = 'preview-secret';
const HUMAN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';

function makeSite(o: Partial<Site> = {}): Site {
  return {
    id: '3f2b8a52-6f5e-4a8e-9a43-0d6c1f0b8e11',
    slug: 'acme',
    theme: 'slate',
    status: 'draft',
    data: { ...SAMPLE_BUSINESS, name: 'Acme Roofing', phone: '(512) 555-0100' },
    workspaceId: 'ws-a',
    leadId: null,
    createdBy: null,
    photos: [],
    customDomain: null,
    notifyEmail: 'owner@example.com',
    publishedAt: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...o,
  };
}

function setup(sites: Site[] = [makeSite()], limit = { windowMs: 60_000, max: 5 }) {
  const repo = {
    getBySlug: jest.fn(async (slug: string) => sites.find((s) => s.slug === slug) ?? null),
    getLiveByCustomDomain: jest.fn(
      async (d: string) => sites.find((s) => s.customDomain === d && s.status === 'live') ?? null
    ),
    createSubmission: jest.fn(
      async (site: Site, f: Pick<SiteSubmission, 'name' | 'email' | 'phone' | 'message'>): Promise<SiteSubmission> => ({
        id: `sub-${Math.random()}`,
        siteId: site.id,
        leadId: site.leadId,
        workspaceId: site.workspaceId,
        ...f,
        createdAt: new Date().toISOString(),
      })
    ),
    recordView: jest.fn().mockResolvedValue(undefined),
  };
  const notifier = { onSubmission: jest.fn().mockResolvedValue('sent') };
  const deps: PublicAppDeps = {
    repo,
    notifier,
    config: { publicBaseUrl: BASE, extraHosts: ['old-sites.example.net'], previewSecret: SECRET, adminOrigin: 'https://app.example.com' },
    log: { info: jest.fn(), error: jest.fn() },
    contactLimit: limit,
  };
  return { app: createPublicApp(deps), repo, notifier };
}

const onBase = (r: request.Test) => r.set('Host', 'sites.example.com');

describe('health and host routing', () => {
  test('/healthz answers on any host', async () => {
    const { app } = setup();
    await request(app).get('/healthz').set('Host', 'healthcheck.railway.app').expect(200, { ok: true, service: 'clearedge-public-sites' });
  });

  test('unknown hosts are a 404 and never fall through to another site', async () => {
    const { app, repo } = setup([makeSite({ status: 'live', customDomain: 'acme-roofing.com' })]);
    await request(app).get('/').set('Host', 'evil.example.org').expect(404);
    await request(app).get('/s/acme').set('Host', 'evil.example.org').expect(404);
    expect(repo.getBySlug).not.toHaveBeenCalled();
  });

  test('a custom domain only serves its site once it is live', async () => {
    const { app } = setup([makeSite({ status: 'draft', customDomain: 'acme-roofing.com' })]);
    await request(app).get('/').set('Host', 'acme-roofing.com').expect(404);
  });

  test('extra hosts (e.g. the old Instant Site host) serve /s/:slug', async () => {
    const { app } = setup();
    await request(app).get('/s/acme').set('Host', 'old-sites.example.net').expect(200);
  });
});

describe('default host', () => {
  test('robots.txt disallows everything', async () => {
    const { app } = setup();
    const res = await onBase(request(app).get('/robots.txt')).expect(200);
    expect(res.text).toBe('User-agent: *\nDisallow: /\n');
  });

  test('demo pages render with noindex (meta and header)', async () => {
    const { app } = setup();
    const res = await onBase(request(app).get('/s/acme')).expect(200);
    expect(res.headers['x-robots-tag']).toMatch(/noindex/);
    expect(res.text).toContain('content="noindex,nofollow"');
    expect(res.text).toContain('action="/s/acme/contact"');
    expect(res.text).toContain('src="/s/acme/pixel.gif"');
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });

  test('live site without a domain renders live at /s/:slug, canonical to itself', async () => {
    const { app } = setup([makeSite({ status: 'live' })]);
    const res = await onBase(request(app).get('/s/acme')).expect(200);
    expect(res.text).not.toContain('noindex');
    expect(res.headers['x-robots-tag']).toBeUndefined();
    expect(res.text).toContain(`<link rel="canonical" href="${BASE}/s/acme" />`);
    expect(res.text).toContain('application/ld+json');
  });

  test('live site with a custom domain 301s there', async () => {
    const { app } = setup([makeSite({ status: 'live', customDomain: 'acme-roofing.com' })]);
    const res = await onBase(request(app).get('/s/acme')).expect(301);
    expect(res.headers.location).toBe('https://acme-roofing.com/');
  });

  test('missing and soft-deleted sites 404', async () => {
    const { app } = setup([]);
    await onBase(request(app).get('/s/nope')).expect(404);
  });

  test('/s/sample renders the built-in fixture', async () => {
    const { app, repo } = setup([]);
    const res = await onBase(request(app).get('/s/sample')).expect(200);
    expect(res.text).toContain(SAMPLE_BUSINESS.name);
    expect(repo.getBySlug).not.toHaveBeenCalled();
  });

  test('legacy Instant Site form path 308s to the new one', async () => {
    const { app } = setup();
    const res = await onBase(request(app).post('/api/sites/acme/contact')).expect(308);
    expect(res.headers.location).toBe('/s/acme/contact');
  });

  test('renders are cached per site version', async () => {
    const site = makeSite();
    const { app } = setup([site]);
    const first = await onBase(request(app).get('/s/acme'));
    site.data = { ...site.data, tagline: 'Changed without bumping updated_at' };
    const second = await onBase(request(app).get('/s/acme'));
    expect(second.text).toBe(first.text); // served from cache
    site.updatedAt = '2026-10-02T00:00:00.000Z';
    const third = await onBase(request(app).get('/s/acme'));
    expect(third.text).toContain('Changed without bumping updated_at');
  });
});

describe('preview', () => {
  test('needs a valid signed token for that site', async () => {
    const site = makeSite({ status: 'live', customDomain: 'acme-roofing.com' });
    const { app } = setup([site]);
    await onBase(request(app).get('/s/acme?preview=1')).expect(403);
    await onBase(request(app).get(`/s/acme?preview=1&token=${makePreviewToken('other-site', SECRET)}`)).expect(403);
    await onBase(request(app).get(`/s/acme?preview=1&token=${makePreviewToken(site.id, 'wrong-secret')}`)).expect(403);
    const expired = makePreviewToken(site.id, SECRET, Date.now() - 60 * 60 * 1000);
    await onBase(request(app).get(`/s/acme?preview=1&token=${expired}`)).expect(403);
  });

  test('renders without redirecting, posting or counting, and frames into the admin app', async () => {
    const site = makeSite({ status: 'live', customDomain: 'acme-roofing.com' });
    const { app, repo } = setup([site]);
    const token = encodeURIComponent(makePreviewToken(site.id, SECRET));
    const res = await onBase(request(app).get(`/s/acme?preview=1&token=${token}&theme=warm`)).expect(200);
    expect(res.text).not.toContain('<form');
    expect(res.text).not.toContain('pixel.gif');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-robots-tag']).toMatch(/noindex/);
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'self' https://app.example.com");
    expect(repo.recordView).not.toHaveBeenCalled();
  });
});

describe('quote form', () => {
  const post = (app: Express.Application, body: Record<string, string>, ip = '203.0.113.7') =>
    onBase(request(app as never).post('/s/acme/contact').set('X-Forwarded-For', ip).type('form').send(body));

  test('saves, notifies, and redirects to the thank-you state', async () => {
    const { app, repo, notifier } = setup();
    const res = await post(app, { name: 'Jamie', email: 'Jamie@Example.com', message: 'Leak' }).expect(303);
    expect(res.headers.location).toBe('/s/acme?sent=1#contact');
    expect(repo.createSubmission).toHaveBeenCalledWith(expect.objectContaining({ id: makeSite().id }), {
      name: 'Jamie',
      email: 'jamie@example.com',
      phone: null,
      message: 'Leak',
    });
    await new Promise((r) => setImmediate(r));
    expect(notifier.onSubmission).toHaveBeenCalledTimes(1);
  });

  test('honeypot: accepted silently, nothing stored', async () => {
    const { app, repo, notifier } = setup();
    const res = await post(app, { name: 'Bot', email: 'b@example.com', website_hp: 'http://spam' }).expect(303);
    expect(res.headers.location).toBe('/s/acme?sent=1#contact');
    expect(repo.createSubmission).not.toHaveBeenCalled();
    expect(notifier.onSubmission).not.toHaveBeenCalled();
  });

  test.each([
    [{ email: 'a@example.com' }], // no name
    [{ name: 'Jamie' }], // no email or phone
    [{ name: 'Jamie', email: 'not-an-email' }],
    [{ name: 'x'.repeat(201), phone: '555-0100' }],
  ])('rejects %p without storing', async (body) => {
    const { app, repo } = setup();
    const res = await post(app, body as Record<string, string>).expect(303);
    expect(res.headers.location).toBe('/s/acme?sent=0#contact');
    expect(repo.createSubmission).not.toHaveBeenCalled();
  });

  test('5 per hour per IP per site', async () => {
    const { app, repo } = setup([makeSite(), makeSite({ id: 'b', slug: 'bolt' })]);
    for (let i = 0; i < 5; i++) await post(app, { name: `P${i}`, phone: '555-0100' }).expect(303);
    const sixth = await post(app, { name: 'P6', phone: '555-0100' }).expect(303);
    expect(sixth.headers.location).toBe('/s/acme?sent=0#contact');
    expect(repo.createSubmission).toHaveBeenCalledTimes(5);

    // Another IP, or the same IP on another site, is unaffected.
    await post(app, { name: 'Other', phone: '555-0100' }, '198.51.100.9').expect(303);
    await onBase(
      request(app).post('/s/bolt/contact').set('X-Forwarded-For', '203.0.113.7').type('form').send({ name: 'B', phone: '1' })
    ).expect(303);
    expect(repo.createSubmission).toHaveBeenCalledTimes(7);
  });

  test('unknown site is a 404', async () => {
    const { app } = setup([]);
    await post(app, { name: 'Jamie', phone: '555' }).expect(404);
  });
});

describe('view pixel', () => {
  test('counts people, not bots, and is never cached', async () => {
    const { app, repo } = setup();
    const res = await onBase(request(app).get('/s/acme/pixel.gif').set('User-Agent', HUMAN).set('Referer', 'https://mail.example.com/')).expect(200);
    expect(res.headers['content-type']).toBe('image/gif');
    expect(res.headers['cache-control']).toMatch(/no-store/);
    expect(repo.recordView).toHaveBeenCalledWith(makeSite().id, { referrer: 'https://mail.example.com/', userAgent: HUMAN });

    await onBase(request(app).get('/s/acme/pixel.gif').set('User-Agent', 'Mozilla/5.0 (compatible; Googlebot/2.1)')).expect(200);
    await onBase(request(app).get('/s/acme/pixel.gif').set('User-Agent', 'Slackbot-LinkExpanding 1.0')).expect(200);
    await onBase(request(app).get('/s/acme/pixel.gif').set('User-Agent', HUMAN).query({ preview: '1' })).expect(200);
    expect(repo.recordView).toHaveBeenCalledTimes(1);
  });

  test('still returns the gif for unknown sites or tracking errors', async () => {
    const { app, repo } = setup();
    repo.recordView.mockRejectedValueOnce(new Error('db down'));
    await onBase(request(app).get('/s/acme/pixel.gif').set('User-Agent', HUMAN)).expect(200);
    await onBase(request(app).get('/s/nope/pixel.gif').set('User-Agent', HUMAN)).expect(200);
  });
});

describe('custom domain host', () => {
  const live = () => makeSite({ status: 'live', customDomain: 'acme-roofing.com' });

  test('serves the site at / on the domain and www.', async () => {
    const { app } = setup([live()]);
    for (const host of ['acme-roofing.com', 'www.acme-roofing.com', 'ACME-Roofing.com']) {
      const res = await request(app).get('/').set('Host', host).expect(200);
      expect(res.text).toContain('<link rel="canonical" href="https://acme-roofing.com/" />');
      expect(res.text).toContain('action="/contact"');
      expect(res.text).not.toContain('noindex');
    }
  });

  test('robots.txt allows crawling and points at the sitemap', async () => {
    const { app } = setup([live()]);
    const res = await request(app).get('/robots.txt').set('Host', 'acme-roofing.com').expect(200);
    expect(res.text).toBe('User-agent: *\nAllow: /\nSitemap: https://acme-roofing.com/sitemap.xml\n');
  });

  test('sitemap.xml lists the one page', async () => {
    const { app } = setup([live()]);
    const res = await request(app).get('/sitemap.xml').set('Host', 'acme-roofing.com').expect(200);
    expect(res.headers['content-type']).toMatch(/xml/);
    expect(res.text).toContain('<loc>https://acme-roofing.com/</loc>');
    expect(res.text).toContain('<lastmod>2026-10-01</lastmod>');
  });

  test('contact and pixel work on the domain; other paths 404', async () => {
    const { app, repo } = setup([live()]);
    const res = await request(app)
      .post('/contact')
      .set('Host', 'acme-roofing.com')
      .type('form')
      .send({ name: 'Jamie', phone: '555-0100' })
      .expect(303);
    expect(res.headers.location).toBe('/?sent=1#contact');
    expect(repo.createSubmission).toHaveBeenCalledTimes(1);
    await request(app).get('/pixel.gif').set('Host', 'acme-roofing.com').set('User-Agent', HUMAN).expect(200);
    expect(repo.recordView).toHaveBeenCalledTimes(1);
    await request(app).get('/s/acme').set('Host', 'acme-roofing.com').expect(404);
    await request(app).get('/admin').set('Host', 'acme-roofing.com').expect(404);
  });
});
