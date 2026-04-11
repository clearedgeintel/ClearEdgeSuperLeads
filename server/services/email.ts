import nodemailer from 'nodemailer';

export class EmailService {
  private transporter: nodemailer.Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER || process.env.EMAIL_USER,
        pass: process.env.GMAIL_PASSWORD || process.env.EMAIL_PASSWORD
      }
    });
  }

  async sendOutreachEmail(
    to: string,
    subject: string,
    content: string,
    from?: string
  ): Promise<{ messageId: string; success: boolean }> {
    try {
      const mailOptions = {
        from: from || process.env.GMAIL_USER || process.env.EMAIL_USER,
        to,
        subject,
        html: this.formatEmailContent(content),
        text: content
      };

      const info = await this.transporter.sendMail(mailOptions);
      
      return {
        messageId: info.messageId,
        success: true
      };
    } catch (error: any) {
      console.error('Email sending error:', error);
      throw new Error(`Failed to send email: ${error.message}`);
    }
  }

  private formatEmailContent(content: string): string {
    // Convert plain text to basic HTML formatting
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
