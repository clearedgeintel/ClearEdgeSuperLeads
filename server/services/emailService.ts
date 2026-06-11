// Email service. Resend is the primary transport with Gmail SMTP kept as a
// dev fallback (when RESEND_API_KEY isn't set). Every send still passes
// through the Phase 7 suppression check, CAN-SPAM footer, and
// List-Unsubscribe headers — those behaviors are transport-agnostic.
//
// Why Resend: Gmail SMTP breaks at real send volume, lacks bounce webhooks,
// has no dedicated sending reputation, and costs you domain reputation if a
// campaign goes sideways. Resend (built on AWS SES) gives us bounce + spam +
// open + click webhooks, tags for per-campaign analytics, and a simple
// domains API for SPF/DKIM verification status.
//
// Tracking note: Resend toggles open/click tracking at the DOMAIN level, not
// per-send. To keep transactional mail (invites) untracked, point
// RESEND_TRANSACTIONAL_FROM_EMAIL at a separate subdomain whose Resend domain
// has tracking disabled. If unset, transactional mail falls back to the main
// from-address. Our own open-pixel (GET /track/open/:emailId) is independent.

import { Resend } from 'resend';
import nodemailer from 'nodemailer';
import { storage } from '../storage';
import { makeUnsubscribeUrl } from '../lib/unsubscribe';
import { logger } from '../lib/logger';
import { assertPlanLimit, recordPlanSend } from '../lib/planLimits';

export interface SendOutreachOptions {
  workspaceId?: string | null;
  /** Physical mailing address for CAN-SPAM footer. */
  fromAddress?: string;
  /** Optional outreach_emails row id — sent as a Resend tag so webhooks can credit the event. */
  emailId?: string;
  /** Optional campaign id — sent as a Resend tag for per-campaign webhook routing. */
  campaignId?: string;
}

export class EmailSuppressedError extends Error {
  reason: string;
  constructor(email: string, reason: string) {
    super(`Recipient ${email} is on the suppression list (${reason}).`);
    this.reason = reason;
  }
}

export class EmailUndeliverableError extends Error {
  constructor(email: string) {
    super(`Recipient ${email} is marked undeliverable. Verify before sending.`);
  }
}

export class EmailDailyLimitError extends Error {
  limit: number;
  used: number;
  constructor(used: number, limit: number) {
    super(`Daily email limit reached (${used}/${limit}). Resumes tomorrow.`);
    this.used = used;
    this.limit = limit;
  }
}

type Provider = 'resend' | 'gmail';

// Domain auth status reflects DNS state that changes on the order of hours; a
// short cache collapses repeated Settings-page loads to one Resend round-trip.
const DOMAIN_STATUS_TTL_MS = 60_000;

export class EmailService {
  private provider: Provider;
  private resend: Resend | null = null;
  private gmailTransporter: nodemailer.Transporter | null = null;
  private domainStatusCache: { key: string; at: number; value: DomainAuthStatus } | null = null;

