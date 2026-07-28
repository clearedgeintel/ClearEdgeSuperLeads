/**
 * Free, deterministic lead quality score — no API calls, no tokens.
 *
 * Answers "is this lead worth spending an AI analysis call on?" rather than
 * "how much GBP cleanup does it need" (that's what aiScore measures, and it
 * runs on the inverse scale: low aiScore = high cleanup priority).
 *
 * Computed from fields Google Places already returns at discovery time, so it
 * works retroactively on every lead in the database with no backfill job.
 */

export interface PrescoreBreakdown {
  /** 0-100. Higher = better prospect. 0 means disqualified. */
  score: number;
  /** Set when the business is closed — never worth an AI call. */
  disqualified: boolean;
  /** Human-readable contributions, for tooltips. */
  reasons: string[];
}

export interface PrescoreInput {
  phone?: string | null;
  website?: string | null;
  address?: string | null;
  businessHours?: unknown;
  rating?: string | number | null;
  totalReviews?: number | null;
  businessStatus?: string | null;
}

/**
 * Weights sum to 100. Contactability dominates because a lead we can't reach
 * is worthless regardless of how much cleanup its profile needs.
 */
export function prescoreLead(lead: PrescoreInput): PrescoreBreakdown {
  const status = (lead.businessStatus || '').toUpperCase();
  if (status.startsWith('CLOSED')) {
    return {
      score: 0,
      disqualified: true,
      reasons: [status === 'CLOSED_PERMANENTLY' ? 'Permanently closed' : 'Temporarily closed'],
    };
  }

  const reasons: string[] = [];
  let score = 0;

  // Contactability — 55 points. Can we actually start a conversation?
  if (lead.phone) {
    score += 25;
    reasons.push('Has phone (+25)');
  }
  if (lead.website) {
    score += 20;
    reasons.push('Has website (+20)');
  }
  if (lead.address) {
    score += 10;
    reasons.push('Has address (+10)');
  }

  // Profile completeness — 10 points. Hours present means a maintained profile.
  if (Array.isArray(lead.businessHours) && lead.businessHours.length > 0) {
    score += 10;
    reasons.push('Hours listed (+10)');
  }

  // Establishment — 25 points. Review volume proxies for a real, active business
  // with enough footprint that GBP work moves the needle.
  const reviews = lead.totalReviews ?? 0;
  if (reviews >= 200) {
    score += 25;
    reasons.push(`${reviews} reviews (+25)`);
  } else if (reviews >= 50) {
    score += 20;
    reasons.push(`${reviews} reviews (+20)`);
  } else if (reviews >= 10) {
    score += 15;
    reasons.push(`${reviews} reviews (+15)`);
  } else if (reviews >= 1) {
    score += 8;
    reasons.push(`${reviews} reviews (+8)`);
  }

  // Reputation gap — 10 points. A weak rating is a sharper pitch than a strong
  // one: there's a concrete problem to point at.
  const rating = typeof lead.rating === 'string' ? parseFloat(lead.rating) : lead.rating;
  if (rating != null && !Number.isNaN(rating)) {
    if (rating < 3.5) {
      score += 10;
      reasons.push(`${rating.toFixed(1)}★ — reputation gap (+10)`);
    } else if (rating < 4.5) {
      score += 6;
      reasons.push(`${rating.toFixed(1)}★ (+6)`);
    } else {
      score += 3;
      reasons.push(`${rating.toFixed(1)}★ (+3)`);
    }
  }

  return { score, disqualified: false, reasons };
}

/** Convenience for sorting/filtering when the breakdown isn't needed. */
export function prescoreValue(lead: PrescoreInput): number {
  return prescoreLead(lead).score;
}
