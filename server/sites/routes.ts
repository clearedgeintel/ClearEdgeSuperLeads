// Admin API for sites, mounted at /api/sites behind requireAuth. Every query
// is scoped to req.workspace.id; a site in another workspace is a 404.

import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import { z } from 'zod';
import {
  THEMES_LIST,
  businessDataSchema,
  sitePhotoSchema,
  type GenerateResponse,
  type Site,
  type SitePhoto,
} from '@shared/sites';
import { validateBody } from '../middleware/validate';
import { aiLimiter } from '../middleware/rateLimit';
import { requireRole } from '../middleware/requireRole';
import { logger } from '../lib/logger';
import type { SiteRepository } from './repository';
import { CustomDomainTakenError } from './repository';
import type { SiteGenerator } from './generator';
import { GenerateInputError, GenerateUnavailableError } from './generator';
import { validatePublish } from './publish';
import { isValidCustomDomain, normalizeCustomDomain } from './domain';
import { MAX_PHOTO_BYTES, sniffImageType, type PhotoContentType } from './photos';
import { renderSite } from './template/render';
import { makePreviewToken } from './previewToken';
import type { DomainCheckResult } from './domainCheck';

export const MAX_PHOTOS_PER_SITE = 30;

export interface SitesRouterDeps {
  repo: SiteRepository;
  generator: SiteGenerator;
  /** PUBLIC_SITE_BASE_URL without a trailing slash, or null when unset. */
  publicBaseUrl(): string | null;
  /** SITE_PREVIEW_SECRET (shared with the public server), or null when unset. */
  previewSecret(): string | null;
  /** DNS + HTTPS readiness of a site's custom domain. */
  checkDomain(site: Site): Promise<DomainCheckResult>;
  photos: {
    isConfigured(): boolean;
    upload(opts: {
      workspaceId: string;
      siteId: string;
      buffer: Buffer;
      contentType: PhotoContentType;
    }): Promise<string>;
  };
}

// ── Request schemas (strict: unknown keys are rejected) ───────

export const generateSchema = z.union([
  z.object({ leadId: z.string().trim().min(1).max(200), force: z.boolean().optional() }).strict(),
  z
    .object({
      input: z.string().trim().min(2).max(2000),
      locHint: z.string().trim().max(200).optional(),
      force: z.boolean().optional(),
    })
    .strict(),
]);

const notifyEmail = z
  .union([z.literal(''), z.string().trim().toLowerCase().email().max(320)])
  .nullable()
  .transform((v) => (v ? v : null));

const customDomain = z
  .string()
  .max(300)
  .nullable()
  .transform((v, ctx) => {
    if (v === null || !v.trim()) return null;
    const d = normalizeCustomDomain(v);
    if (!isValidCustomDomain(d)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `"${v}" is not a valid domain name` });
      return z.NEVER;
    }
    return d;
  });

export const patchSchema = z
  .object({
    data: businessDataSchema.optional(),
    theme: z.enum(THEMES_LIST).optional(),
    photos: z.array(sitePhotoSchema).max(MAX_PHOTOS_PER_SITE).optional(),
    notifyEmail: notifyEmail.optional(),
    customDomain: customDomain.optional(),
    customDomainWww: z.boolean().optional(),
  })
  .strict()
  .refine((p) => Object.keys(p).length > 0, { message: 'Nothing to update.' });

const photoFieldsSchema = z
  .object({
    alt: z.string().trim().max(300).default(''),
    role: z.enum(['hero', 'gallery']).default('gallery'),
  })
  .strict();

// ── Router ────────────────────────────────────────────────────

const requireWorkspaceStrict: RequestHandler = (req, res, next) => {
  if (!req.workspace) {
    return res.status(403).json({ message: 'Sites need a workspace. Join or create one first.' });
  }
  next();
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PHOTO_BYTES, files: 1, fields: 5 },
});

const uploadOne: RequestHandler = (req, res, next) => {
  upload.single('file')(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      return res
        .status(tooBig ? 413 : 400)
        .json({ message: tooBig ? 'Photos must be 10 MB or smaller.' : err.message });
    }
    if (err) return next(err);
    next();
  });
};

