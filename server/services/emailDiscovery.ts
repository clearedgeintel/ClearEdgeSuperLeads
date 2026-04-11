import axios from 'axios';

export interface EmailDiscoveryResult {
  emails: string[];
  source: 'website' | 'pattern';
}

const EMAIL_REGEX = /[\w.+-]+@[\w-]+\.[\w.]+/g;
const EXCLUDED_EMAILS = [
  'example.com', 'test.com', 'email.com', 'domain.com',
  'yoursite.com', 'website.com', 'company.com',
];

export class EmailDiscoveryService {
  private timeout = 5000;

  async discoverEmails(websiteUrl: string): Promise<EmailDiscoveryResult> {
    // Try scraping the website first
    const scrapedEmails = await this.scrapeWebsite(websiteUrl);
    if (scrapedEmails.length > 0) {
      return { emails: scrapedEmails, source: 'website' };
    }

    // Fall back to common email patterns
    const patternEmails = this.generatePatterns(websiteUrl);
    return { emails: patternEmails, source: 'pattern' };
  }

  private async scrapeWebsite(websiteUrl: string): Promise<string[]> {
    const allEmails = new Set<string>();
    const pagesToTry = [
      websiteUrl,
      this.resolveUrl(websiteUrl, '/contact'),
      this.resolveUrl(websiteUrl, '/about'),
      this.resolveUrl(websiteUrl, '/contact-us'),
      this.resolveUrl(websiteUrl, '/about-us'),
    ];

    for (const url of pagesToTry) {
      try {
        const emails = await this.scrapePageEmails(url);
        emails.forEach(e => allEmails.add(e));
        // Stop early if we found emails on the first page
        if (allEmails.size > 0 && url === pagesToTry[0]) break;
      } catch {
        // Page not found or timeout — skip
      }
    }

    return Array.from(allEmails);
  }

  private async scrapePageEmails(url: string): Promise<string[]> {
    const response = await axios.get(url, {
      timeout: this.timeout,
      maxRedirects: 3,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; GBPConsultBot/1.0)',
        'Accept': 'text/html',
      },
      // Only read first 500KB to avoid downloading huge pages
      maxContentLength: 500 * 1024,
    });

    const html = typeof response.data === 'string' ? response.data : '';

    // Extract emails from HTML content
    const emails = this.extractEmails(html);

    // Also extract from mailto: links
    const mailtoRegex = /mailto:([\w.+-]+@[\w-]+\.[\w.]+)/gi;
    let match;
    while ((match = mailtoRegex.exec(html)) !== null) {
      const email = match[1].toLowerCase();
      if (this.isValidEmail(email)) {
        emails.add(email);
      }
    }

    return Array.from(emails);
  }

  private extractEmails(text: string): Set<string> {
    const emails = new Set<string>();
    const matches = text.match(EMAIL_REGEX) || [];

    for (const raw of matches) {
      const email = raw.toLowerCase().replace(/\.$/, '');
      if (this.isValidEmail(email)) {
        emails.add(email);
      }
    }

    return emails;
  }

  private isValidEmail(email: string): boolean {
    // Must have @ and a valid TLD
    if (!email.includes('@') || email.length > 254) return false;

    const domain = email.split('@')[1];
    if (!domain || domain.length < 4) return false;

    // Exclude placeholder/example domains
    if (EXCLUDED_EMAILS.some(ex => domain.endsWith(ex))) return false;

    // Exclude image/asset file extensions
    if (/\.(png|jpg|jpeg|gif|svg|css|js|ico)$/i.test(email)) return false;

    // Must have at least one dot in domain
    if (!domain.includes('.')) return false;

    return true;
  }

  private generatePatterns(websiteUrl: string): string[] {
    try {
      const url = new URL(websiteUrl);
      const domain = url.hostname.replace(/^www\./, '');

      return [
        `info@${domain}`,
        `contact@${domain}`,
        `hello@${domain}`,
      ];
    } catch {
      return [];
    }
  }

  private resolveUrl(base: string, path: string): string {
    try {
      return new URL(path, base).toString();
    } catch {
      return `${base.replace(/\/$/, '')}${path}`;
    }
  }
}

export const emailDiscoveryService = new EmailDiscoveryService();
