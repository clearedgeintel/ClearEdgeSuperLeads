import { detectLanguage, getLocalizationInstruction } from '../server/lib/languageDetect';
import type { Lead } from '@shared/schema';

function fakeLead(overrides: Partial<Lead>): Lead {
  return {
    id: 'test',
    workspaceId: null,
    leadSource: 'linkedin',
    businessName: 'Test',
    address: null,
    phone: null,
    email: null,
    emailSource: null,
    website: null,
    category: null,
    notes: null,
    priority: null,
    status: null,
    isDeleted: null,
    deletedAt: null,
    hubspotCompanyId: null,
    hubspotPushedAt: null,
    createdBy: null,
    discoveredAt: null,
    lastContactedAt: null,
    enrichedAt: null,
    reEnrichAfter: null,
    googlePlaceId: null,
    rating: null,
    totalReviews: null,
    businessHours: null,
    placeTypes: null,
    businessStatus: null,
    aiScore: null,
    aiAnalysis: null,
    searchQuery: null,
    emailVerified: null,
    emailVerifiedAt: null,
    linkedinUrl: null,
    fullName: null,
    title: null,
    company: null,
    industry: null,
    companySize: null,
    headline: null,
    connectionDegree: null,
    enrichmentData: null,
    enrichmentStatus: null,
    unipileMemberId: null,
    linkedinScore: null,
    language: null,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  } as Lead;
}

describe('detectLanguage', () => {
  test('defaults to English when no hints present', () => {
    expect(detectLanguage(fakeLead({}))).toBe('en');
  });

  test('detects Spanish from headline keyword', () => {
    expect(detectLanguage(fakeLead({ headline: 'Director de Marketing en Madrid, España' }))).toBe(
      'es'
    );
  });

  test('detects French from Paris', () => {
    expect(detectLanguage(fakeLead({ headline: 'Head of Sales — Paris, France' }))).toBe('fr');
  });

  test('detects German from Berlin/Deutschland', () => {
    expect(detectLanguage(fakeLead({ headline: 'CTO at SaaSCo | Munich, Germany' }))).toBe('de');
  });

  test('explicit lead.language wins over headline heuristic', () => {
    expect(
      detectLanguage(
        fakeLead({ headline: 'CTO — Munich, Germany', language: 'en' })
      )
    ).toBe('en');
  });
});

describe('getLocalizationInstruction', () => {
  test('English returns empty string', () => {
    expect(getLocalizationInstruction('en')).toBe('');
  });

  test('Spanish returns formal usted instruction', () => {
    expect(getLocalizationInstruction('es')).toContain('Spanish');
    expect(getLocalizationInstruction('es')).toContain('usted');
  });

  test('unknown code returns empty string', () => {
    expect(getLocalizationInstruction('xx')).toBe('');
  });

  test('null/undefined returns empty string', () => {
    expect(getLocalizationInstruction(null)).toBe('');
    expect(getLocalizationInstruction(undefined)).toBe('');
  });
});
