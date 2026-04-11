// LinkedIn-specific rate limiter. Enforces per-action hourly caps and
// adds human-like delays between automated actions. Ported from ClearEdge
// Leads lib/linkedin-limiter.js. Counters are in-memory, so they reset on
// process restart — acceptable for the single-tenant Phase 3 rollout.
// Phase 9 multi-tenancy moves per-Unipile-account counters into the
// unipile_accounts.daily_sends_used column in the DB.

import { sleep } from './retry';

export type LinkedInAction = 'search' | 'dispatch' | 'email' | 'connection_request';

const hourlyLimits: Record<LinkedInAction, number> = {
  search: Number(process.env.LINKEDIN_SEARCH_LIMIT_HOURLY) || 15,
  dispatch: Number(process.env.LINKEDIN_DISPATCH_LIMIT_HOURLY) || 25,
  email: Number(process.env.EMAIL_DISPATCH_LIMIT_HOURLY) || 30,
  connection_request: Number(process.env.LINKEDIN_DISPATCH_LIMIT_HOURLY) || 25,
};

// Hard daily caps are a LinkedIn ToS safety net in addition to the
// hourly limits. The values below match the conservative recommendations
// in the roadmap (§7.5). Operators can loosen them via env, but the
// hard cap enforces a ceiling the service will never exceed.
const dailyCaps: Record<LinkedInAction, number> = {
  search: Number(process.env.LINKEDIN_SEARCH_LIMIT_DAILY) || 100,
  dispatch: Number(process.env.LINKEDIN_DISPATCH_LIMIT_DAILY) || 50,
  email: Number(process.env.EMAIL_DISPATCH_LIMIT_DAILY) || 300,
  connection_request: Number(process.env.LINKEDIN_CONNECTION_LIMIT_DAILY) || 20,
};

const hourlyCounters: Record<LinkedInAction, number[]> = {
  search: [],
  dispatch: [],
  email: [],
  connection_request: [],
};

const dailyCounters: Record<LinkedInAction, number[]> = {
  search: [],
  dispatch: [],
  email: [],
  connection_request: [],
};

function pruneHourly(list: number[]): void {
  const oneHourAgo = Date.now() - 3_600_000;
  while (list.length > 0 && list[0] < oneHourAgo) list.shift();
}

function pruneDaily(list: number[]): void {
  const oneDayAgo = Date.now() - 86_400_000;
  while (list.length > 0 && list[0] < oneDayAgo) list.shift();
}

function pruneOld(list: number[]): void {
  pruneHourly(list);
}

export function isAllowed(action: LinkedInAction): boolean {
  const hour = hourlyCounters[action];
  const day = dailyCounters[action];
  pruneHourly(hour);
  pruneDaily(day);
  return hour.length < hourlyLimits[action] && day.length < dailyCaps[action];
}

export function record(action: LinkedInAction): void {
  const now = Date.now();
  hourlyCounters[action].push(now);
  dailyCounters[action].push(now);
}

export function remaining(action: LinkedInAction): number {
  const hour = hourlyCounters[action];
  const day = dailyCounters[action];
  pruneHourly(hour);
  pruneDaily(day);
  const hourLeft = Math.max(0, hourlyLimits[action] - hour.length);
  const dayLeft = Math.max(0, dailyCaps[action] - day.length);
  return Math.min(hourLeft, dayLeft);
}

export function dailyUsed(action: LinkedInAction): number {
  const day = dailyCounters[action];
  pruneDaily(day);
  return day.length;
}

export function dailyCap(action: LinkedInAction): number {
  return dailyCaps[action];
}

/** Randomized 2–6 second human-like delay. */
export async function humanDelay(): Promise<void> {
  const ms = 2000 + Math.random() * 4000;
  await sleep(ms);
}

export { hourlyLimits, dailyCaps };
