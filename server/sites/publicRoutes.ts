// Public site routes, mounted only by server/public.ts. Every request resolves
// at most one site — by slug on the default public host, or by Host header for
// a live site's custom domain — and only ever touches that site.

import express, { Router, type Request, type RequestHandler, type Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { z } from 'zod';
import { THEMES_LIST, type Site, type Theme } from '@shared/sites';
import type { SiteRepository } from './repository';
import type { SiteNotifier } from './notify';
import { renderSite } from './template/render';
import { SAMPLE_BUSINESS } from './template/sampleData';
import { HtmlCache } from './htmlCache';
import { isBot } from './bots';
import { verifyPreviewToken } from './previewToken';
import { isValidCustomDomain, normalizeCustomDomain } from './domain';

// 1x1 transparent GIF for the view pixel.
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

export interface PublicAppConfig {
  /** PUBLIC_SITE_BASE_URL, e.g. https://sites.clearedgeintel.com (null in dev). */
  publicBaseUrl: string | null;
  /** More hostnames that serve /s/:slug (e.g. the old Instant Site host after cutover). */
  extraHosts: string[];
  /** SITE_PREVIEW_SECRET; previews are refused without it. */
  previewSecret: string | null;
  /** Admin app origin, allowed to frame previews (APP_URL). */
  adminOrigin: string | null;
}

export interface PublicAppDeps {
  repo: Pick<SiteRepository, 'getBySlug' | 'getLiveByCustomDomain' | 'createSubmission' | 'recordView'>;
  notifier: Pick<SiteNotifier, 'onSubmission'>;
  config: PublicAppConfig;
  log: { info(obj: object, msg: string): void; error(obj: object, msg: string): void };
  cache?: HtmlCache;
  /** Contact-form limit per IP per site (default 5 per hour). */
  contactLimit?: { windowMs: number; max: number };
}

const contactSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    email: z.union([z.literal(''), z.string().trim().toLowerCase().email().max(320)]).optional(),
    phone: z.string().trim().max(50).optional(),
    message: z.string().trim().max(2000).optional(),
    website_hp: z.string().optional(),
  })
  .refine((v) => Boolean(v.email || v.phone), { message: 'An email or phone is required.' });

function normalizeHost(host: string | undefined): string {
  return normalizeCustomDomain(host || '');
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return normalizeHost(new URL(url).hostname);
  } catch {
    return null;
  }
}

function coerceTheme(input: unknown, fallback: Theme): Theme {
  return typeof input === 'string' && (THEMES_LIST as readonly string[]).includes(input)
    ? (input as Theme)
    : fallback;
}

