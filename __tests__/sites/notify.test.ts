// Owner notifications: email content and headers, delivery bookkeeping, the
// "never from the outreach domain" rule, and the retry job's window.

import {
  buildOwnerEmail,
  createNotifier,
  retryPendingNotifications,
  transactionalEmailConfigured,
  MAX_NOTIFY_ATTEMPTS,
  type NotifierDeps,
} from '../../server/sites/notify';
import type { PendingNotification } from '../../server/sites/repository';
import { SAMPLE_BUSINESS } from '../../server/sites/template/sampleData';
import type { Site, SiteSubmission } from '../../shared/sites';

const site: Site = {
  id: 'site-1',
  slug: 'acme',
  theme: 'slate',
  status: 'live',
  data: { ...SAMPLE_BUSINESS, name: 'Acme Roofing' },
  workspaceId: 'ws-a',
  leadId: null,
  createdBy: null,
  photos: [],
  customDomain: 'acme-roofing.com',
  customDomainWww: false,
  notifyEmail: 'owner@example.com',
  publishedAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};
const sub: SiteSubmission = {
  id: 'sub-1',
  siteId: 'site-1',
  leadId: null,
  workspaceId: 'ws-a',
  name: 'Jamie <b>Doe</b>',
  email: 'jamie@example.com',
  phone: '(512) 555-0199',
  message: 'Leak over the garage.\nCan you look this week?',
  createdAt: '2026-10-02T00:00:00.000Z',
};

function setup(overrides: Partial<NotifierDeps> = {}) {
  const repo = {
    markSubmissionNotified: jest.fn().mockResolvedValue(undefined),
    recordNotifyFailure: jest.fn().mockResolvedValue(undefined),
    notifyWorkspaceMembers: jest.fn().mockResolvedValue(2),
  };
  const sendEmail = jest.fn().mockResolvedValue({ success: true });
  const log = { warn: jest.fn(), error: jest.fn() };
  const notifier = createNotifier({
    repo,
    sendEmail,
    emailConfigured: () => true,
    siteUrl: () => 'https://acme-roofing.com/',
    log,
    ...overrides,
  });
  return { notifier, repo, sendEmail, log };
}

describe('owner email', () => {
  test('subject, escaped body, site link and reply-to', () => {
    const e = buildOwnerEmail(site, sub, 'https://acme-roofing.com/');
    expect(e.subject).toBe('New quote request — Acme Roofing');
    expect(e.html).toContain('Jamie &lt;b&gt;Doe&lt;/b&gt;');
    expect(e.html).not.toContain('<b>Doe</b>');
    expect(e.html).toContain('(512) 555-0199');
    expect(e.html).toContain('jamie@example.com');
    expect(e.html).toContain('Leak over the garage.');
    expect(e.html).toContain('href="https://acme-roofing.com/"');
    expect(e.text).toContain('Phone: (512) 555-0199');
    expect(e.replyTo).toBe('jamie@example.com');
  });

  test('no reply-to without a usable customer email; subject is one line', () => {
    const e = buildOwnerEmail(
      { ...site, data: { ...site.data, name: 'Acme\r\nBcc: x@example.com' } },
      { ...sub, email: null },
      null
    );
    expect(e.replyTo).toBeUndefined();
    expect(e.subject).not.toMatch(/[\r\n]/);
    expect(e.html).not.toContain('Sent from');
  });
});

