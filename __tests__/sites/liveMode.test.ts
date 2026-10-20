// Phase 3 renderer behavior (demo vs live), JSON-LD, bot filter, preview
// tokens and the HTML cache.

import { renderSite } from '../../server/sites/template/render';
import { SAMPLE_BUSINESS } from '../../server/sites/template/sampleData';
import {
  buildLocalBusinessJsonLd,
  parseOpeningHours,
  schemaTypeForCategory,
} from '../../server/sites/jsonLd';
import { isBot } from '../../server/sites/bots';
import { makePreviewToken, previewSecret, verifyPreviewToken } from '../../server/sites/previewToken';
import { HtmlCache } from '../../server/sites/htmlCache';
import { SAMPLE_TESTIMONIAL_AUTHOR, type SitePhoto } from '../../shared/sites';

const liveData = {
  ...SAMPLE_BUSINESS,
  phone: '(512) 555-0100',
  hours: 'Mon-Fri 8am-6pm, Sat 9am-2pm, Sun closed',
  testimonials: [{ text: 'Fixed our roof fast.', author: 'Pat R.' }],
};
const PHOTOS: SitePhoto[] = [
  { url: 'https://cdn.example.com/hero.jpg', alt: 'Crew on a roof', role: 'hero' },
  { url: 'https://cdn.example.com/g1.jpg', alt: 'Finished job', role: 'gallery' },
  { url: 'https://cdn.example.com/g2.jpg', alt: 'Before and after', role: 'gallery' },
];
const CANONICAL = 'https://example-roofing.com/';

function jsonLdOf(html: string): Record<string, unknown> {
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('no JSON-LD');
  return JSON.parse(m[1]);
}

describe('snapshots', () => {
  test('demo', () => {
    expect(renderSite(SAMPLE_BUSINESS, 'slate', { mode: 'demo', submitUrl: '/s/demo/contact' })).toMatchSnapshot();
  });
  test('live, no photos', () => {
    expect(
      renderSite(liveData, 'clean', { mode: 'live', canonicalUrl: CANONICAL, submitUrl: '/contact', pixelUrl: '/pixel.gif' })
    ).toMatchSnapshot();
  });
  test('live, with photos', () => {
    expect(renderSite(liveData, 'warm', { mode: 'live', canonicalUrl: CANONICAL, photos: PHOTOS })).toMatchSnapshot();
  });
  test('sample data', () => {
    expect(renderSite(SAMPLE_BUSINESS, 'warm')).toMatchSnapshot();
  });
});

describe('demo mode', () => {
  const html = renderSite(SAMPLE_BUSINESS, 'slate');

  test('is the default and is never indexable', () => {
    expect(html).toContain('<meta name="robots" content="noindex,nofollow" />');
    expect(html).not.toContain('rel="canonical"');
    expect(html).not.toContain('application/ld+json');
  });

  test('keeps the demo footer and sample-review note', () => {
    expect(html).toContain('Demo site built by ClearEdge Intelligence');
    expect(html).toContain('Sample reviews');
  });

  test('renders photos too', () => {
    expect(renderSite(SAMPLE_BUSINESS, 'slate', { photos: PHOTOS })).toContain('class="hero-img"');
  });
});

