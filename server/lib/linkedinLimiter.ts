// LinkedIn-specific rate limiter. Enforces per-action hourly caps and
// adds human-like delays between automated actions. Ported from ClearEdge
// Leads lib/linkedin-limiter.js. Counters are in-memory, so they reset on
// process restart — acceptable for the single-tenant Phase 3 rollout.
// Phase 9 multi-tenancy moves per-Unipile-account counters into the
// unipile_accounts.daily_sends_used column in the DB.

import { sleep } from './retry';

export type LinkedInAction = 'search' | 'dispatch' | 'email';

const hourlyLimits: Record<LinkedInAction, number> = {
  search: Number(process.env.LINKEDIN_SEARCH_LIMIT_HOURLY) || 15,
  dispatch: Number(process.env.LINKEDIN_DISPATCH_LIMIT_HOURLY) || 25,
  email: Number(process.env.EMAIL_DISPATCH_LIMIT_HOURLY) || 30,
};

const counters: Record<LinkedInAction, number[]> = {
  search: [],
  dispatch: [],
  email: [],
};

function pruneOld(list: number[]): void {
  const oneHourAgo = Date.now() - 3_600_000;
  while (list.length > 0 && list[0] < oneHourAgo) list.shift();
}

export function isAllowed(action: LinkedInAction): boolean {
  const list = counters[action];
  pruneOld(list);
  return list.length < hourlyLimits[action];
}

export function record(action: LinkedInAction): void {
  counters[action].push(Date.now());
}

export function remaining(action: LinkedInAction): number {
  const list = counters[action];
  pruneOld(list);
  return Math.max(0, hourlyLimits[action] - list.length);
}

/** Randomized 2–6 second human-like delay. */
export async function humanDelay(): Promise<void> {
  const ms = 2000 + Math.random() * 4000;
  await sleep(ms);
}

export { hourlyLimits };
