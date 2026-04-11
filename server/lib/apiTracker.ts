// API usage tracker — logs Claude/Unipile/Places/HubSpot calls to the
// `api_usage_log` table so Phase 5 analytics can compute per-workspace
// cost dashboards and per-campaign token spend. Falls back to a
// console log if the DB write fails, since tracking must never break
// the caller.

import { storage } from '../storage';

export type ApiProvider = 'claude' | 'unipile' | 'places' | 'hubspot';

export interface ApiCall {
  provider: ApiProvider;
  endpoint: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  campaignId?: string;
  leadId?: string;
  workspaceId?: string;
}

export async function trackApiCall(call: ApiCall): Promise<void> {
  try {
    await storage.createApiUsageLog({
      workspaceId: call.workspaceId ?? null,
      provider: call.provider,
      endpoint: call.endpoint,
      model: call.model ?? null,
      inputTokens: call.inputTokens ?? null,
      outputTokens: call.outputTokens ?? null,
      campaignId: call.campaignId ?? null,
      leadId: call.leadId ?? null,
    });
  } catch (err) {
    // Last-ditch fallback — log to console so we don't lose the event
    // entirely, but never rethrow.
    console.warn('[apiTracker] DB write failed, falling back to console', {
      call,
      err,
    });
  }
}
