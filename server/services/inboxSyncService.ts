// Unipile inbox sync service — polls the Unipile chat + invitations APIs,
// matches activity against known leads (by unipile_member_id), classifies
// replies via Claude, and records engagement events. Ported from
// ClearEdge Leads api/sync-unipile-inbox.js.
//
// Phase 4 will re-enable two pieces that are deferred here:
//   - recordReplyForVersion: A/B prompt-version reply tracking
//   - storeConversation: RAG knowledge base write-through
// Both are commented on the relevant call sites below.

import { storage } from '../storage';
import { withRetry } from '../lib/retry';
import { classifyReply, type ReplySentiment } from './replyClassifier';
import { recordReplyForVersion } from './promptEngine';
import { storeConversation } from './ragEngine';
import { emit } from '../lib/eventEmitter';
import { deliverWebhookEvent } from './webhookDeliveryService';
import type { Lead } from '@shared/schema';

export interface InboxSyncResult {
  replies: number;
  connectionsAccepted: number;
  classifications: Record<ReplySentiment, number>;
}

interface UnipileChat {
  id?: string;
  sender_id?: string;
  attendees?: Array<{ id?: string }>;
  last_message?: string;
  text?: string;
}

interface UnipileInvitation {
  id?: string;
  linkedin_member_id?: string;
  recipient_id?: string;
}

function getBaseUrl(): string {
  const raw =
    process.env.UNIPILE_BASE_URL || 'https://api30.unipile.com:16074/api/v1/accounts';
  return raw.replace(/\/api\/v1\/accounts\/?$/, '');
}

async function unipileGet<T>(path: string): Promise<T> {
  const apiKey = process.env.UNIPILE_API_KEY;
  if (!apiKey) throw new Error('UNIPILE_API_KEY not set');

  return withRetry<T>(
    async () => {
      const res = await fetch(`${getBaseUrl()}${path}`, {
        headers: { 'X-API-KEY': apiKey, accept: 'application/json' },
      });
      if (!res.ok) {
        const text = await res.text();
        const err: Error & { status?: number } = new Error(`Unipile ${res.status}: ${text}`);
        err.status = res.status;
        throw err;
      }
      return (await res.json()) as T;
    },
    { label: `unipile:GET:${path}` }
  );
}

function extractItems<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (raw && typeof raw === 'object' && 'items' in raw) {
    const items = (raw as { items?: unknown }).items;
    if (Array.isArray(items)) return items as T[];
  }
  return [];
}

// Phase 8 — auto-reply / OOO detection. When the reply body matches any
// of these patterns, the classifier's sentiment is overridden to
// 'out_of_office' and the enrollment is paused for 14 days instead of
// indefinitely. Case-insensitive, must match anywhere in the first 500
// chars of the message.
const OOO_PATTERNS: RegExp[] = [
  /out\s*of\s*office/i,
  /out\s*of\s*the\s*office/i,
  /on\s*vacation/i,
  /on\s*holiday/i,
  /away\s+(from\s+my\s+)?(desk|office)/i,
  /away\s+until/i,
  /auto[-\s]*reply/i,
  /automatic\s*(reply|response)/i,
  /will\s+be\s+(back|returning)/i,
  /return(ing)?\s+on\s+\d/i,
];

function detectOutOfOffice(messageText: string | null | undefined): boolean {
  if (!messageText) return false;
  const sample = messageText.slice(0, 500);
  return OOO_PATTERNS.some((p) => p.test(sample));
}

const OOO_PAUSE_DAYS = 14;