describe('live mode', () => {
  const html = renderSite(liveData, 'clean', { mode: 'live', canonicalUrl: CANONICAL });

  test('indexable, with canonical and footer credit', () => {
    expect(html).not.toContain('noindex');
    expect(html).toContain(`<link rel="canonical" href="${CANONICAL}" />`);
    expect(html).toContain('Website by ClearEdge Intelligence');
    expect(html).toContain('href="https://clearedgeintel.com"');
    expect(html).not.toContain('Demo site built by');
  });

  test('never renders sample reviews, even if one slipped through', () => {
    const withSample = renderSite(
      { ...liveData, testimonials: [...liveData.testimonials, { text: 'x', author: SAMPLE_TESTIMONIAL_AUTHOR }] },
      'clean',
      { mode: 'live', canonicalUrl: CANONICAL }
    );
    expect(withSample).not.toContain(SAMPLE_TESTIMONIAL_AUTHOR);
    expect(withSample).not.toContain('Sample reviews');
    expect(withSample).toContain('Pat R.');
  });

  test('JSON-LD: LocalBusiness fields, no ratings or reviews', () => {
    const ld = jsonLdOf(html);
    expect(ld).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'RoofingContractor',
      name: liveData.name,
      url: CANONICAL,
      telephone: '(512) 555-0100',
      openingHours: ['Mo-Fr 08:00-18:00', 'Sa 09:00-14:00'],
      address: { '@type': 'PostalAddress', addressLocality: liveData.city, addressRegion: liveData.state },
    });
    expect((ld.areaServed as unknown[]).length).toBe(liveData.serviceAreas.length);
    expect(ld).not.toHaveProperty('aggregateRating');
    expect(ld).not.toHaveProperty('review');
  });

  test('JSON-LD cannot break out of its script tag', () => {
    const evil = renderSite({ ...liveData, name: '</script><script>alert(1)</script>' }, 'clean', {
      mode: 'live',
      canonicalUrl: CANONICAL,
    });
    const block = evil.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1];
    expect(block).not.toContain('<');
    expect(JSON.parse(block).name).toBe('</script><script>alert(1)</script>');
  });
});

describe('photos', () => {
  const html = renderSite(liveData, 'warm', { mode: 'live', canonicalUrl: CANONICAL, photos: PHOTOS });

  test('hero has dimensions, priority and alt text', () => {
    expect(html).toMatch(
      /<img class="hero-img" src="https:\/\/cdn\.example\.com\/hero\.jpg" alt="Crew on a roof" width="\d+" height="\d+" fetchpriority="high"/
    );
  });

  test('gallery images lazy-load', () => {
    expect(html.match(/<img src="https:\/\/cdn\.example\.com\/g\d\.jpg"[^>]*loading="lazy"/g)).toHaveLength(2);
  });

  test('no photos renders as before', () => {
    const plain = renderSite(liveData, 'warm', { mode: 'live', canonicalUrl: CANONICAL });
    expect(plain).not.toContain('<img class="hero-img"');
    expect(plain).not.toContain('class="gallery"');
  });

  test('escapes alt text and drops non-http(s) URLs', () => {
    const out = renderSite(SAMPLE_BUSINESS, 'slate', {
      photos: [
        { url: 'javascript:alert(1)', alt: 'x', role: 'hero' },
        { url: 'https://cdn.example.com/a.jpg', alt: '"><script>', role: 'gallery' },
      ],
    });
    expect(out).not.toContain('javascript:');
    expect(out).toContain('alt="&quot;&gt;&lt;script&gt;"');
  });
});

describe('schema.org types', () => {
  test.each([
    ['Roofing Contractor', 'RoofingContractor'],
    ['Plumbing Contractor', 'Plumber'],
    ['Electrician', 'Electrician'],
    ['HVAC Contractor', 'HVACBusiness'],
    ['Heating & Cooling', 'HVACBusiness'],
    ['Painting Contractor', 'HousePainter'],
    ['Locksmith', 'Locksmith'],
    ['Moving Company', 'MovingCompany'],
    ['General Contractor', 'GeneralContractor'],
    ['Landscaping', 'HomeAndConstructionBusiness'],
    ['Lawn Care Service', 'HomeAndConstructionBusiness'],
    ['Pest Control', 'HomeAndConstructionBusiness'],
    ['Dry Cleaning', 'DryCleaningOrLaundry'],
    ['Barber Shop', 'HairSalon'],
    ['Hair Salon', 'HairSalon'],
    ['Real Estate', 'RealEstateAgent'],
    ['Dentist', 'Dentist'],
    ['Coffee Roaster', 'LocalBusiness'],
    ['', 'LocalBusiness'],
  ])('%s → %s', (category, type) => {
    expect(schemaTypeForCategory(category)).toBe(type);
  });
});

