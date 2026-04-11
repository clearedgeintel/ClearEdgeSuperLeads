// Optimization service — auto-pause underperforming campaigns, generate
// Claude-powered improvement suggestions, and run Voice-of-Customer
// analysis on recent replies. Ported from ClearEdge Leads
// api/optimization.js. Uses the existing aiService wrapper for Claude
// calls so retry + tracking work the same way as queueGenerationService.

import Anthropic from '@anthropic-ai/sdk';
import { storage } from '../storage';
import { withRetry } from '../lib/retry';
import { trackApiCall } from '../lib/apiTracker';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' });

export interface CampaignOptimizationAction {
  campaignId: string;
  name: string;
  sent: number;
  replies: number;
  replyRate: string;
  action: 'paused' | 'ok';
  reason?: string;
}

export interface OptimizeCampaignsResult {
  campaigns: CampaignOptimizationAction[];
  suggestions: string[];
}

export interface VocAnalysisResult {
  replyCount: number;
  insights: Record<string, unknown>;
  message?: string;
}

function extractJson(text: string): unknown {
  const cleaned = text.trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

export class OptimizationService {
  /**
   * Walk every active campaign, compute its reply rate, pause any that
   * fall below `auto_pause_threshold`, and ask Claude for a handful of
   * improvement suggestions based on the batch stats.
   */
  async optimizeCampaigns(workspaceId?: string | null): Promise<OptimizeCampaignsResult> {
    const activeCampaigns = await storage.getActiveCampaignsForOptimization(workspaceId);
    const results: CampaignOptimizationAction[] = [];

    for (const campaign of activeCampaigns) {
      const sent = await storage.countSuccessfulSendsForCampaign(campaign.id);
      if (sent < 10) continue; // Not enough data to decide

      const sentLeadIds = await storage.getSentLeadIdsForCampaign(campaign.id);
      const replies = await storage.countEventsForLeadIds('reply_received', sentLeadIds);
      const replyRate = sent > 0 ? (replies / sent) * 100 : 0;
      const threshold = Number(campaign.autoPauseThreshold ?? 0);

      const action: CampaignOptimizationAction = {
        campaignId: campaign.id,
        name: campaign.name,
        sent,
        replies,
        replyRate: replyRate.toFixed(1),
        action: 'ok',
      };

      if (threshold > 0 && replyRate < threshold) {
        await storage.updateCampaign(campaign.id, {
          status: 'paused',
          lastOptimizationAt: new Date(),
        });
        action.action = 'paused';
        action.reason = `Reply rate ${replyRate.toFixed(1)}% below threshold ${threshold}%`;
      }

      results.push(action);
    }

    const suggestions = await this.generateSuggestions(results);
    return { campaigns: results, suggestions };
  }

  private async generateSuggestions(
    results: CampaignOptimizationAction[]
  ): Promise<string[]> {
    const withData = results.filter((r) => r.sent >= 10);
    if (withData.length === 0) return [];

    try {
      const summaryText = withData
        .map((c) => `- ${c.name}: ${c.sent} sent, ${c.replies} replies (${c.replyRate}%)`)
        .join('\n');

      const response = await withRetry(
        () =>
          anthropic.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 500,
            messages: [
              {
                role: 'user',
                content: `You are an outreach optimization expert. Given these LinkedIn campaign stats, provide 3-5 specific, actionable suggestions to improve reply rates. Be concise (1-2 sentences each).

Campaign performance:
${summaryText}

Return as JSON array: ["suggestion 1", "suggestion 2", ...]`,
              },
            ],
          }),
        { label: 'claude:optimize', maxRetries: 1 }
      );

      await trackApiCall({
        provider: 'claude',
        endpoint: 'messages.create',
        model: 'claude-haiku-4-5-20251001',
        inputTokens: response.usage?.input_tokens,
        outputTokens: response.usage?.output_tokens,
      });

      const block = response.content[0];
      const raw = block && block.type === 'text' ? block.text : '[]';
      const parsed = extractJson(raw);
      return Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch (err) {
      console.error('[optimization] suggestions failed', err);
      return [];
    }
  }

  /**
   * Analyze recent replies for common objections, interests, questions,
   * and trends. Writes grouped insights back to `voc_insights` so
   * operators can see trending pain points without re-running Claude.
   */
  async vocAnalysis(days: number, workspaceId?: string | null): Promise<VocAnalysisResult> {
    const since = new Date(Date.now() - days * 86_400_000);
    const events = await storage.getRecentReplyEvents(50, workspaceId, since);

    const replies = events
      .map((e) => {
        const data = e.eventData as { message?: string } | null;
        return data?.message;
      })
      .filter((m): m is string => Boolean(m && m.trim().length > 10));

    if (replies.length < 3) {
      return {
        replyCount: replies.length,
        insights: {},
        message: 'Not enough replies for analysis',
      };
    }

    const repliesText = replies.map((r, i) => `${i + 1}. "${r.slice(0, 300)}"`).join('\n');

    const response = await withRetry(
      () =>
        anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          messages: [
            {
              role: 'user',
              content: `Analyze these ${replies.length} LinkedIn outreach replies. Identify patterns and return structured insights.

Replies:
${repliesText}

Return JSON with this structure:
{
  "objections": ["common objection 1", ...],
  "interests": ["topic/pain point they care about", ...],
  "questions": ["questions they ask", ...],
  "trends": ["overall patterns or trends", ...],
  "sentiment_summary": "1-2 sentence summary of overall sentiment",
  "recommendations": ["actionable recommendation 1", ...]
}`,
            },
          ],
        }),
      { label: 'claude:voc-analysis' }
    );

    await trackApiCall({
      provider: 'claude',
      endpoint: 'messages.create',
      model: 'claude-sonnet-4-20250514',
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
      workspaceId: workspaceId ?? undefined,
    });

    const block = response.content[0];
    const raw = block && block.type === 'text' ? block.text : '{}';
    const insights = (extractJson(raw) ?? {}) as Record<string, unknown>;

    // Persist grouped insights. Each bucket is upserted — if we already
    // have a similar entry (content prefix match) we just bump frequency.
    const INSIGHT_MAP: Record<string, string> = {
      objections: 'objection',
      interests: 'interest',
      questions: 'question',
      trends: 'trend',
    };

    for (const [key, insightType] of Object.entries(INSIGHT_MAP)) {
      const items = insights[key];
      if (!Array.isArray(items)) continue;

      for (const content of items) {
        if (typeof content !== 'string') continue;
        const existing = await storage.findSimilarVocInsight(
          insightType,
          content.slice(0, 50),
          workspaceId
        );
        if (existing) {
          await storage.bumpVocInsight(existing.id);
        } else {
          await storage.createVocInsight({
            workspaceId: workspaceId ?? null,
            insightType,
            content,
            exampleReplies: replies.slice(0, 3),
          });
        }
      }
    }

    return { replyCount: replies.length, insights };
  }

  async getInsights(
    workspaceId?: string | null
  ): Promise<Record<string, unknown[]>> {
    const insights = await storage.getVocInsights(workspaceId);
    const grouped: Record<string, unknown[]> = {
      objection: [],
      interest: [],
      question: [],
      trend: [],
    };
    for (const i of insights) {
      if (grouped[i.insightType]) grouped[i.insightType].push(i);
    }
    return grouped;
  }
}

export const optimizationService = new OptimizationService();
