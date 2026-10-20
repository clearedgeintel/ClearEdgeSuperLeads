// The owner-notification wiring shared by both services: the public server
// notifies on each submission, the admin scheduler retries failures.

import { emailService } from '../services/emailService';
import { logger } from '../lib/logger';
import type { SiteRepository } from './repository';
import { createNotifier, transactionalEmailConfigured } from './notify';
import { publicSiteBaseUrl } from './urls';
import { isValidCustomDomain } from './domain';

export function createSiteNotifier(repo: SiteRepository) {
  return createNotifier({
    repo,
    sendEmail: (to, subject, html, text, opts) =>
      emailService.sendTransactionalEmail(to, subject, html, text, opts),
    emailConfigured: () => transactionalEmailConfigured(),
    siteUrl: (site) => {
      if (site.status === 'live' && site.customDomain && isValidCustomDomain(site.customDomain)) {
        return `https://${site.customDomain}/`;
      }
      const base = publicSiteBaseUrl();
      return base ? `${base}/s/${encodeURIComponent(site.slug)}` : null;
    },
    log: logger,
  });
}
