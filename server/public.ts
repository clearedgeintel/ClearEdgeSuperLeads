// PUBLIC SITE SERVER — the `public` Railway service. Serves demo and live
// client sites: pages, quote form, view pixel, robots/sitemap and custom-domain
// routing.
//
// It runs separately from the admin app so a bad admin deploy or a runaway job
// can't take a paying client's website offline. Keep its imports to db.ts,
// server/sites/*, emailService and logging: no sessions, routes.ts, scheduler,
// queues or outreach services. __tests__/sites/publicImports.test.ts enforces this.

import { db } from './db';
import { logger } from './lib/logger';
import { createSiteRepository } from './sites/repository';
import { createSiteNotifier } from './sites/mailer';
import { createPublicApp } from './sites/publicRoutes';
import { publicSiteBaseUrl } from './sites/urls';
import { previewSecret } from './sites/previewToken';

const repo = createSiteRepository(db);
const publicBaseUrl = publicSiteBaseUrl();
const notifier = createSiteNotifier(repo);

const app = createPublicApp({
  repo,
  notifier,
  config: {
    publicBaseUrl,
    extraHosts: (process.env.PUBLIC_SITE_EXTRA_HOSTS || '')
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean),
    previewSecret: previewSecret(),
    adminOrigin: (() => {
      try {
        return process.env.APP_URL ? new URL(process.env.APP_URL).origin : null;
      } catch {
        return null;
      }
    })(),
  },
  log: logger,
});

if (!publicBaseUrl) {
  logger.warn('[public] PUBLIC_SITE_BASE_URL is not set; only localhost serves /s/:slug');
}

const port = Number(process.env.PORT) || 5100;
app.listen(port, '0.0.0.0', () => {
  logger.info({ port }, '[public] site server listening');
});
