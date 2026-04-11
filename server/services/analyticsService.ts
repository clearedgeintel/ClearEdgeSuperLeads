// Analytics service — pipeline metrics, campaign stats, A/B leaderboard,
// and API cost dashboard. Ported from ClearEdge Leads api/analytics.js,
// adapted to Drizzle via storage.ts. All methods accept an optional
// workspaceId for Phase 9 multi-tenancy readiness.

import { storage } from '../storage';

export interface AnalyticsOverview {
  periodDays: number;
  totalLeads: number;
  activeCampaigns: number;
  messagesSentTotal: number;
  messagesSentPeriod: number;
  connectionRequestsSent: number;
  connectionsAccepted: number;
  connectionRate: string;
  messagesSent: number;
  repliesReceived: number;
  replyRate: string;
  positiveReplies: number;
  positiveRate: string;
  meetingsBooked: number;
}

export interface CampaignAnalytics {
  id: string;
  name: string;
  status: string | null;
  tone: string | null;
  outreachChannel: string;
  dailySendLimit: number | null;
  requireApproval: boolean | null;
  maxTouches: number | null;
  createdAt: Date | null;
  enrolled: number;
  contacted: number;
  connected: number;
  replied: number;
  positiveReplies: number;
  meetingsBooked: number;
  messagesSent: number;
  replyRate: string;
  positiveRate: string;
}

export interface ApiCostSummary {
  periodDays: number;
  totalCalls: number;
  byProvider: Record<string, { calls: number; inputTokens?: number; outputTokens?: number }>;
  byCampaign: Record<string, Record<string, number>>;
  estimatedClaudeCostUsd: string;
}

export interface PromptLeaderboardEntry {
  id: string;
  campaignName: string;
  variant: string;
  stepOrder: number;
  timesUsed: number;
  replyCount: number;
  positiveReplyCount: number;
  replyRate: string;
  positiveRate: string;
  promptPreview: string;
}

