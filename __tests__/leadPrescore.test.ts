import { prescoreLead, prescoreValue } from '@shared/leadPrescore';

describe('prescoreLead', () => {
  it('disqualifies closed businesses regardless of other signals', () => {
    const result = prescoreLead({
      phone: '555-0100',
      website: 'https://example.com',
      address: '1 Main St',
      businessHours: ['Mon 9-5'],
      rating: '4.8',
      totalReviews: 500,
      businessStatus: 'CLOSED_PERMANENTLY',
    });

    expect(result.disqualified).toBe(true);
    expect(result.score).toBe(0);
    expect(result.reasons).toContain('Permanently closed');
  });

  it('treats temporary closure as disqualifying too', () => {
    const result = prescoreLead({ businessStatus: 'CLOSED_TEMPORARILY', phone: '555-0100' });
    expect(result.disqualified).toBe(true);
    expect(result.score).toBe(0);
  });

  it('scores an empty lead at zero without disqualifying it', () => {
    const result = prescoreLead({});
    expect(result.score).toBe(0);
    expect(result.disqualified).toBe(false);
    expect(result.reasons).toEqual([]);
  });

  it('caps a fully-populated lead at 100', () => {
    const result = prescoreLead({
      phone: '555-0100',
      website: 'https://example.com',
      address: '1 Main St',
      businessHours: ['Mon 9-5'],
      rating: 3.0,
      totalReviews: 250,
      businessStatus: 'OPERATIONAL',
    });

    // 25 phone + 20 website + 10 address + 10 hours + 25 reviews + 10 rating gap
    expect(result.score).toBe(100);
  });

  it('weights a weak rating above a strong one (clearer sales hook)', () => {
    const base = { phone: '555-0100', totalReviews: 20 };
    const weak = prescoreValue({ ...base, rating: 2.9 });
    const mid = prescoreValue({ ...base, rating: 4.0 });
    const strong = prescoreValue({ ...base, rating: 4.9 });

    expect(weak).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(strong);
  });

  it('accepts rating as a string, matching the DB column type', () => {
    expect(prescoreValue({ rating: '4.0' })).toBe(prescoreValue({ rating: 4.0 }));
  });

  it('ignores an unparseable rating rather than scoring NaN', () => {
    const result = prescoreLead({ phone: '555-0100', rating: 'not-a-number' });
    expect(result.score).toBe(25);
    expect(Number.isNaN(result.score)).toBe(false);
  });

  it('ranks a contactable lead above an unreachable one', () => {
    const contactable = prescoreValue({
      phone: '555-0100',
      website: 'https://example.com',
      address: '1 Main St',
      totalReviews: 12,
    });
    const unreachable = prescoreValue({ totalReviews: 400, rating: 3.0 });

    expect(contactable).toBeGreaterThan(unreachable);
  });

  it('steps review credit up with volume', () => {
    const scores = [0, 5, 25, 100, 300].map(totalReviews => prescoreValue({ totalReviews }));
    expect(scores).toEqual([0, 8, 15, 20, 25]);
  });

  it('ignores a non-array businessHours value', () => {
    expect(prescoreValue({ businessHours: 'Mon 9-5' as unknown })).toBe(0);
    expect(prescoreValue({ businessHours: [] })).toBe(0);
  });
});