export class InboxSyncService {
  async sync(workspaceId?: string | null): Promise<InboxSyncResult> {
    const classifications: Record<ReplySentiment, number> = {
      positive: 0,
      negative: 0,
      neutral: 0,
      out_of_office: 0,
      unclassified: 0,
    };
    let replies = 0;
    let connectionsAccepted = 0;

    // 1. Fetch chats from Unipile (don't fail whole sync if this errors)
    let chatItems: UnipileChat[] = [];
    try {
      const raw = await unipileGet<unknown>('/api/v1/chats');
      chatItems = extractItems<UnipileChat>(raw);
    } catch (err) {
      console.warn('[inboxSync] chat fetch failed, skipping replies check', err);
    }

    // Build lookup map from unipile_member_id -> lead
    const leadsWithMember = await storage.getLeadsWithUnipileMemberId(workspaceId);
    const leadMap = new Map<string, Lead>();
    for (const lead of leadsWithMember) {
      if (lead.unipileMemberId) leadMap.set(lead.unipileMemberId, lead);
    }

    // 2. Process chats — detect new replies
    for (const chat of chatItems) {
      const senderId = chat.sender_id ?? chat.attendees?.[0]?.id;
      if (!senderId) continue;
      const lead = leadMap.get(senderId);
      if (!lead) continue;

      const already = await storage.hasEngagementEvent(lead.id, 'reply_received');
      if (already) continue;

      const messageText = chat.last_message ?? chat.text ?? '';

      // Phase 8 — OOO keyword check overrides the classifier. Auto-
      // replies are almost always misclassified as 'neutral' or
      // 'positive' (they're polite, formal, and often contain the
      // word "thank you"), which would then pause the enrollment
      // forever. Better to treat them as a temporary hold.
      const isOoo = detectOutOfOffice(messageText);
      const sentiment: ReplySentiment = isOoo
        ? 'out_of_office'
        : await classifyReply(messageText);
      classifications[sentiment]++;

      await storage.createEngagementEvent({
        workspaceId: lead.workspaceId ?? null,
        leadId: lead.id,
        eventType: isOoo ? 'out_of_office' : 'reply_received',
        sentiment,
        eventData: { message: messageText, chatId: chat.id ?? null, ooo: isOoo },
        occurredAt: new Date(),
      });

      if (lead.status !== 'meeting_booked' && !isOoo) {
        await storage.updateLead(lead.id, { status: 'replied' });
      }

      // Enrollment handling — OOO pauses for 14 days via ooo_until,
      // real replies pause indefinitely until the operator unpauses.
      const enrollment = await storage.getActiveEnrollmentForLead(lead.id);
      if (enrollment) {
        if (isOoo) {
          const oooUntil = new Date(Date.now() + OOO_PAUSE_DAYS * 86_400_000);
          await storage.updateEnrollment(enrollment.id, { oooUntil });
        } else {
          await storage.updateEnrollment(enrollment.id, { status: 'paused' });
        }
      }

      // Phase 4: credit the reply to the prompt variant that generated
      // the outbound message, and store the successful conversation in
      // the RAG knowledge base for future message generation.
      const lastQueueItem = await storage.getLastSentQueueItemForLead(lead.id);
      if (lastQueueItem) {
        await recordReplyForVersion(lastQueueItem.id, sentiment === 'positive');

        if (sentiment === 'positive') {
          const outbound = lastQueueItem.editedDraft ?? lastQueueItem.aiDraft;
          if (outbound) {
            const step = lastQueueItem.campaignStepId
              ? await storage.getCampaignStep(lastQueueItem.campaignStepId)
              : null;
            try {
              await storeConversation({
                workspaceId: lead.workspaceId ?? null,
                leadId: lead.id,
                campaignId: step?.campaignId ?? null,
                outboundMessage: outbound,
                replyMessage: messageText,
                sentiment,
                industry: lead.industry,
                titlePattern: lead.title,
              });
            } catch (err) {
              console.warn('[inboxSync] storeConversation failed', err);
            }
          }
        }
      }

      replies++;
    }

    // 3. Fetch accepted invitations from Unipile
    let inviteItems: UnipileInvitation[] = [];
    try {
      const raw = await unipileGet<unknown>('/api/v1/linkedin/invitations?status=accepted');
      inviteItems = extractItems<UnipileInvitation>(raw);
    } catch (err) {
      console.warn('[inboxSync] invitation fetch failed, skipping', err);
    }

    for (const invite of inviteItems) {
      const memberId = invite.linkedin_member_id ?? invite.recipient_id;
      if (!memberId) continue;
      const lead = leadMap.get(memberId);
      if (!lead) continue;

      const already = await storage.hasEngagementEvent(lead.id, 'connection_accepted');
      if (already) continue;

      await storage.createEngagementEvent({
        workspaceId: lead.workspaceId ?? null,
        leadId: lead.id,
        eventType: 'connection_accepted',
        sentiment: null,
        eventData: { invitationId: invite.id ?? null },
        occurredAt: new Date(),
      });

      if (lead.status === 'new' || lead.status === 'contacted') {
        await storage.updateLead(lead.id, { status: 'connected' });
      }
      connectionsAccepted++;
    }

    if (replies > 0) {
      emit(workspaceId, {
        type: 'reply_received',
        data: { replies, classifications },
      });
      // Phase 12 — outbound webhook fan-out (fire-and-forget).
      if (workspaceId) {
        void deliverWebhookEvent(workspaceId, 'lead.reply_received', {
          replies,
          classifications,
        });
      }
    }
    if (connectionsAccepted > 0) {
      emit(workspaceId, {
        type: 'connection_accepted',
        data: { connectionsAccepted },
      });
      if (workspaceId) {
        void deliverWebhookEvent(workspaceId, 'lead.connection_accepted', {
          connectionsAccepted,
        });
      }
    }

    return { replies, connectionsAccepted, classifications };
  }
}

export const inboxSyncService = new InboxSyncService();
