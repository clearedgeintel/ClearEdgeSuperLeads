jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({}),
}));

jest.mock('../lib/logger', () => ({
  warn: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
}));

const { computeScore } = require('../api/lead-scoring');

describe('computeScore', () => {
  test('scores a complete profile higher than empty', () => {
    const complete = {
      title: 'VP Engineering',
      company: 'Acme',
      industry: 'Tech',
      headline: 'Building things',
      enrichment_status: 'enriched',
      enrichment_data: { icp_fit_score: 80 },
      connection_degree: 1,
      status: 'new',
    };
    const empty = { status: 'new' };

    const { score: fullScore } = computeScore(complete, 0);
    const { score: emptyScore } = computeScore(empty, 0);
    expect(fullScore).toBeGreaterThan(emptyScore);
    expect(fullScore).toBeGreaterThan(50);
  });

  test('boosts score for replied and meeting_booked leads', () => {
    const lead = { status: 'meeting_booked', title: 'CTO', company: 'X' };
    const { score, factors } = computeScore(lead, 5);
    expect(factors.replied).toBeDefined();
    expect(factors.meeting_booked).toBeDefined();
    expect(score).toBeGreaterThan(50);
  });

  test('applies stale decay for inactive leads', () => {
    const stale = {
      status: 'new',
      updated_at: new Date(Date.now() - 90 * 86400000).toISOString(),
    };
    const { score, factors } = computeScore(stale, 0);
    expect(factors.stale_decay).toBeLessThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  test('clamps score between 0 and 100', () => {
    const maxLead = {
      title: 'CEO',
      company: 'Big',
      industry: 'Tech',
      headline: 'Leader',
      enrichment_status: 'enriched',
      enrichment_data: { icp_fit_score: 100 },
      connection_degree: 1,
      status: 'meeting_booked',
    };
    const { score } = computeScore(maxLead, 10);
    expect(score).toBeLessThanOrEqual(100);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  test('returns factors object explaining the score', () => {
    const lead = { title: 'Manager', company: 'Corp', connection_degree: 2, status: 'connected' };
    const { factors } = computeScore(lead, 1);
    expect(factors.title).toBe(10);
    expect(factors.company).toBe(5);
    expect(factors.connection).toBe(8);
    expect(factors.connected).toBe(10);
  });
});
