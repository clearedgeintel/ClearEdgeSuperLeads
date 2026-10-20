// Owner notification for quote requests.
//
// On each submission (already saved by the caller):
//   1. an in-app notification for every member of the site's workspace, once;
//   2. an email to sites.notify_email from the transactional address.
// Email failure never loses the submission: the row keeps notified_at = null
// and the admin scheduler retries it (see retryPendingNotifications).

import type { Site, SiteSubmission } from '@shared/sites';
import type { SiteRepository } from './repository';

export const MAX_NOTIFY_ATTEMPTS = 3;
export const RETRY_AFTER_MS = 5 * 60 * 1000;
export const RETRY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type EmailOutcome = 'sent' | 'not_needed' | 'not_configured' | 'failed';

/**
 * Owner emails must come from the transactional address, never the outreach
 * domain. With Resend that means RESEND_TRANSACTIONAL_FROM_EMAIL must be set
 * (emailService would otherwise fall back to the outreach from-address).
 */
export function transactionalEmailConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.RESEND_API_KEY) return Boolean(env.RESEND_TRANSACTIONAL_FROM_EMAIL);
  return Boolean((env.GMAIL_USER || env.EMAIL_USER) && (env.GMAIL_PASSWORD || env.EMAIL_PASSWORD));
}

export interface NotifierDeps {
  repo: Pick<SiteRepository, 'markSubmissionNotified' | 'recordNotifyFailure' | 'notifyWorkspaceMembers'>;
  sendEmail(
    to: string,
    subject: string,
    html: string,
    text: string,
    opts: { replyTo?: string }
  ): Promise<unknown>;
  emailConfigured(): boolean;
  /** Public URL of the site, for the email body. */
  siteUrl(site: Site): string | null;
  log: {
    warn(obj: object, msg: string): void;
    error(obj: object, msg: string): void;
  };
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Header-safe single line. */
function oneLine(s: string): string {
  return s.replace(/[\r\n]+/g, ' ').trim();
}

const SIMPLE_EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

export function buildOwnerEmail(site: Site, sub: SiteSubmission, url: string | null) {
  const business = oneLine(site.data.name || 'your website');
  const subject = `New quote request — ${business}`.slice(0, 200);
  const rows: [string, string | null][] = [
    ['Name', sub.name],
    ['Phone', sub.phone],
    ['Email', sub.email],
    ['Message', sub.message],
  ];
  const present = rows.filter((r): r is [string, string] => !!r[1]);
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#111">
<p>You have a new quote request from your website.</p>
<table style="border-collapse:collapse">${present
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#555;vertical-align:top">${k}</td><td style="padding:4px 0;white-space:pre-wrap">${esc(v)}</td></tr>`
    )
    .join('')}</table>
${url ? `<p style="margin-top:16px;color:#555">Sent from <a href="${esc(url)}">${esc(url)}</a></p>` : ''}
${sub.email ? '<p style="color:#555">Reply to this email to answer them directly.</p>' : ''}
</div>`;
  const text = [
    'You have a new quote request from your website.',
    '',
    ...present.map(([k, v]) => `${k}: ${v}`),
    ...(url ? ['', `Sent from ${url}`] : []),
  ].join('\n');
  const replyTo = sub.email && SIMPLE_EMAIL.test(sub.email) ? sub.email : undefined;
  return { subject, html, text, replyTo };
}

export function createNotifier(deps: NotifierDeps) {
  async function emailOwner(site: Site, sub: SiteSubmission): Promise<EmailOutcome> {
    if (!site.notifyEmail) {
      // Nothing to send (e.g. a demo site): done.
      await deps.repo.markSubmissionNotified(sub.id);
      return 'not_needed';
    }
    if (!deps.emailConfigured()) {
      // Leave it pending without spending an attempt; it goes out once configured.
      deps.log.warn({ submissionId: sub.id }, '[sites] owner email skipped: transactional email not configured');
      return 'not_configured';
    }
    const { subject, html, text, replyTo } = buildOwnerEmail(site, sub, deps.siteUrl(site));
    try {
      await deps.sendEmail(site.notifyEmail, subject, html, text, { replyTo });
      await deps.repo.markSubmissionNotified(sub.id);
      return 'sent';
    } catch (err) {
      deps.log.error({ err, submissionId: sub.id }, '[sites] owner email failed; will retry');
      await deps.repo.recordNotifyFailure(sub.id);
      return 'failed';
    }
  }

  return {
    emailOwner,

    /** Called right after a submission is saved. Never throws. */
    async onSubmission(site: Site, sub: SiteSubmission): Promise<EmailOutcome> {
      if (site.workspaceId) {
        try {
          const who = [sub.name, sub.phone || sub.email].filter(Boolean).join(' · ');
          await deps.repo.notifyWorkspaceMembers(site.workspaceId, {
            type: 'site_submission',
            title: `New quote request — ${oneLine(site.data.name)}`.slice(0, 200),
            body: who || null,
            link: null,
          });
        } catch (err) {
          deps.log.error({ err, submissionId: sub.id }, '[sites] in-app notification failed');
        }
      }
      try {
        return await emailOwner(site, sub);
      } catch (err) {
        deps.log.error({ err, submissionId: sub.id }, '[sites] notification bookkeeping failed');
        return 'failed';
      }
    },
  };
}

export type SiteNotifier = ReturnType<typeof createNotifier>;

/** Admin scheduler job: retry owner emails that haven't gone out yet. */
export async function retryPendingNotifications(
  repo: Pick<SiteRepository, 'listPendingNotifications'>,
  notifier: Pick<SiteNotifier, 'emailOwner'>,
  now = new Date()
): Promise<Record<EmailOutcome, number>> {
  const pending = await repo.listPendingNotifications({
    since: new Date(now.getTime() - RETRY_WINDOW_MS),
    before: new Date(now.getTime() - RETRY_AFTER_MS),
    maxAttempts: MAX_NOTIFY_ATTEMPTS,
    limit: 50,
  });
  const counts: Record<EmailOutcome, number> = { sent: 0, not_needed: 0, not_configured: 0, failed: 0 };
  for (const p of pending) {
    counts[await notifier.emailOwner(p.site, p.submission)]++;
  }
  return counts;
}