describe('opening hours', () => {
  test.each([
    ['Mon-Fri 8am-6pm', ['Mo-Fr 08:00-18:00']],
    ['Mon–Fri 8:00 AM–5:30 PM, Sat 9 AM–1 PM', ['Mo-Fr 08:00-17:30', 'Sa 09:00-13:00']],
    ['Monday to Friday: 7am to 7pm; Sunday closed', ['Mo-Fr 07:00-19:00']],
    ['Tue-Sat 10:00-18:00', ['Tu-Sa 10:00-18:00']],
    ['Open 24 hours', ['Mo-Su 00:00-23:59']],
    ['24/7', ['Mo-Su 00:00-23:59']],
    ['12pm-12am Fri', null], // day after time: not recognized
  ])('%p', (input, expected) => {
    expect(parseOpeningHours(input)).toEqual(expected);
  });

  test.each(['Call for hours', 'By appointment', 'Mon-Fri 8am-6pm, weekends vary', '', 'Mon-Fri 25:00-26:00'])(
    'omits unparseable %p',
    (input) => {
      expect(parseOpeningHours(input)).toBeNull();
    }
  );

  test('builder omits fields it does not have', () => {
    const ld = buildLocalBusinessJsonLd(
      { ...SAMPLE_BUSINESS, phone: null, city: '', state: '', serviceAreas: [], hours: 'Call for hours' },
      CANONICAL
    );
    expect(ld).not.toHaveProperty('telephone');
    expect(ld).not.toHaveProperty('address');
    expect(ld).not.toHaveProperty('areaServed');
    expect(ld).not.toHaveProperty('openingHours');
  });
});

describe('isBot', () => {
  test.each([
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17 Safari/605.1.15 (Applebot/0.1)',
    'Twitterbot/1.0',
    'LinkedInBot/1.0',
    'WhatsApp/2.23',
    'curl/8.4.0',
    'python-requests/2.31',
    'Mozilla/5.0 (compatible; AhrefsBot/7.0)',
    'Mozilla/5.0 (compatible; YandexSpider)',
    'Some Link Preview Generator',
    '',
  ])('bot: %p', (ua) => {
    expect(isBot(ua)).toBe(true);
  });

  test.each([
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5; rv:131.0) Gecko/20100101 Firefox/131.0',
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36',
  ])('person: %p', (ua) => {
    expect(isBot(ua)).toBe(false);
  });
});

describe('preview tokens', () => {
  const secret = 'test-secret';
  const now = 1_700_000_000_000;

  test('valid for its site until it expires', () => {
    const token = makePreviewToken('site-1', secret, now, 1000);
    expect(verifyPreviewToken(token, 'site-1', secret, now + 999)).toBe(true);
    expect(verifyPreviewToken(token, 'site-1', secret, now + 1000)).toBe(false);
  });

  test('bound to the site and the secret', () => {
    const token = makePreviewToken('site-1', secret, now);
    expect(verifyPreviewToken(token, 'site-2', secret, now)).toBe(false);
    expect(verifyPreviewToken(token, 'site-1', 'other-secret', now)).toBe(false);
  });

  test('rejects tampering and junk', () => {
    const token = makePreviewToken('site-1', secret, now);
    const [payload, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ s: 'site-1', e: now + 9e12 })).toString('base64url');
    expect(verifyPreviewToken(`${forged}.${sig}`, 'site-1', secret, now)).toBe(false);
    expect(verifyPreviewToken(`${payload}.`, 'site-1', secret, now)).toBe(false);
    expect(verifyPreviewToken('nonsense', 'site-1', secret, now)).toBe(false);
    expect(verifyPreviewToken(undefined, 'site-1', secret, now)).toBe(false);
  });

  test('production refuses to run without a configured secret', () => {
    expect(previewSecret({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBeNull();
    expect(previewSecret({ NODE_ENV: 'production', SITE_PREVIEW_SECRET: 's' } as NodeJS.ProcessEnv)).toBe('s');
    expect(previewSecret({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toEqual(expect.any(String));
  });
});

describe('HtmlCache', () => {
  test('evicts the least recently used entry', () => {
    const c = new HtmlCache(2);
    c.set('a', '1');
    c.set('b', '2');
    expect(c.get('a')).toBe('1'); // a is now most recent
    c.set('c', '3');
    expect(c.get('b')).toBeUndefined();
    expect(c.get('a')).toBe('1');
    expect(c.get('c')).toBe('3');
    expect(c.size).toBe(2);
  });

  test('keys change when the site is updated', () => {
    expect(HtmlCache.key('s', '2026-01-01T00:00:00Z', 'slug')).not.toBe(
      HtmlCache.key('s', '2026-01-02T00:00:00Z', 'slug')
    );
  });
});
