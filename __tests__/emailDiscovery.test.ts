import axios from 'axios';
import { EmailDiscoveryService } from '../server/services/emailDiscovery';

jest.mock('axios', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

const mockGet = (axios as unknown as { get: jest.Mock }).get;
const html = (body: string) => ({ data: body });

describe('EmailDiscoveryService', () => {
  let service: EmailDiscoveryService;

  beforeEach(() => {
    mockGet.mockReset();
    service = new EmailDiscoveryService();
  });

  describe('no guessed addresses', () => {
    // The pattern fallback used to fabricate info@<domain> here and store it
    // as if it were real. These tests exist to keep it from coming back.

    test('returns empty when every page fetch fails', async () => {
      mockGet.mockRejectedValue(new Error('ETIMEDOUT'));

      const result = await service.discoverEmails('https://acme-plumbing.com');

      expect(result.emails).toEqual([]);
      expect(result.source).toBe('website');
    });

    test('returns empty when pages load but contain no address', async () => {
      mockGet.mockResolvedValue(html('<html><body>Call us at 555-0100</body></html>'));

      const result = await service.discoverEmails('https://acme-plumbing.com');

      expect(result.emails).toEqual([]);
    });

    test('never invents an address derived from the domain', async () => {
      mockGet.mockRejectedValue(new Error('403 Forbidden'));

      const result = await service.discoverEmails('https://acme-plumbing.com');

      for (const guess of ['info@', 'contact@', 'hello@']) {
        expect(result.emails.some(e => e.startsWith(guess))).toBe(false);
      }
      expect(result.emails.some(e => e.includes('acme-plumbing.com'))).toBe(false);
    });
  });

  describe('real addresses', () => {
    test('extracts an address from page text', async () => {
      mockGet.mockResolvedValue(html('<p>Reach us: Owner@Acme-Plumbing.com</p>'));

      const result = await service.discoverEmails('https://acme-plumbing.com');

      expect(result.emails).toContain('owner@acme-plumbing.com');
      expect(result.source).toBe('website');
    });

    test('extracts an address from a mailto link', async () => {
      mockGet.mockResolvedValue(html('<a href="mailto:jane@acme-plumbing.com">Email</a>'));

      const result = await service.discoverEmails('https://acme-plumbing.com');

      expect(result.emails).toContain('jane@acme-plumbing.com');
    });

    test('a real info@ on the page is still kept — only guessing was removed', async () => {
      mockGet.mockResolvedValue(html('<p>info@acme-plumbing.com</p>'));

      const result = await service.discoverEmails('https://acme-plumbing.com');

      expect(result.emails).toContain('info@acme-plumbing.com');
      expect(result.source).toBe('website');
    });

    test('stops after the landing page when it already yielded an address', async () => {
      mockGet.mockResolvedValue(html('<p>owner@acme-plumbing.com</p>'));

      await service.discoverEmails('https://acme-plumbing.com');

      expect(mockGet).toHaveBeenCalledTimes(1);
    });

    test('falls through to contact/about pages when the landing page is bare', async () => {
      mockGet
        .mockResolvedValueOnce(html('<p>Welcome</p>'))
        .mockResolvedValue(html('<p>owner@acme-plumbing.com</p>'));

      const result = await service.discoverEmails('https://acme-plumbing.com');

      expect(result.emails).toContain('owner@acme-plumbing.com');
      expect(mockGet.mock.calls.length).toBeGreaterThan(1);
    });
  });

  describe('junk filtering', () => {
    test('drops placeholder domains', async () => {
      mockGet.mockResolvedValue(html('<p>you@example.com and me@yoursite.com</p>'));

      const result = await service.discoverEmails('https://acme-plumbing.com');

      expect(result.emails).toEqual([]);
    });

    test('drops asset filenames that look like addresses', async () => {
      mockGet.mockResolvedValue(html('<img src="sprite@2x.png">'));

      const result = await service.discoverEmails('https://acme-plumbing.com');

      expect(result.emails).toEqual([]);
    });
  });
});
