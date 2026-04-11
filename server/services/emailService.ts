// Email service. Phase 8 replaced the Gmail-only transport from Phase 1.1
// with SendGrid as the primary provider and kept Gmail SMTP as a dev
// fallback (when SENDGRID_API_KEY isn't set). Every send still passes
// through the Phase 7 suppression check, CAN-SPAM footer, and
// List-Unsubscribe headers — those behaviors are transport-agnostic.
//
// Why SendGrid: Gmail SMTP breaks at real send volume, lacks bounce
// webhooks, has no dedicated sending reputation, and costs you domain
// reputation if a campaign goes sideways. SendGrid gives us bounce +
// open + click webhooks, category tagging for per-campaign analytics,
// and a separate IP pool we can warm up deliberately.

import sgMail from '@sendgrid/mail';
import nodemailer from 'nodemailer';
import { storage } from '../storage';
import { makeUnsubscribeUrl } from '../lib/unsubscribe';
import { logger } from '../lib/logger';
import { assertPlanLimit, recordPlanSend } from '../lib/planLimits';

export interface SendOutreachOptions {
  workspaceId?: string | null;
  /** Physical mailing address for CAN-SPAM footer. */
  fromAddress?: string;
  /** Optional outreach_emails row id — used as SendGrid category + custom_arg */
  emailId?: string;
  /** Optional campaign id — surfaced via SendGrid categories for webhooks. */
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

type Provider = 'sendgrid' | 'gmail';

export class EmailService {
  private provider: Provider;
  private gmailTransporter: nodemailer.Transporter | null = null;

  constructor() {
    const sendgridKey = process.env.SENDGRID_API_KEY;
    if (sendgridKey) {
      sgMail.setApiKey(sendgridKey);
      this.provider = 'sendgrid';
      logger.info('[email] provider: sendgrid');
    } else {
      this.provider = 'gmail';
      logger.warn(
        '[email] SENDGRID_API_KEY not set, falling back to Gmail SMTP (dev only)'
      );
      this.gmailTransporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.GMAIL_USER || process.env.EMAIL_USER,
          pass: process.env.GMAIL_PASSWORD || process.env.EMAIL_PASSWORD,
        },
      });
    }
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
      options.fromAddress ?? (await storage.getAppConfig('sendgrid_from_email', options.workspaceId)) ?? '';
    const displayAddress = fromAddress || 'ClearEdge Outreach';
    const footerText = this.buildFooter(unsubscribeUrl, displayAddress);
    const footerHtml = this.buildFooterHtml(unsubscribeUrl, displayAddress);

    const listUnsub = `<${unsubscribeUrl}>, <mailto:unsubscribe@${this.getDomain(to)}>`;
    const html = `${this.formatEmailContent(content)}${footerHtml}${this.trackingPixel(options.emailId)}`;
    const text = `${content}\n\n${footerText}`;

    if (this.provider === 'sendgrid') {
      const fromEmail = process.env.SENDGRID_FROM_EMAIL;
      if (!fromEmail) {
        throw new Error('SENDGRID_FROM_EMAIL env var not set');
      }
      try {
        const [response] = await sgMail.send({
          to,
          from: {
            email: fromEmail,
            name: process.env.SENDGRID_FROM_NAME || displayAddress,
          },
          subject,
          html,
          text,
          headers: {
            'List-Unsubscribe': listUnsub,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
          // Categories tag the send in SendGrid analytics + let our
          // webhook route the event back to the right outreach_email row
          // via sg_event_id / unique_args.
          categories: [
            'clearedge-outreach',
            options.campaignId ? `campaign:${options.campaignId}` : 'campaign:none',
          ],
          customArgs: {
            emailId: options.emailId ?? '',
            campaignId: options.campaignId ?? '',
            workspaceId: options.workspaceId ?? '',
          },
          // SendGrid tracking — one-click click wrapping stays ON,
          // SendGrid's native open pixel stays ON. Our own pixel in
          // the HTML body is a redundant fallback for recipients whose
          // mail clients strip third-party pixels.
          trackingSettings: {
            clickTracking: { enable: true, enableText: false },
            openTracking: { enable: true },
            subscriptionTracking: { enable: false },
          },
        });
        const messageId =
          (response.headers as Record<string, string>)?.['x-message-id'] ??
          String(response.statusCode);
        await recordPlanSend(options.workspaceId, 'email');
        return { messageId, success: true, provider: 'sendgrid' };
      } catch (error: any) {
        logger.error({ err: error }, '[email] sendgrid send failed');
        throw new Error(`Failed to send email via SendGrid: ${error.message}`);
      }
    }

    // Gmail fallback (dev only)
    try {
      const info = await this.gmailTransporter!.sendMail({
        from: process.env.GMAIL_USER || process.env.EMAIL_USER,
        to,
        subject,
        html,
        text,
        headers: {
          'List-Unsubscribe': listUnsub,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      });
      await recordPlanSend(options.workspaceId, 'email');
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
  // whose mail clients strip third-party (SendGrid) tracking pixels.
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
    if (this.provider === 'sendgrid') {
      // SendGrid doesn't expose a ping endpoint; we trust the API key.
      return Boolean(process.env.SENDGRID_API_KEY);
    }
    try {
      await this.gmailTransporter!.verify();
      return true;
    } catch (error) {
      logger.error({ err: error }, '[email] gmail verify failed');
      return false;
    }
  }

  getProvider(): Provider {
    return this.provider;
  }
}

export const emailService = new EmailService();
