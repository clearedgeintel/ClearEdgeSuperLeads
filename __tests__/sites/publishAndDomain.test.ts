import { validatePublish } from '../../server/sites/publish';
import { isValidCustomDomain, normalizeCustomDomain } from '../../server/sites/domain';
import { slugify, uniqueSlug } from '../../server/sites/slug';
import { SAMPLE_BUSINESS } from '../../server/sites/template/sampleData';
import { SAMPLE_TESTIMONIAL_AUTHOR } from '../../shared/sites';

const ready = {
  data: {
    ...SAMPLE_BUSINESS,
    phone: '(512) 555-0100',
    testimonials: [{ text: 'Great work.', author: 'Pat R.' }],
  },
  notifyEmail: 'owner@example.com',
  customDomain: null,
};

describe('validatePublish', () => {
  test('a complete site has no errors', () => {
    expect(validatePublish(ready)).toEqual([]);
  });

  test('returns every problem at once', () => {
    const errors = validatePublish({
      data: {
        ...ready.data,
        phone: null,
        services: [],
        testimonials: [{ text: 'x', author: SAMPLE_TESTIMONIAL_AUTHOR }],
      },
      notifyEmail: '',
      customDomain: 'not a domain',
    });
    expect(errors).toHaveLength(5);
    expect(errors.join(' ')).toMatch(/sample testimonials/);
    expect(errors.join(' ')).toMatch(/phone/);
    expect(errors.join(' ')).toMatch(/notification email/);
    expect(errors.join(' ')).toMatch(/service/);
    expect(errors.join(' ')).toMatch(/not a valid hostname/);
  });

  test('blank-only phone and service names count as missing', () => {
    const errors = validatePublish({
      ...ready,
      data: { ...ready.data, phone: '   ', services: [{ name: ' ', desc: '' }] },
    });
    expect(errors).toHaveLength(2);
  });
});

describe('custom domains', () => {
  test.each([
    ['Example.com', 'example.com'],
    ['www.example.com', 'example.com'],
    ['https://WWW.Example.com/path?q=1', 'example.com'],
    ['shop.example.co.uk.', 'shop.example.co.uk'],
    ['example.com:8080', 'example.com'],
  ])('normalizes %s → %s', (input, out) => {
    expect(normalizeCustomDomain(input)).toBe(out);
  });

  test.each(['example.com', 'my-shop.example.co.uk', 'xn--bcher-kva.example'])('accepts %s', (d) => {
    expect(isValidCustomDomain(d)).toBe(true);
  });

  test.each([
    '',
    'localhost',
    'example',
    '10.0.0.1',
    '-bad.com',
    'bad-.com',
    'under_score.com',
    'www.example.com', // not normalized
    'Example.com', // not normalized
    'a'.repeat(64) + '.com',
    'printer.local',
  ])('rejects %p', (d) => {
    expect(isValidCustomDomain(d)).toBe(false);
  });
});

describe('slugs', () => {
  test('slugify', () => {
    expect(slugify("Joe's HVAC & Air, LLC")).toBe('joes-hvac-air-llc');
    expect(slugify('Café Olé')).toBe('cafe-ole');
    expect(slugify('!!!')).toBe('site');
  });

  test('uniqueSlug uses the bare slug when free, else a suffix', async () => {
    expect(await uniqueSlug('Acme Plumbing', async () => false)).toBe('acme-plumbing');
    const taken = new Set(['acme-plumbing']);
    const slug = await uniqueSlug('Acme Plumbing', async (s) => taken.has(s));
    expect(slug).toMatch(/^acme-plumbing-[a-z0-9]{5}$/);
  });
});