  constructor() {
    const resendKey = process.env.RESEND_API_KEY;
    const gmailUser = process.env.GMAIL_USER || process.env.EMAIL_USER;
    const gmailPass = process.env.GMAIL_PASSWORD || process.env.EMAIL_PASSWORD;

    if (resendKey) {
      this.resend = new Resend(resendKey);
      this.provider = 'resend';
      logger.info('[email] provider: resend');
    } else if (gmailUser && gmailPass) {
      this.provider = 'gmail';
      logger.warn(
        '[email] RESEND_API_KEY not set, falling back to Gmail SMTP (dev only)'
      );
      this.gmailTransporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: gmailUser, pass: gmailPass },
      });
    } else {
      // No credentials for either provider. Leave the service in a stubbed
      // state so sendOutreachEmail throws a clear error instead of
      // nodemailer crashing the process with an async EAUTH event
      // (which bypasses try/catch because it fires from a TLS socket).
      this.provider = 'gmail';
      logger.warn(
        '[email] no email credentials configured (set RESEND_API_KEY or GMAIL_USER + GMAIL_PASSWORD). sendOutreachEmail will throw until configured.'
      );
    }
  }

  /** Build a Resend "Name <email>" from string. */
  private formatFrom(email: string): string {
    const name = process.env.RESEND_FROM_NAME;
    return name ? `${name} <${email}>` : email;
  }

  /**
   * Send an outreach email. Transport-agnostic; suppression check +
   * CAN-SPAM footer + List-Unsubscribe headers run regardless of which
   * provider is active. Throws EmailSuppressedError if the recipient
   * is on the suppression list and EmailUndeliverableError if the lead
   * row has `email_verified='undeliverable'` from Hunter.io.
   */
  async sendOutreachEmail(
    to: string,
    subject: string,
    content: string,
    options: SendOutreachOptions = {}
  ): Promise<{ messageId: string; success: boolean; provider: Provider }> {
    // Pre-send suppression check — workspace-scoped when provided, global
    // unsubs also match via the null-workspace row created by the
    // /unsubscribe/:token public endpoint.
    const suppressed = await storage.isSuppressed(to, options.workspaceId);
    if (suppressed) {
      throw new EmailSuppressedError(to, suppressed.reason);
    }

    // Undeliverable block — if a prior Hunter.io check marked the lead
    // email as undeliverable, don't burn a send quota on a guaranteed
    // bounce. The lookup is keyed by the recipient email, not the
    // lead id, so the check works even when the call site doesn't
    // thread a leadId through.
    const latestForRecipient = await storage.getLatestOutreachEmailByRecipient(to);
    if (latestForRecipient?.leadId) {
      const lead = await storage.getLead(latestForRecipient.leadId);
      if (lead?.emailVerified === 'undeliverable') {
        throw new EmailUndeliverableError(to);
      }
    }

    // Phase 9 — Monthly plan limit check. Throws PlanLimitExceededError
    // which the route maps to 402 { code: 'plan_limit' }. Runs before
    // the daily cap so operators see the plan limit (the harder gate)
    // first when both would fire.
    await assertPlanLimit(options.workspaceId, 'email');

    // Daily email limit — enforces the workspace's warm-up curve.
    // Reads the cap from workspaces.daily_email_limit (falls back to
    // the roadmap's recommended 20/day starter), counts today's
    // sends from outreach_emails, throws EmailDailyLimitError on cap.
    if (options.workspaceId) {
      const workspace = await storage.getWorkspace(options.workspaceId);
      const cap = workspace?.dailyEmailLimit ?? 20;
      const midnightUtc = new Date();
      midnightUtc.setUTCHours(0, 0, 0, 0);
      const usedToday = await storage.countEmailSendsSince(options.workspaceId, midnightUtc);
      if (usedToday >= cap) {
        throw new EmailDailyLimitError(usedToday, cap);
      }
    }

    const unsubscribeUrl = makeUnsubscribeUrl(to);
    const fromAddress =
      options.fromAddress ??
      (await storage.getAppConfig('email_from_address', options.workspaceId)) ??
      // Backward-compat: workspaces that saved a from-address before the
      // sendgrid_from_email -> email_from_address rename. Keeps the CAN-SPAM
      // footer's physical address intact until they re-save in Settings.
      (await storage.getAppConfig('sendgrid_from_email', options.workspaceId)) ??
      '';
    const displayAddress = fromAddress || 'ClearEdge Outreach';
    const footerText = this.buildFooter(unsubscribeUrl, displayAddress);
    const footerHtml = this.buildFooterHtml(unsubscribeUrl, displayAddress);

    const listUnsub = `<${unsubscribeUrl}>, <mailto:unsubscribe@${this.getDomain(to)}>`;
    const html = `${this.formatEmailContent(content)}${footerHtml}${this.trackingPixel(options.emailId)}`;
    const text = `${content}\n\n${footerText}`;

    // Tags route the webhook event back to the right outreach_email row.
    // Resend tag names/values must be ASCII alphanumerics, '_' or '-'.
    const result = await this.dispatch({
      to,
      subject,
      html,
      text,
      fromEmail: process.env.RESEND_FROM_EMAIL,
      headers: {
        'List-Unsubscribe': listUnsub,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
      tags: [
        { name: 'source', value: 'clearedge_outreach' },
        { name: 'email_id', value: options.emailId || 'none' },
        { name: 'campaign_id', value: options.campaignId || 'none' },
        { name: 'workspace_id', value: options.workspaceId || 'none' },
      ],
    });
    // Only count the send against the plan quota once it actually went out
    // (dispatch throws on failure, so this never runs for a failed send).
    await recordPlanSend(options.workspaceId, 'email');
    return result;
  }

  /**
   * Send a transactional email (invites, system notices). Deliberately skips
   * EVERYTHING sendOutreachEmail does: no suppression check (an invitee could
   * be on the outreach suppression list and must still get their invite), no
   * CAN-SPAM unsubscribe footer/headers (this isn't marketing mail), no plan
   * or daily-limit metering (invites don't consume send quota), and no open/
   * click tracking. Same provider dispatch (Resend primary, Gmail fallback).
   */
  async sendTransactionalEmail(
    to: string,
    subject: string,
    html: string,
    text?: string,
  ): Promise<{ messageId: string; success: boolean; provider: Provider }> {
    const textBody = text ?? html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    // Prefer a dedicated transactional from-address (point it at a subdomain
    // whose Resend domain has open/click tracking disabled). Falls back to the
    // main outreach from-address when not configured. No headers/metering/
    // tracking — that's the whole point of the transactional path.
    return this.dispatch({
      to,
      subject,
      html,
      text: textBody,
      fromEmail: process.env.RESEND_TRANSACTIONAL_FROM_EMAIL || process.env.RESEND_FROM_EMAIL,
      tags: [{ name: 'source', value: 'clearedge_transactional' }],
    });
  }

  /**
   * Provider transport — Resend primary, Gmail dev fallback. The single place
   * that talks to a provider; the public send methods own all policy
   * (suppression, footer, plan metering, tracking) and hand dispatch the final
   * payload. Throws on provider error so callers never record a failed send.
   */
  private async dispatch(opts: {
    to: string;
    subject: string;
    html: string;
    text: string;
    fromEmail?: string;
    headers?: Record<string, string>;
    tags?: { name: string; value: string }[];
  }): Promise<{ messageId: string; success: boolean; provider: Provider }> {
    if (this.provider === 'resend' && this.resend) {
      if (!opts.fromEmail) {
        throw new Error('RESEND_FROM_EMAIL env var not set');
      }
      const { data, error } = await this.resend.emails.send({
        from: this.formatFrom(opts.fromEmail),
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
        ...(opts.headers ? { headers: opts.headers } : {}),
        ...(opts.tags ? { tags: opts.tags } : {}),
      });
      if (error) {
        logger.error({ err: error }, '[email] resend send failed');
        throw new Error(`Failed to send email via Resend: ${error.message}`);
      }
      return { messageId: data?.id ?? '', success: true, provider: 'resend' };
    }

    // Gmail fallback (dev only)
    if (!this.gmailTransporter) {
      throw new Error(
        'Email provider not configured. Set RESEND_API_KEY or GMAIL_USER + GMAIL_PASSWORD.',
      );
    }
    try {
      const info = await this.gmailTransporter.sendMail({
        from: process.env.GMAIL_USER || process.env.EMAIL_USER,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
        ...(opts.headers ? { headers: opts.headers } : {}),
      });
      return { messageId: info.messageId, success: true, provider: 'gmail' };
    } catch (error: any) {
      logger.error({ err: error }, '[email] gmail send failed');
      throw new Error(`Failed to send email via Gmail: ${error.message}`);
    }
  }

  private buildFooter(unsubscribeUrl: string, fromAddress: string): string {
    return `\n---\n${fromAddress}\nIf you'd prefer not to receive these messages, unsubscribe here: ${unsubscribeUrl}`;
  }

  private buildFooterHtml(unsubscribeUrl: string, fromAddress: string): string {
    return `<hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;"><p style="font-size: 12px; color: #6b7280;">${fromAddress}<br>If you'd prefer not to receive these messages, <a href="${unsubscribeUrl}" style="color: #6b7280;">unsubscribe here</a>.</p>`;
  }

  // Our own 1x1 tracking pixel — defense in depth against recipients
  // whose mail clients strip the provider's native tracking pixel.
  // Hits GET /track/open/:emailId which updates opened_at.
  private trackingPixel(emailId?: string): string {
    if (!emailId) return '';
    const appUrl = process.env.APP_URL || 'http://localhost:5000';
    return `<img src="${appUrl}/track/open/${emailId}" width="1" height="1" style="display:none;" alt="">`;
  }

  private getDomain(email: string): string {
    return email.split('@')[1] ?? 'example.com';
  }

  private formatEmailContent(content: string): string {
    return content
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>')
      .replace(/^(.*)$/, '<p>$1</p>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>');
  }

  async verifyConnection(): Promise<boolean> {
    if (this.provider === 'resend') {
      // Resend has no cheap ping endpoint; trust the API key's presence.
      return Boolean(process.env.RESEND_API_KEY);
    }
    if (!this.gmailTransporter) return false;
    try {
      await this.gmailTransporter.verify();
      return true;
    } catch (error) {
      logger.error({ err: error }, '[email] gmail verify failed');
      return false;
    }
  }

  getProvider(): Provider {
    return this.provider;
  }

  /**
   * Live Resend sending-domain authentication status, for the Settings UI.
   * Lists Resend domains, matches the one the from-address belongs to, and
   * fetches its DNS records. Returns:
   *   - not_configured: no Resend key / from-email (or Gmail fallback mode)
   *   - verified: Resend reports the domain verified
   *   - pending: domain exists but records aren't all validated yet
   *   - error: domain not found in Resend, or the API call failed
   * Resend domain auth covers SPF + DKIM. DMARC is pure operator DNS and isn't
   * reported here — see DEPLOYMENT.md.
   *
   * Result is cached briefly (keyed by provider + from-address) so repeated
   * Settings views don't each fire two Resend API round-trips.
   */
  async getDomainAuthStatus(): Promise<DomainAuthStatus> {
    const key = `${this.provider}:${process.env.RESEND_FROM_EMAIL ?? ''}`;
    const cached = this.domainStatusCache;
    if (cached && cached.key === key && Date.now() - cached.at < DOMAIN_STATUS_TTL_MS) {
      return cached.value;
    }
    const value = await this.computeDomainAuthStatus();
    this.domainStatusCache = { key, at: Date.now(), value };
    return value;
  }

  private async computeDomainAuthStatus(): Promise<DomainAuthStatus> {
    const fromEmail = process.env.RESEND_FROM_EMAIL;
    if (this.provider !== 'resend' || !this.resend) {
      return { status: 'not_configured', message: 'Resend is not configured (using Gmail dev fallback).' };
    }
    if (!fromEmail || !fromEmail.includes('@')) {
      return { status: 'not_configured', message: 'RESEND_FROM_EMAIL is not set, so no sending domain to verify.' };
    }
    const fromDomain = fromEmail.split('@')[1].toLowerCase();

    try {
      const list = await this.resend.domains.list();
      if (list.error) {
        return { status: 'error', domain: fromDomain, message: `Resend API error: ${list.error.message}` };
      }
      const domains = list.data?.data ?? [];
      const match = domains.find(
        (d) => fromDomain === d.name.toLowerCase() || fromDomain.endsWith(`.${d.name.toLowerCase()}`),
      );
      if (!match) {
        return {
          status: 'error',
          domain: fromDomain,
          message: `No domain in Resend matches "${fromDomain}". Add and verify it under Domains in the Resend dashboard.`,
          records: [],
        };
      }

      const detail = await this.resend.domains.get(match.id);
      if (detail.error || !detail.data) {
        // Fall back to the list-level status if the detail call fails.
        const verified = match.status === 'verified';
        return {
          status: verified ? 'verified' : 'pending',
          domain: match.name,
          message: verified ? 'Sending domain is verified.' : `Domain status: ${match.status}.`,
        };
      }

      const records: DomainAuthRecord[] = (detail.data.records ?? []).map((r) => ({
        label: r.record,
        type: r.type,
        host: r.name,
        data: r.value,
        valid: r.status === 'verified',
      }));
      // Resend statuses: not_started | pending | verified | failed |
      // temporary_failure (+ partially_verified / partially_failed). Treat any
      // "failed" variant as an error so a broken record isn't masked as pending.
      const rawStatus = detail.data.status ?? '';
      const status: DomainAuthStatus['status'] = rawStatus === 'verified'
        ? 'verified'
        : rawStatus.includes('failed')
          ? 'error'
          : 'pending';
      return {
        status,
        domain: match.name,
        message:
          status === 'verified'
            ? 'Sending domain is verified (SPF + DKIM valid).'
            : status === 'error'
              ? 'Resend reports domain verification failed. Re-check the DNS records below.'
              : 'Domain found but DNS records are not all validated yet. Publish the records below; propagation can take up to 48h.',
        records,
      };
    } catch (err) {
      logger.error({ err }, '[email] domain auth status check failed');
      return { status: 'error', domain: fromDomain, message: 'Could not reach Resend to check domain status.' };
    }
  }
}

export interface DomainAuthRecord {
  label: string;
  type: string;
  host: string;
  data: string;
  valid: boolean;
}
export interface DomainAuthStatus {
  status: 'verified' | 'pending' | 'not_configured' | 'error';
  domain?: string;
  message: string;
  records?: DomainAuthRecord[];
}

export const emailService = new EmailService();
