// API usage / cost tracker. Logs Claude and Unipile calls so Phase 5's
// analytics dashboards can show per-workspace token spend.
//
// The reference implementation wrote to a Supabase `api_usage_log` table.
// That table isn't in the unified schema yet — Phase 5 will add it when
// analytics needs to query it. Until then this is a console-only shim,
// which still gives dev visibility without blocking Phase 3 progress.

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
    // TODO(phase-5): persist to `api_usage_log` table for cost analytics.
    console.log('[api]', call);
  } catch {
    // Tracking must never break the caller.
  }
}
