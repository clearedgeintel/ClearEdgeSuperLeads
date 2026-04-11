import nodemailer from 'nodemailer';
import { storage } from '../storage';
import { makeUnsubscribeUrl } from '../lib/unsubscribe';

export interface SendOutreachOptions {
  workspaceId?: string | null;
  /** Physical mailing address for CAN-SPAM footer. */
  fromAddress?: string;
}

export class EmailSuppressedError extends Error {
  reason: string;
  constructor(email: string, reason: string) {
    super(`Recipient ${email} is on the suppression list (${reason}).`);
    this.reason = reason;
  }
}

export class EmailService {
  private transporter: nodemailer.Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER || process.env.EMAIL_USER,
        pass: process.env.GMAIL_PASSWORD || process.env.EMAIL_PASSWORD,
      },
    });
  }

  /**
   * Send an outreach email. Phase 7 added a pre-send suppression check
   * (throws EmailSuppressedError if the recipient is on the list),
   * a CAN-SPAM-compliant footer with physical address + unsubscribe
   * link, and a List-Unsubscribe header so mail clients show their
   * native one-click unsubscribe button.
   */
  async sendOutreachEmail(
    to: string,
    subject: string,
    content: string,
    options: SendOutreachOptions = {}
  ): Promise<{ messageId: string; success: boolean }> {
    // Pre-send suppression check — workspace-scoped when provided, global
    // unsubs also match via the null-workspace row created by the
    // /unsubscribe/:token public endpoint.
    const suppressed = await storage.isSuppressed(to, options.workspaceId);
    if (suppressed) {
      throw new EmailSuppressedError(to, suppressed.reason);
    }

    const unsubscribeUrl = makeUnsubscribeUrl(to);
    const fromAddress = options.fromAddress ?? process.env.SENDGRID_FROM_NAME ?? '';
    const footerText = this.buildFooter(unsubscribeUrl, fromAddress);

    try {
      const info = await this.transporter.sendMail({
        from: process.env.GMAIL_USER || process.env.EMAIL_USER,
        to,
        subject,
        html: `${this.formatEmailContent(content)}${this.buildFooterHtml(unsubscribeUrl, fromAddress)}`,
        text: `${content}\n\n${footerText}`,
        // Gmail, Apple Mail, and Outlook all render a one-click unsub button
        // when both of these headers are present.
        headers: {
          'List-Unsubscribe': `<${unsubscribeUrl}>, <mailto:unsubscribe@${this.getDomain(to)}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      });

      return { messageId: info.messageId, success: true };
    } catch (error: any) {
      console.error('Email sending error:', error);
      throw new Error(`Failed to send email: ${error.message}`);
    }
  }

  private buildFooter(unsubscribeUrl: string, fromAddress: string): string {
    const addr = fromAddress || 'ClearEdge Outreach';
    return `\n---\n${addr}\nIf you'd prefer not to receive these messages, unsubscribe here: ${unsubscribeUrl}`;
  }

  private buildFooterHtml(unsubscribeUrl: string, fromAddress: string): string {
    const addr = fromAddress || 'ClearEdge Outreach';
    return `<hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;"><p style="font-size: 12px; color: #6b7280;">${addr}<br>If you'd prefer not to receive these messages, <a href="${unsubscribeUrl}" style="color: #6b7280;">unsubscribe here</a>.</p>`;
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
    try {
      await this.transporter.verify();
      return true;
    } catch (error) {
      console.error('Email service verification failed:', error);
      return false;
    }
  }
}

export const emailService = new EmailService();
