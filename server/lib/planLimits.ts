// Plan limit enforcement — shared pre-send check for both email and
// LinkedIn dispatch paths. Throws PlanLimitExceededError when a
// workspace has burned through its monthly allowance for the channel.
// The route layer maps the error to a 402 "payment required" response
// with { code: 'plan_limit' } so the frontend can prompt an upgrade.

import { storage } from '../storage';
import { getPlanLimits } from '@shared/plans';

export class PlanLimitExceededError extends Error {
  channel: 'email' | 'linkedin';
  used: number;
  limit: number;
  plan: string;

  constructor(channel: 'email' | 'linkedin', plan: string, used: number, limit: number) {
    super(
      `Monthly ${channel} limit reached on ${plan} plan (${used}/${limit}). Upgrade to continue.`
    );
    this.channel = channel;
    this.plan = plan;
    this.used = used;
    this.limit = limit;
  }
}

/**
 * Check whether a workspace can send one more message on the given
 * channel. Throws PlanLimitExceededError when over limit, returns
 * silently otherwise. Skipped entirely when workspaceId is null/undefined
 * (during the Phase 1-8 migration some call sites still don't thread
 * workspaceId through).
 */
export async function assertPlanLimit(
  workspaceId: string | null | undefined,
  channel: 'email' | 'linkedin'
): Promise<void> {
  if (!workspaceId) return;

  const workspace = await storage.getWorkspace(workspaceId);
  if (!workspace) return;

  const limits = getPlanLimits(workspace.plan);
  const used =
    channel === 'email'
      ? workspace.monthlyEmailSendsUsed ?? 0
      : workspace.monthlyLinkedinSendsUsed ?? 0;
  const limit =
    channel === 'email' ? limits.emailSendsPerMonth : limits.linkedinSendsPerMonth;

  if (used >= limit) {
    throw new PlanLimitExceededError(channel, workspace.plan ?? 'free', used, limit);
  }
}

/**
 * Record a successful send against the workspace's monthly counter.
 * Called after the dispatch returns success so we don't decrement the
 * quota for failures.
 */
export async function recordPlanSend(
  workspaceId: string | null | undefined,
  channel: 'email' | 'linkedin'
): Promise<void> {
  if (!workspaceId) return;
  try {
    await storage.incrementWorkspaceSends(workspaceId, channel, 1);
  } catch (err) {
    // Usage counter writes are best-effort; a DB blip can't be allowed
    // to roll back a successful send.
    console.warn('[planLimits] counter increment failed', err);
  }
}