export function createSitesRouter(deps: SitesRouterDeps): Router {
  const { repo, generator } = deps;
  const router = Router();
  const publicUrl = (slug: string) => {
    const base = deps.publicBaseUrl();
    return base ? `${base}/s/${encodeURIComponent(slug)}` : null;
  };
  router.use(requireWorkspaceStrict);

  const ws = (req: Parameters<RequestHandler>[0]) => req.workspace!.id;
  const userId = (req: Parameters<RequestHandler>[0]) => req.session?.user?.id ?? null;
  const notFound = (res: Parameters<RequestHandler>[1]) =>
    res.status(404).json({ message: 'Site not found.' });
  const fail = (res: Parameters<RequestHandler>[1], err: unknown, what: string) => {
    logger.error({ err }, `[sites] ${what} failed`);
    res.status(500).json({ message: `Could not ${what}.` });
  };

  router.get('/config', (_req, res) => {
    res.json({
      publicBaseUrl: deps.publicBaseUrl(),
      photoUploadsEnabled: deps.photos.isConfigured(),
    });
  });

  router.get('/', async (req, res) => {
    try {
      res.json(await repo.listForWorkspace(ws(req)));
    } catch (err) {
      fail(res, err, 'load sites');
    }
  });

  router.post('/generate', aiLimiter, validateBody(generateSchema), async (req, res) => {
    const body = req.body as z.infer<typeof generateSchema>;
    try {
      const { site, reused } =
        'leadId' in body
          ? await generator.fromLead({
              leadId: body.leadId,
              workspaceId: ws(req),
              createdBy: userId(req),
              force: body.force,
            })
          : await generator.fromInput({
              input: body.input,
              locHint: body.locHint,
              workspaceId: ws(req),
              createdBy: userId(req),
              force: body.force,
            });
      const payload: GenerateResponse = {
        id: site.id,
        slug: site.slug,
        data: site.data,
        url: publicUrl(site.slug),
        reused,
      };
      res.json(payload);
    } catch (err) {
      if (err instanceof GenerateInputError || err instanceof GenerateUnavailableError) {
        return res.status(err.status).json({ message: err.message });
      }
      fail(res, err, 'generate a site');
    }
  });

  router.get('/:id', async (req, res) => {
    try {
      const site = await repo.getForWorkspace(req.params.id, ws(req));
      if (!site) return notFound(res);
      res.json(site);
    } catch (err) {
      fail(res, err, 'load that site');
    }
  });

  // Where the editor iframe should load the preview from: the public server with
  // a short-lived signed token, or this app's authed preview when the public
  // server isn't configured (dev).
  router.get('/:id/preview-url', async (req, res) => {
    try {
      const site = await repo.getForWorkspace(req.params.id, ws(req));
      if (!site) return notFound(res);
      const base = deps.publicBaseUrl();
      const secret = deps.previewSecret();
      if (base && secret) {
        const token = makePreviewToken(site.id, secret);
        return res.json({
          url: `${base}/s/${encodeURIComponent(site.slug)}?preview=1&token=${encodeURIComponent(token)}`,
          external: true,
        });
      }
      res.json({ url: `/api/sites/${site.id}/preview`, external: false });
    } catch (err) {
      fail(res, err, 'create a preview link');
    }
  });

  router.get('/:id/domain-check', aiLimiter, async (req, res) => {
    try {
      const site = await repo.getForWorkspace(req.params.id, ws(req));
      if (!site) return notFound(res);
      if (!site.customDomain) return res.status(422).json({ message: 'Set a custom domain first.' });
      res.json(await deps.checkDomain(site));
    } catch (err) {
      fail(res, err, 'check that domain');
    }
  });

  // Authed preview for the editor iframe. Never posts the form or counts a view.
  router.get('/:id/preview', async (req, res) => {
    try {
      const site = await repo.getForWorkspace(req.params.id, ws(req));
      if (!site) return res.status(404).type('text/plain').send('Site not found.');
      const theme = (THEMES_LIST as readonly string[]).includes(String(req.query.theme))
        ? (req.query.theme as Site['theme'])
        : site.theme;
      res
        .set('Cache-Control', 'no-store')
        .set('X-Robots-Tag', 'noindex, nofollow')
        .type('text/html')
        .send(
          renderSite(site.data, theme, {
            mode: site.status === 'live' ? 'live' : 'demo',
            photos: site.photos,
          })
        );
    } catch (err) {
      logger.error({ err }, '[sites] preview failed');
      res.status(500).type('text/plain').send('Could not render the preview.');
    }
  });

  router.patch('/:id', validateBody(patchSchema), async (req, res) => {
    const patch = req.body as z.infer<typeof patchSchema>;
    try {
      const site = await repo.updateForWorkspace(req.params.id, ws(req), patch);
      if (!site) return notFound(res);
      res.json(site);
    } catch (err) {
      if (err instanceof CustomDomainTakenError) {
        return res.status(409).json({ message: err.message });
      }
      fail(res, err, 'update that site');
    }
  });

  router.post('/:id/publish', async (req, res) => {
    try {
      const site = await repo.getForWorkspace(req.params.id, ws(req));
      if (!site) return notFound(res);
      const errors = validatePublish(site);
      if (errors.length) {
        return res.status(422).json({ message: 'This site is not ready to go live.', errors });
      }
      res.json(await repo.publishForWorkspace(site.id, ws(req)));
    } catch (err) {
      fail(res, err, 'publish that site');
    }
  });

  router.post('/:id/unpublish', async (req, res) => {
    try {
      const site = await repo.unpublishForWorkspace(req.params.id, ws(req));
      if (!site) return notFound(res);
      res.json(site);
    } catch (err) {
      fail(res, err, 'unpublish that site');
    }
  });

  router.get('/:id/submissions', async (req, res) => {
    try {
      const submissions = await repo.listSubmissionsForWorkspace(req.params.id, ws(req));
      if (!submissions) return notFound(res);
      res.json(submissions);
    } catch (err) {
      fail(res, err, 'load submissions');
    }
  });

  router.post('/:id/photos', uploadOne, async (req, res) => {
    if (!deps.photos.isConfigured()) {
      return res.status(503).json({ message: 'Photo uploads are not configured.' });
    }
    const fields = photoFieldsSchema.safeParse(req.body ?? {});
    if (!fields.success) {
      return res.status(400).json({ message: 'Invalid photo fields.' });
    }
    const file = req.file;
    if (!file) return res.status(400).json({ message: 'Attach an image as "file".' });
    const contentType = sniffImageType(file.buffer);
    if (!contentType) {
      return res.status(415).json({ message: 'Photos must be JPEG, PNG or WebP.' });
    }
    try {
      const site = await repo.getForWorkspace(req.params.id, ws(req));
      if (!site) return notFound(res);
      if (site.photos.length >= MAX_PHOTOS_PER_SITE) {
        return res.status(422).json({ message: `A site can have at most ${MAX_PHOTOS_PER_SITE} photos.` });
      }
      const url = await deps.photos.upload({
        workspaceId: ws(req),
        siteId: site.id,
        buffer: file.buffer,
        contentType,
      });
      const photo: SitePhoto = { url, alt: fields.data.alt, role: fields.data.role };
      // One hero at a time: a new hero demotes the old one to the gallery.
      const photos: SitePhoto[] = [
        ...site.photos.map((p) =>
          photo.role === 'hero' && p.role === 'hero' ? { ...p, role: 'gallery' as const } : p
        ),
        photo,
      ];
      const updated = await repo.updateForWorkspace(site.id, ws(req), { photos });
      if (!updated) return notFound(res);
      res.status(201).json(updated);
    } catch (err) {
      fail(res, err, 'upload that photo');
    }
  });

  const adminForHardDelete: RequestHandler = (req, res, next) =>
    req.query.hard === 'true' ? requireRole('admin')(req, res, next) : next();

  router.delete('/:id', adminForHardDelete, async (req, res) => {
    const hard = req.query.hard === 'true';
    try {
      const ok = hard
        ? await repo.hardDeleteForWorkspace(req.params.id, ws(req))
        : await repo.softDeleteForWorkspace(req.params.id, ws(req));
      if (!ok) return notFound(res);
      res.json({ success: true, hard });
    } catch (err) {
      fail(res, err, 'delete that site');
    }
  });

  return router;
}
