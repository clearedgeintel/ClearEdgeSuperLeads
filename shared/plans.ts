// Plan tier definitions shared between billing, usage enforcement, and
// the Settings UI. The PLAN_LIMITS map drives both the 402 over-limit
// block and the progress bars on the billing panel.
//
// Phase 9 adds these as the single source of truth for tier rules.
// Adding a new tier means editing this file and nothing else.

export type PlanTier = 'free' | 'solo' | 'team' | 'agency';

export interface PlanLimits {
  name: string;
  priceUsdPerMonth: number;
  emailSendsPerMonth: number;
  linkedinSendsPerMonth: number;
  members: number;
  unipileAccounts: number;
  stripePriceEnvVar: string | null;
}

export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  free: {
    name: 'Free',
    priceUsdPerMonth: 0,
    emailSendsPerMonth: 50,
    linkedinSendsPerMonth: 50,
    members: 1,
    unipileAccounts: 1,
    stripePriceEnvVar: null,
  },
  solo: {
    name: 'Solo',
    priceUsdPerMonth: 49,
    emailSendsPerMonth: 1_000,
    linkedinSendsPerMonth: 500,
    members: 1,
    unipileAccounts: 1,
    stripePriceEnvVar: 'STRIPE_SOLO_PRICE_ID',
  },
  team: {
    name: 'Team',
    priceUsdPerMonth: 149,
    emailSendsPerMonth: 5_000,
    linkedinSendsPerMonth: 2_000,
    members: 5,
    unipileAccounts: 2,
    stripePriceEnvVar: 'STRIPE_TEAM_PRICE_ID',
  },
  agency: {
    name: 'Agency',
    priceUsdPerMonth: 399,
    emailSendsPerMonth: 25_000,
    linkedinSendsPerMonth: 10_000,
    members: Number.POSITIVE_INFINITY,
    unipileAccounts: 5,
    stripePriceEnvVar: 'STRIPE_AGENCY_PRICE_ID',
  },
};

export function getPlanLimits(plan: string | null | undefined): PlanLimits {
  const key = (plan as PlanTier | undefined) ?? 'free';
  return PLAN_LIMITS[key] ?? PLAN_LIMITS.free;
}

export function percentOf(used: number, limit: number): number {
  if (limit <= 0) return 0;
  if (limit === Number.POSITIVE_INFINITY) return 0;
  return Math.round((used / limit) * 100);
}