function sinceFromDays(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

function percent(numerator: number, denominator: number): string {
  if (denominator <= 0) return '0.0';
  return ((numerator / denominator) * 100).toFixed(1);
}

export class AnalyticsService {
  async getOverview(days: number, workspaceId?: string | null): Promise<AnalyticsOverview> {
    const since = sinceFromDays(days);

    const [
      totalLeads,
      activeCampaigns,
      sentTotal,
      sentPeriod,
      connSent,
      connAccepted,
      msgSent,
      repliesAll,
      repliesPositive,
      meetingsBooked,
    ] = await Promise.all([
      storage.countLeads(workspaceId),
      storage.countActiveCampaigns(workspaceId),
      storage.countSuccessfulSendsTotal(workspaceId),
      storage.countSuccessfulSendsTotal(workspaceId, since),
      storage.countSendsByStepType(['connection_request'], workspaceId, since),
      storage.countEngagementEvents({
        eventType: 'connection_accepted',
        since,
        workspaceId,
      }),
      storage.countSendsByStepType(['message', 'inmail'], workspaceId, since),
      storage.countEngagementEvents({ eventType: 'reply_received', since, workspaceId }),
      storage.countEngagementEvents({
        eventType: 'reply_received',
        sentiment: 'positive',
        since,
        workspaceId,
      }),
      storage.countEngagementEvents({ eventType: 'meeting_booked', since, workspaceId }),
    ]);

    return {
      periodDays: days,
      totalLeads,
      activeCampaigns,
      messagesSentTotal: sentTotal,
      messagesSentPeriod: sentPeriod,
      connectionRequestsSent: connSent,
      connectionsAccepted: connAccepted,
      connectionRate: percent(connAccepted, connSent),
      messagesSent: msgSent,
      repliesReceived: repliesAll,
      replyRate: percent(repliesAll, msgSent),
      positiveReplies: repliesPositive,
      positiveRate: percent(repliesPositive, repliesAll),
      meetingsBooked,
    };
  }

  async getCampaignComparison(workspaceId?: string | null): Promise<CampaignAnalytics[]> {
    const campaigns = await storage.getAllCampaignsForAnalytics(workspaceId);
    const results: CampaignAnalytics[] = [];

    for (const c of campaigns) {
      const [statuses, messagesSent, sentLeadIds] = await Promise.all([
        storage.getEnrollmentLeadStatuses(c.id),
        storage.countSuccessfulSendsForCampaign(c.id),
        storage.getSentLeadIdsForCampaign(c.id),
      ]);

      const [replies, positiveReplies, meetings] = await Promise.all([
        storage.countEventsForLeadIds('reply_received', sentLeadIds),
        storage.countEventsForLeadIds('reply_received', sentLeadIds, 'positive'),
        storage.countEventsForLeadIds('meeting_booked', sentLeadIds),
      ]);

      const enrolled = statuses.length;
      const connected = statuses.filter((s) =>
        ['connected', 'replied', 'meeting_booked'].includes(s)
      ).length;
      const contacted = statuses.filter((s) => s !== 'new').length;

      results.push({
        id: c.id,
        name: c.name,
        status: c.status,
        tone: c.tone,
        outreachChannel: c.outreachChannel,
        dailySendLimit: c.dailySendLimit,
        requireApproval: c.requireApproval,
        maxTouches: c.maxTouches,
        createdAt: c.createdAt,
        enrolled,
        contacted,
        connected,
        replied: replies,
        positiveReplies,
        meetingsBooked: meetings,
        messagesSent,
        replyRate: percent(replies, messagesSent),
        positiveRate: percent(positiveReplies, replies),
      });
    }

    return results;
  }

  async getApiCosts(days: number, workspaceId?: string | null): Promise<ApiCostSummary> {
    const since = sinceFromDays(days);
    const logs = await storage.getApiUsageLogsSince(since, workspaceId);

    const byProvider: Record<
      string,
      { calls: number; inputTokens?: number; outputTokens?: number }
    > = {};
    const byCampaign: Record<string, Record<string, number>> = {};

    for (const log of logs) {
      const p = byProvider[log.provider] ?? { calls: 0 };
      p.calls++;
      if (log.inputTokens) p.inputTokens = (p.inputTokens ?? 0) + log.inputTokens;
      if (log.outputTokens) p.outputTokens = (p.outputTokens ?? 0) + log.outputTokens;
      byProvider[log.provider] = p;

      if (log.campaignId) {
        if (!byCampaign[log.campaignId]) byCampaign[log.campaignId] = {};
        byCampaign[log.campaignId][log.provider] =
          (byCampaign[log.campaignId][log.provider] ?? 0) + 1;
      }
    }

    const claude = byProvider.claude ?? { calls: 0 };
    // Sonnet 4 pricing: $0.80 input, $4.00 output per 1M tokens
    const estimatedClaudeCostUsd =
      (((claude.inputTokens ?? 0) / 1_000_000) * 0.8 +
        ((claude.outputTokens ?? 0) / 1_000_000) * 4.0).toFixed(4);

    return {
      periodDays: days,
      totalCalls: logs.length,
      byProvider,
      byCampaign,
      estimatedClaudeCostUsd,
    };
  }

  async getPromptLeaderboard(): Promise<PromptLeaderboardEntry[]> {
    const versions = await storage.getTopPromptVersions(20);
    return versions.map((v) => ({
      id: v.id,
      campaignName: v.campaignName ?? '—',
      variant: v.variant,
      stepOrder: v.stepOrder,
      timesUsed: v.timesUsed ?? 0,
      replyCount: v.replyCount ?? 0,
      positiveReplyCount: v.positiveReplyCount ?? 0,
      replyRate: percent(v.replyCount ?? 0, v.timesUsed ?? 0),
      positiveRate: percent(v.positiveReplyCount ?? 0, v.replyCount ?? 0),
      promptPreview: v.promptTemplate.slice(0, 100),
    }));
  }
}

export const analyticsService = new AnalyticsService();
