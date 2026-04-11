// Unipile dispatch service — sends approved send_queue items via Unipile,
// enforces per-action rate limits, and updates send_log / campaign_enrollments.
// Ported from ClearEdge Leads api/unipile-dispatch.js, adapted to Drizzle
// via storage.ts. The reference app had a separate linkedin_audit_log
// table; we skip that and rely on send_log + audit_log (Phase 12 wiring).

import { storage } from '../storage';
import { withRetry } from '../lib/retry';
import {
  isAllowed,
  record,
  remaining,
  humanDelay,
} from '../lib/linkedinLimiter';
import type { SendQueueItem, CampaignStep } from '@shared/schema';

export interface DispatchResult {
  sent: number;
  failed: number;
  rateLimited: number;
  total: number;
}

interface UnipileResponseBody {
  id?: string;
  invitation_id?: string;
  [key: string]: unknown;
}

interface UnipileProfile {
  network_distance?: string;
  is_connection?: boolean;
}

function getBaseUrl(): string {
  const raw =
    process.env.UNIPILE_BASE_URL || 'https://api30.unipile.com:16074/api/v1/accounts';
  return raw.replace(/\/api\/v1\/accounts\/?$/, '');
}

async function unipileRequest<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown
): Promise<T> {
  const apiKey = process.env.UNIPILE_API_KEY;
  if (!apiKey) throw new Error('UNIPILE_API_KEY not set');

  return withRetry<T>(
    async () => {
      const res = await fetch(`${getBaseUrl()}${path}`, {
        method,
        headers: {
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json',
          accept: 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const text = await res.text();
        const err: Error & { status?: number } = new Error(`Unipile ${res.status}: ${text}`);
        err.status = res.status;
        throw err;
      }
      return (await res.json()) as T;
    },
    { label: `unipile:${method}:${path}` }
  );
}

function parseSubjectBody(text: string): { subject: string; body: string } {
  try {
    const parsed = JSON.parse(text) as { subject?: string; body?: string };
    return {
      subject: parsed.subject ?? '',
      body: parsed.body ?? text,
    };
  } catch {
    return { subject: '', body: text };
  }
}

export class UnipileDispatchService {
  /**
   * Dispatch every approved send_queue item for a workspace. Stops the
   * LinkedIn portion of the batch when the hourly limit is hit; email
   * dispatches have their own independent limit.
   */
  async dispatchApproved(workspaceId?: string | null): Promise<DispatchResult> {
    const accountId =
      (await storage.getAppConfig('unipile_account_id', workspaceId)) ??
      process.env.UNIPILE_ACCOUNT_ID;
    if (!accountId) throw new Error('Unipile account ID not configured');

    const items = await storage.getSendQueueByStatus('approved', workspaceId);
    const result: DispatchResult = {
      sent: 0,
      failed: 0,
      rateLimited: 0,
      total: items.length,
    };

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      // LinkedIn rate check — short-circuit the rest of the batch once
      // we hit the hourly ceiling for LinkedIn actions.
      if (item.channel !== 'email' && !isAllowed('dispatch')) {
        console.warn('[dispatch] LinkedIn hourly limit reached', {
          remaining: remaining('dispatch'),
        });
        result.rateLimited += items.length - i;
        break;
      }

      try {
        const dispatched = await this.dispatchSingle(item, accountId);
        if (dispatched === 'sent') result.sent++;
        else if (dispatched === 'rate_limited') result.rateLimited++;
        else result.failed++;
      } catch (err) {
        console.error('[dispatch] error', item.id, err);
        result.failed++;
        await this.recordFailure(item, err instanceof Error ? err.message : String(err));
      }

      // Human-like delay between dispatches
      if (i < items.length - 1) {
        await humanDelay();
      }
    }

    return result;
  }

  private async dispatchSingle(
    item: SendQueueItem,
    accountId: string
  ): Promise<'sent' | 'failed' | 'rate_limited'> {
    const lead = await storage.getLead(item.leadId);
    if (!lead) {
      await storage.updateSendQueueItem(item.id, { status: 'failed' });
      return 'failed';
    }

    const step = item.campaignStepId ? await storage.getCampaignStep(item.campaignStepId) : null;
    const stepType = step?.stepType ?? 'message';
    const messageText = item.editedDraft ?? item.aiDraft ?? '';
    const memberId = lead.unipileMemberId;

    if (!memberId && item.channel !== 'email') {
      await storage.updateSendQueueItem(item.id, { status: 'failed' });
      return 'failed';
    }

    let actualStepType = stepType;
    let dispatchResponse: UnipileResponseBody | null = null;

    if (stepType === 'connection_request' && memberId) {
      // Check if already connected — if so, fall through to a direct message.
      let alreadyConnected = false;
      try {
        const profile = await unipileRequest<UnipileProfile>(
          'GET',
          `/api/v1/users/${memberId}?account_id=${encodeURIComponent(accountId)}`
        );
        alreadyConnected =
          profile?.network_distance === 'DISTANCE_1' || Boolean(profile?.is_connection);
      } catch {
        // Fall through — try the invite anyway if profile check fails.
      }

      if (alreadyConnected) {
        actualStepType = 'message';
        dispatchResponse = await unipileRequest<UnipileResponseBody>('POST', '/api/v1/chats', {
          account_id: accountId,
          attendees_ids: [memberId],
          text: messageText,
        });
        await storage.updateLead(lead.id, { status: 'connected' });
      } else {
        dispatchResponse = await unipileRequest<UnipileResponseBody>(
          'POST',
          '/api/v1/users/invite',
          {
            account_id: accountId,
            provider: 'LINKEDIN',
            provider_id: memberId,
            message: messageText,
          }
        );
      }
    } else if (stepType === 'inmail' && memberId) {
      const { subject, body } = parseSubjectBody(messageText);
      dispatchResponse = await unipileRequest<UnipileResponseBody>('POST', '/api/v1/chats', {
        account_id: accountId,
        attendees_ids: [memberId],
        text: subject ? `${subject}\n\n${body}` : body,
      });
    } else if (stepType === 'email' || item.channel === 'email') {
      const leadEmail = lead.email;
      if (!leadEmail) {
        await storage.updateSendQueueItem(item.id, { status: 'failed' });
        return 'failed';
      }
      if (!isAllowed('email')) {
        return 'rate_limited';
      }
      const { subject, body } = parseSubjectBody(messageText);
      dispatchResponse = await unipileRequest<UnipileResponseBody>('POST', '/api/v1/emails', {
        account_id: accountId,
        to: [{ email: leadEmail, name: lead.fullName ?? lead.businessName ?? '' }],
        subject: subject || 'Following up',
        body,
      });
      record('email');
    } else if (memberId) {
      // Regular LinkedIn message
      dispatchResponse = await unipileRequest<UnipileResponseBody>('POST', '/api/v1/chats', {
        account_id: accountId,
        attendees_ids: [memberId],
        text: messageText,
      });
    }

    const channel = stepType === 'email' || item.channel === 'email' ? 'email' : 'linkedin';
    if (channel === 'linkedin') record('dispatch');

    const unipileMessageId =
      (dispatchResponse?.invitation_id as string | undefined) ??
      (dispatchResponse?.id as string | undefined) ??
      null;

    await storage.createSendLog({
      workspaceId: item.workspaceId ?? null,
      queueItemId: item.id,
      leadId: lead.id,
      campaignId: step?.campaignId ?? null,
      channel,
      messageText,
      stepType: actualStepType,
      dispatchedAt: new Date(),
      unipileMessageId,
      dispatchStatus: 'success',
    });

    await storage.updateSendQueueItem(item.id, {
      status: 'sent',
      reviewedAt: new Date(),
    });

    if (actualStepType === 'connection_request') {
      await storage.updateLead(lead.id, { status: 'contacted' });
    }

    if (item.enrollmentId) {
      const enrollment = await storage.getEnrollment(item.enrollmentId);
      if (enrollment) {
        await storage.updateEnrollment(item.enrollmentId, {
          currentStepOrder: enrollment.currentStepOrder + 1,
        });
      }
    }

    return 'sent';
  }

  private async recordFailure(item: SendQueueItem, errorMessage: string): Promise<void> {
    try {
      const step: CampaignStep | undefined = item.campaignStepId
        ? await storage.getCampaignStep(item.campaignStepId)
        : undefined;
      await storage.createSendLog({
        workspaceId: item.workspaceId ?? null,
        queueItemId: item.id,
        leadId: item.leadId,
        campaignId: step?.campaignId ?? null,
        channel: item.channel ?? 'linkedin',
        messageText: `${item.editedDraft ?? item.aiDraft ?? ''}\n\n[error] ${errorMessage}`,
        stepType: step?.stepType ?? null,
        dispatchedAt: new Date(),
        unipileMessageId: null,
        dispatchStatus: 'failed',
      });
      await storage.updateSendQueueItem(item.id, { status: 'failed' });
    } catch (err) {
      console.error('[dispatch] failed to record failure', err);
    }
  }
}

export const unipileDispatchService = new UnipileDispatchService();