describe('onSubmission', () => {
  test('notifies the workspace, emails the owner, marks it notified', async () => {
    const { notifier, repo, sendEmail } = setup();
    expect(await notifier.onSubmission(site, sub)).toBe('sent');
    expect(repo.notifyWorkspaceMembers).toHaveBeenCalledWith(
      'ws-a',
      expect.objectContaining({ type: 'site_submission', title: 'New quote request — Acme Roofing' })
    );
    expect(sendEmail).toHaveBeenCalledWith(
      'owner@example.com',
      'New quote request — Acme Roofing',
      expect.any(String),
      expect.any(String),
      { replyTo: 'jamie@example.com' }
    );
    expect(repo.markSubmissionNotified).toHaveBeenCalledWith('sub-1');
    expect(repo.recordNotifyFailure).not.toHaveBeenCalled();
  });

  test('email failure keeps the row pending and counts the attempt', async () => {
    const { notifier, repo, log } = setup({ sendEmail: jest.fn().mockRejectedValue(new Error('resend down')) });
    expect(await notifier.onSubmission(site, sub)).toBe('failed');
    expect(repo.markSubmissionNotified).not.toHaveBeenCalled();
    expect(repo.recordNotifyFailure).toHaveBeenCalledWith('sub-1');
    expect(log.error).toHaveBeenCalled();
  });

  test('no transactional address: held for later, no attempt spent', async () => {
    const { notifier, repo, sendEmail } = setup({ emailConfigured: () => false });
    expect(await notifier.onSubmission(site, sub)).toBe('not_configured');
    expect(sendEmail).not.toHaveBeenCalled();
    expect(repo.markSubmissionNotified).not.toHaveBeenCalled();
    expect(repo.recordNotifyFailure).not.toHaveBeenCalled();
  });

  test('a site without a notify email (e.g. a demo) is done after the in-app alert', async () => {
    const { notifier, repo, sendEmail } = setup();
    expect(await notifier.onSubmission({ ...site, notifyEmail: null, status: 'draft' }, sub)).toBe('not_needed');
    expect(repo.notifyWorkspaceMembers).toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(repo.markSubmissionNotified).toHaveBeenCalledWith('sub-1');
  });

  test('never throws, even if the in-app insert fails', async () => {
    const { notifier, sendEmail } = setup();
    const failingRepo = setup({
      repo: {
        markSubmissionNotified: jest.fn().mockRejectedValue(new Error('db')),
        recordNotifyFailure: jest.fn().mockRejectedValue(new Error('db')),
        notifyWorkspaceMembers: jest.fn().mockRejectedValue(new Error('db')),
      },
    });
    await expect(failingRepo.notifier.onSubmission(site, sub)).resolves.toBe('failed');
    await expect(notifier.onSubmission(site, sub)).resolves.toBe('sent');
    expect(sendEmail).toHaveBeenCalled();
  });
});

describe('transactional email config', () => {
  test('with Resend, the transactional from-address is required', () => {
    expect(transactionalEmailConfigured({ RESEND_API_KEY: 'k' } as NodeJS.ProcessEnv)).toBe(false);
    expect(
      transactionalEmailConfigured({ RESEND_API_KEY: 'k', RESEND_FROM_EMAIL: 'out@x.com' } as NodeJS.ProcessEnv)
    ).toBe(false);
    expect(
      transactionalEmailConfigured({
        RESEND_API_KEY: 'k',
        RESEND_TRANSACTIONAL_FROM_EMAIL: 'notify@x.com',
      } as NodeJS.ProcessEnv)
    ).toBe(true);
  });

  test('dev Gmail fallback counts as configured', () => {
    expect(transactionalEmailConfigured({ GMAIL_USER: 'u', GMAIL_PASSWORD: 'p' } as NodeJS.ProcessEnv)).toBe(true);
    expect(transactionalEmailConfigured({} as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe('retryPendingNotifications', () => {
  test('asks for rows older than 5 minutes, within 7 days, under 3 attempts', async () => {
    const now = new Date('2026-10-19T12:00:00Z');
    const pending: PendingNotification[] = [
      { submission: sub, attempts: 1, site },
      { submission: { ...sub, id: 'sub-2' }, attempts: 0, site: { ...site, notifyEmail: null } },
    ];
    const repo = { listPendingNotifications: jest.fn().mockResolvedValue(pending) };
    const emailOwner = jest.fn().mockResolvedValueOnce('sent').mockResolvedValueOnce('not_needed');
    const counts = await retryPendingNotifications(repo, { emailOwner }, now);
    expect(repo.listPendingNotifications).toHaveBeenCalledWith({
      since: new Date('2026-10-12T12:00:00Z'),
      before: new Date('2026-10-19T11:55:00Z'),
      maxAttempts: MAX_NOTIFY_ATTEMPTS,
      limit: 50,
    });
    expect(MAX_NOTIFY_ATTEMPTS).toBe(3);
    expect(emailOwner).toHaveBeenCalledTimes(2);
    expect(counts).toEqual({ sent: 1, not_needed: 1, not_configured: 0, failed: 0 });
  });
});