/** Security headers. No scripts run on site pages; previews may be framed by the admin app. */
function securityHeaders(res: Response, frameAncestors: string) {
  res.set({
    'Content-Security-Policy': [
      "default-src 'none'",
      "style-src 'unsafe-inline' https://fonts.googleapis.com",
      'font-src https://fonts.gstatic.com',
      "img-src 'self' https: data:",
      "form-action 'self'",
      "base-uri 'none'",
      `frame-ancestors ${frameAncestors}`,
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  });
}

export function createPublicApp(deps: PublicAppDeps): express.Express {
  const { repo, config, log } = deps;
  const cache = deps.cache ?? new HtmlCache(500);
  const defaultHosts = new Set(
    [hostOf(config.publicBaseUrl), ...config.extraHosts.map(normalizeHost), 'localhost', '127.0.0.1'].filter(
      (h): h is string => !!h
    )
  );

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Railway's edge proxy: req.ip is the client
  app.use(express.urlencoded({ extended: false, limit: '20kb' }));

  // Before host routing: Railway's healthcheck uses its own Host header.
  app.get('/healthz', (_req, res) => {
    res.status(200).json({ ok: true, service: 'clearedge-public-sites' });
  });

  const notFound = (res: Response) => res.status(404).type('text/plain').send('Not found.');

  function baseUrlFor(req: Request): string {
    return config.publicBaseUrl ?? `${req.protocol}://${req.get('host')}`;
  }

  // ── Rendering ───────────────────────────────────────────────

  interface RenderTarget {
    site: Site;
    /** Where the page lives: the custom domain root, or the /s/:slug URL. */
    pageUrl: string;
    submitUrl: string;
    pixelUrl: string;
    variant: string;
  }

  function sendSite(req: Request, res: Response, target: RenderTarget) {
    const { site } = target;
    const live = site.status === 'live';
    const submitted = req.query.sent === '1';
    const key = HtmlCache.key(site.id, site.updatedAt, `${target.variant}|${submitted ? 1 : 0}`);
    let html = cache.get(key);
    if (!html) {
      html = renderSite(site.data, site.theme, {
        mode: live ? 'live' : 'demo',
        canonicalUrl: live ? target.pageUrl : undefined,
        pageUrl: target.pageUrl,
        submitUrl: target.submitUrl,
        pixelUrl: target.pixelUrl,
        submitted,
        photos: site.photos,
      });
      cache.set(key, html);
    }
    securityHeaders(res, "'none'");
    if (!live) res.set('X-Robots-Tag', 'noindex, nofollow');
    res.set('Cache-Control', 'public, max-age=0, must-revalidate').type('text/html').send(html);
  }

  function sendPreview(req: Request, res: Response, site: Site) {
    const live = site.status === 'live';
    const pageUrl = `${baseUrlFor(req)}/s/${encodeURIComponent(site.slug)}`;
    const html = renderSite(site.data, coerceTheme(req.query.theme, site.theme), {
      mode: live ? 'live' : 'demo',
      canonicalUrl: live ? pageUrl : undefined,
      pageUrl,
      photos: site.photos,
      // No submitUrl and no pixel: previews never post the form or count a view.
    });
    securityHeaders(res, ["'self'", config.adminOrigin].filter(Boolean).join(' '));
    res
      .set('X-Robots-Tag', 'noindex, nofollow')
      .set('Cache-Control', 'no-store')
      .type('text/html')
      .send(html);
  }

  async function sendPixel(req: Request, res: Response, site: Site | null) {
    try {
      const ua = req.get('user-agent');
      if (site && !isBot(ua) && req.query.preview === undefined) {
        await repo.recordView(site.id, { referrer: req.get('referer') ?? null, userAgent: ua ?? null });
      }
    } catch (err) {
      log.error({ err }, '[public] pixel view failed'); // never let tracking break the pixel
    }
    res.set('Cache-Control', 'no-store, max-age=0').type('image/gif').send(PIXEL);
  }

  // ── Contact form ────────────────────────────────────────────

  const limit = deps.contactLimit ?? { windowMs: 60 * 60 * 1000, max: 5 };
  const contactLimiter = (siteKey: (req: Request) => string, back: (req: Request) => string) =>
    rateLimit({
      windowMs: limit.windowMs,
      limit: limit.max,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? '')}|${siteKey(req)}`,
      handler: (req, res) => {
        res.redirect(303, `${back(req)}?sent=0#contact`);
      },
    });

  async function handleContact(req: Request, res: Response, site: Site | null, back: string) {
    if (!site) return notFound(res);
    if (req.body?.website_hp) {
      // Honeypot: accept silently without storing.
      return res.redirect(303, `${back}?sent=1#contact`);
    }
    const parsed = contactSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.redirect(303, `${back}?sent=0#contact`);
    const f = parsed.data;
    try {
      const submission = await repo.createSubmission(site, {
        name: f.name,
        email: f.email || null,
        phone: f.phone || null,
        message: f.message || null,
      });
      // The row is saved; notification runs after the response and never throws.
      void deps.notifier.onSubmission(site, submission);
      res.redirect(303, `${back}?sent=1#contact`);
    } catch (err) {
      log.error({ err, siteId: site.id }, '[public] contact submit failed');
      res.redirect(303, `${back}?sent=0#contact`);
    }
  }

  // ── Default public host: /s/:slug ───────────────────────────

  const slugSite = async (req: Request) =>
    req.params.slug === 'sample' ? null : repo.getBySlug(req.params.slug);

  const onDefault = Router();

  onDefault.get('/robots.txt', (_req, res) => {
    // Demo sites portray businesses that haven't agreed to anything: never index.
    res.type('text/plain').send('User-agent: *\nDisallow: /\n');
  });

  onDefault.get('/s/:slug/pixel.gif', async (req, res) => {
    let site: Site | null = null;
    try {
      site = await slugSite(req);
    } catch (err) {
      log.error({ err }, '[public] pixel lookup failed');
    }
    await sendPixel(req, res, site);
  });

  onDefault.post(
    '/s/:slug/contact',
    contactLimiter(
      (req) => `slug:${req.params.slug}`,
      (req) => `/s/${encodeURIComponent(req.params.slug)}`
    ),
    async (req, res) => {
      const site = await slugSite(req).catch(() => null);
      await handleContact(req, res, site, `/s/${encodeURIComponent(req.params.slug)}`);
    }
  );

  // Instant Site pages posted the form here. Keep it for 90 days after cutover.
  onDefault.post('/api/sites/:slug/contact', (req, res) => {
    res.redirect(308, `/s/${encodeURIComponent(req.params.slug)}/contact`);
  });

  onDefault.get('/s/:slug', async (req, res) => {
    try {
      if (req.params.slug === 'sample') {
        securityHeaders(res, "'none'");
        res.set('X-Robots-Tag', 'noindex, nofollow');
        return res
          .type('text/html')
          .send(renderSite(SAMPLE_BUSINESS, coerceTheme(req.query.theme, 'slate'), { submitted: req.query.sent === '1' }));
      }
      const site = await repo.getBySlug(req.params.slug);
      if (!site) return notFound(res);

      if (req.query.preview !== undefined) {
        const token = typeof req.query.token === 'string' ? req.query.token : undefined;
        if (!config.previewSecret || !verifyPreviewToken(token, site.id, config.previewSecret)) {
          return res.status(403).type('text/plain').send('This preview link has expired.');
        }
        return sendPreview(req, res, site);
      }

      if (site.status === 'live' && site.customDomain && isValidCustomDomain(site.customDomain)) {
        return res.redirect(301, `https://${site.customDomain}/`);
      }

      const pageUrl = `${baseUrlFor(req)}/s/${encodeURIComponent(site.slug)}`;
      sendSite(req, res, {
        site,
        pageUrl,
        submitUrl: `/s/${encodeURIComponent(site.slug)}/contact`,
        pixelUrl: `/s/${encodeURIComponent(site.slug)}/pixel.gif`,
        variant: 'slug',
      });
    } catch (err) {
      log.error({ err }, '[public] render failed');
      res.status(500).type('text/plain').send('Something went wrong rendering this site.');
    }
  });

  // ── Custom domain host: one live site ───────────────────────

  const onDomain = Router();
  const domainSite = (res: Response) => res.locals.site as Site;

  onDomain.get('/', (req, res) => {
    const site = domainSite(res);
    sendSite(req, res, {
      site,
      pageUrl: `https://${site.customDomain}/`,
      submitUrl: '/contact',
      pixelUrl: '/pixel.gif',
      variant: 'domain',
    });
  });

  onDomain.post(
    '/contact',
    contactLimiter(
      (req) => `domain:${normalizeHost(req.hostname)}`,
      () => '/'
    ),
    async (req, res) => {
      await handleContact(req, res, domainSite(res), '/');
    }
  );

  onDomain.get('/pixel.gif', (req, res) => sendPixel(req, res, domainSite(res)));

  onDomain.get('/robots.txt', (_req, res) => {
    const site = domainSite(res);
    res.type('text/plain').send(`User-agent: *\nAllow: /\nSitemap: https://${site.customDomain}/sitemap.xml\n`);
  });

  onDomain.get('/sitemap.xml', (_req, res) => {
    const site = domainSite(res);
    const lastmod = site.updatedAt.slice(0, 10);
    res
      .type('application/xml')
      .send(
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://${site.customDomain}/</loc><lastmod>${lastmod}</lastmod></url>\n</urlset>\n`
      );
  });

  onDomain.use((_req, res) => notFound(res));

  // ── Host routing ────────────────────────────────────────────

  const route: RequestHandler = async (req, res, next) => {
    const host = normalizeHost(req.hostname);
    if (defaultHosts.has(host)) return onDefault(req, res, next);
    try {
      const site = isValidCustomDomain(host) ? await repo.getLiveByCustomDomain(host) : null;
      if (!site) return notFound(res); // unknown host: never fall through to another site
      res.locals.site = site;
      return onDomain(req, res, next);
    } catch (err) {
      log.error({ err }, '[public] host lookup failed');
      res.status(500).type('text/plain').send('Something went wrong.');
    }
  };
  app.use(route);
  app.use((_req, res) => notFound(res));

  return app;
}
