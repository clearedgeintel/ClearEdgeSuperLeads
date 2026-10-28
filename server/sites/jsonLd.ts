// LocalBusiness JSON-LD for live sites. Built as an object and serialized by
// the renderer. aggregateRating and review are deliberately omitted: review
// markup about a business on its own site isn't eligible for rich results,
// and the counts aren't independently verified.

import type { BusinessData } from '@shared/sites';

// Category → schema.org type. Every type here was checked on schema.org
// (LocalBusiness, HomeAndConstructionBusiness and HealthAndBeautyBusiness
// subtypes). Order matters: the first match wins.
const TYPE_MAP: { pattern: RegExp; type: string }[] = [
  { pattern: /\broof/, type: 'RoofingContractor' },
  { pattern: /\bplumb/, type: 'Plumber' },
  { pattern: /\belectric/, type: 'Electrician' },
  { pattern: /\bhvac\b|\bheating\b|\bcooling\b|air condition/, type: 'HVACBusiness' },
  { pattern: /\bpaint/, type: 'HousePainter' },
  { pattern: /\blocksmith/, type: 'Locksmith' },
  { pattern: /\bmoving\b|\bmovers?\b/, type: 'MovingCompany' },
  { pattern: /general contractor|\bremodel|\bbuilder|\bconstruction\b/, type: 'GeneralContractor' },
  { pattern: /\bdry clean|\blaundr/, type: 'DryCleaningOrLaundry' }, // before the generic "clean" trades
  // No schema.org type for these trades (there is no LandscapingBusiness):
  {
    pattern:
      /\blandscap|\blawn|\btree\b|\bpest\b|\bclean|\bhandyman|\bfenc|\bconcrete|\bpool\b|\bgutter|\bflooring|\bgarage door|\bpressure wash|\bjunk|\bcontractor\b/,
    type: 'HomeAndConstructionBusiness',
  },
  { pattern: /\bbarber|\bhair\b|\bhair salon/, type: 'HairSalon' },
  { pattern: /\bnail salon|\bnails\b/, type: 'NailSalon' },
  { pattern: /\bday spa|\bspa\b/, type: 'DaySpa' },
  { pattern: /\bbeauty/, type: 'BeautySalon' },
  { pattern: /\bdentist|\bdental/, type: 'Dentist' },
  { pattern: /\breal estate|\brealtor|\brealty/, type: 'RealEstateAgent' },
  { pattern: /\battorney|\blawyer|\blaw firm|\blegal/, type: 'LegalService' },
];

export function schemaTypeForCategory(category: string): string {
  const c = (category || '').toLowerCase();
  for (const { pattern, type } of TYPE_MAP) if (pattern.test(c)) return type;
  return 'LocalBusiness';
}

// ── Opening hours ──────────────────────────────────────────────
// Hours are free text from research or the editor. Only clearly structured
// text is converted to schema.org `openingHours` ("Mo-Fr 08:00-18:00");
// anything else is omitted rather than guessed.

const DAYS: Record<string, string> = {
  mon: 'Mo', monday: 'Mo', tue: 'Tu', tues: 'Tu', tuesday: 'Tu', wed: 'We', wednesday: 'We',
  thu: 'Th', thur: 'Th', thurs: 'Th', thursday: 'Th', fri: 'Fr', friday: 'Fr',
  sat: 'Sa', saturday: 'Sa', sun: 'Su', sunday: 'Su',
};

function day(token: string): string | null {
  return DAYS[token.toLowerCase().replace(/\.$/, '')] ?? null;
}

function time(token: string): string | null {
  const m = token.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ap = m[3]?.[0];
  if (min > 59) return null;
  if (ap) {
    if (h < 1 || h > 12) return null;
    if (ap === 'p' && h !== 12) h += 12;
    if (ap === 'a' && h === 12) h = 0;
  } else if (h > 23) {
    return null;
  }
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

const DASH = '\\s*(?:-|–|—|to)\\s*';
const SEGMENT = new RegExp(
  `^([a-z.]+)(?:${DASH}([a-z.]+))?\\s*:?\\s+(\\d{1,2}(?::\\d{2})?\\s*(?:am|pm|a|p)?)${DASH}(\\d{1,2}(?::\\d{2})?\\s*(?:am|pm|a|p)?)$`,
  'i'
);

/** Parse free-text hours into schema.org openingHours strings, or null. */
export function parseOpeningHours(hours: string | null | undefined): string[] | null {
  const text = (hours || '').trim();
  if (!text) return null;
  if (/^(open\s+)?24\s*(\/|hours?\b|hrs?\b)\s*7?/i.test(text) || /^24\/7$/.test(text)) {
    return ['Mo-Su 00:00-23:59'];
  }
  const out: string[] = [];
  for (const raw of text.split(/[,;]|\n/)) {
    const part = raw.trim();
    if (!part) continue;
    if (/^[a-z.]+(?:\s*(?:-|–|—|to)\s*[a-z.]+)?\s*:?\s*closed$/i.test(part)) continue;
    const m = part.match(SEGMENT);
    if (!m) return null; // any unrecognized segment → omit entirely
    const from = day(m[1]);
    const to = m[2] ? day(m[2]) : null;
    const open = time(m[3]);
    const close = time(m[4]);
    if (!from || (m[2] && !to) || !open || !close) return null;
    out.push(`${to ? `${from}-${to}` : from} ${open}-${close}`);
  }
  return out.length ? out : null;
}

// ── Builder ────────────────────────────────────────────────────

export function buildLocalBusinessJsonLd(data: BusinessData, url: string): Record<string, unknown> {
  const ld: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': schemaTypeForCategory(data.category),
    name: data.name,
    url,
  };
  if (data.phone) ld.telephone = data.phone;
  if (data.city || data.state) {
    ld.address = {
      '@type': 'PostalAddress',
      ...(data.city ? { addressLocality: data.city } : {}),
      ...(data.state ? { addressRegion: data.state } : {}),
      addressCountry: 'US',
    };
  }
  const areas = (data.serviceAreas || []).map((a) => a.trim()).filter(Boolean);
  if (areas.length) ld.areaServed = areas.map((name) => ({ '@type': 'City', name }));
  const openingHours = parseOpeningHours(data.hours);
  if (openingHours) ld.openingHours = openingHours;
  return ld;
}

/** JSON for a <script> block: `<` is escaped so the data can't close the tag. */
export function serializeJsonLd(ld: Record<string, unknown>): string {
  return JSON.stringify(ld).replace(/</g, '\\u003c');
}
