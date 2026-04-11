// Queue generation service — builds AI drafts for active enrollments and
// inserts them into send_queue for operator review / dispatch. Ported
// from ClearEdge Leads api/generate-messages.js and
// api/trigger-queue-generation.js, adapted to Drizzle via storage.ts.
//
// Phase 4 replaces the fallback-prompt path here with promptEngine's
// A/B version selection; for now we use campaign_steps.prompt_template
// directly.

import { storage } from '../storage';
import { aiService } from './aiService';
import { buildPrompt } from './promptEngine';
import { trackApiCall } from '../lib/apiTracker';
import type { Campaign, Lead, CampaignStep, CampaignEnrollment, SendQueueItem } from '@shared/schema';

export interface GenerateSingleResult {
  queueItemId: string;
  aiDraft: string;
  charCount: number;
  overLimit: boolean;
  status: string;
}

export interface GenerateBatchResult {
  generated: number;
  skipped: number;
  errors: Array<{ enrollmentId: string; error: string }>;
}

function todayMidnightUTC(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export class QueueGenerationService {
  /**
   * Generate a single message for a specific enrollment + step and insert
   * it into send_queue. Used by the manual "generate" endpoint.
   */
  async generateForEnrollment(
    enrollmentId: string,
    stepId: string
  ): Promise<GenerateSingleResult> {
    const enrollment = await storage.getEnrollment(enrollmentId);
    if (!enrollment) throw new Error('Enrollment not found');

    const step = await storage.getCampaignStep(stepId);
    if (!step) throw new Error('Campaign step not found');

    const lead = await storage.getLead(enrollment.leadId);
    if (!lead) throw new Error('Lead not found');

    const campaign = await storage.getCampaign(step.campaignId);
    if (!campaign) throw new Error('Campaign not found');

    return this.generateAndInsert(enrollment, step, lead, campaign);
  }

  /**
   * Iterate every active enrollment and generate the next pending message,
   * enforcing max-touches, daily send limit, step delay, and dedupe rules.
   */
  async generateBatch(): Promise<GenerateBatchResult> {
    const out: GenerateBatchResult = { generated: 0, skipped: 0, errors: [] };

    const enrollments = await storage.getAllActiveEnrollments();

    // Prioritize higher-scoring leads. Fetch leads once so we can sort.
    const enrollmentsWithLeads = await Promise.all(
      enrollments.map(async (e) => {
        const lead = await storage.getLead(e.leadId);
        return { enrollment: e, lead };
      })
    );
    enrollmentsWithLeads.sort(
      (a, b) => (b.lead?.linkedinScore ?? 0) - (a.lead?.linkedinScore ?? 0)
    );

    for (const { enrollment, lead } of enrollmentsWithLeads) {
      try {
        if (!lead) {
          out.skipped++;
          continue;
        }

        const campaign = await storage.getCampaign(enrollment.campaignId);
        if (!campaign || campaign.status !== 'active') {
          out.skipped++;
          continue;
        }

        // Max touches check
        const totalSent = await storage.countSuccessfulSends(campaign.id, lead.id);
        if (totalSent >= (campaign.maxTouches ?? 5)) {
          await storage.updateEnrollment(enrollment.id, { status: 'completed' });
          out.skipped++;
          continue;
        }

        // Daily send limit check
        const sentToday = await storage.countSendsForCampaignSince(
          campaign.id,
          todayMidnightUTC()
        );
        if (sentToday >= (campaign.dailySendLimit ?? 20)) {
          out.skipped++;
          continue;
        }

        // Current step
        const step = await storage.getCampaignStepByOrder(
          campaign.id,
          enrollment.currentStepOrder
        );
        if (!step) {
          await storage.updateEnrollment(enrollment.id, { status: 'completed' });
          out.skipped++;
          continue;
        }

        // Delay check
        if ((step.delayDays ?? 0) > 0) {
          const lastSend = await storage.getLastSendForCampaignLead(campaign.id, lead.id);
          if (lastSend?.dispatchedAt) {
            const daysSince =
              (Date.now() - new Date(lastSend.dispatchedAt).getTime()) / 86_400_000;
            if (daysSince < step.delayDays!) {
              out.skipped++;
              continue;
            }
          }
        }

        // Dedupe check
        const existing = await storage.findExistingQueueItem(enrollment.id, step.id);
        if (existing) {
          out.skipped++;
          continue;
        }

        await this.generateAndInsert(enrollment, step, lead, campaign);
        out.generated++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[queueGen] enrollment failed', enrollment.id, message);
        out.errors.push({ enrollmentId: enrollment.id, error: message });
      }
    }

    return out;
  }

  private async generateAndInsert(
    enrollment: CampaignEnrollment,
    step: CampaignStep,
    lead: Lead,
    campaign: Campaign
  ): Promise<GenerateSingleResult> {
    const tone = campaign.tone ?? 'consultative';
    const requireApproval = campaign.requireApproval !== false;

    const prompt = buildPrompt({ template: step.promptTemplate, lead, tone });

    const { text, inputTokens, outputTokens } = await aiService.generateLinkedInMessage(prompt);

    await trackApiCall({
      provider: 'claude',
      endpoint: 'messages.create',
      model: 'claude-sonnet-4-20250514',
      inputTokens,
      outputTokens,
      campaignId: campaign.id,
      leadId: lead.id,
      workspaceId: campaign.workspaceId ?? undefined,
    });

    const charCount = text.length;
    const overLimit = charCount > (step.characterLimit ?? 1900);
    const status = requireApproval ? 'pending' : 'approved';

    const queueItem: SendQueueItem = await storage.createSendQueueItem({
      workspaceId: campaign.workspaceId ?? null,
      enrollmentId: enrollment.id,
      leadId: lead.id,
      campaignStepId: step.id,
      channel: campaign.outreachChannel === 'email' ? 'email' : 'linkedin',
      aiDraft: text,
      status,
      charCount,
      overLimit,
    });

    return {
      queueItemId: queueItem.id,
      aiDraft: text,
      charCount,
      overLimit,
      status,
    };
  }
}

export const queueGenerationService = new QueueGenerationService();
