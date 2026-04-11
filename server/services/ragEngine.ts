// RAG engine — retrieves similar successful outreach examples from the
// knowledge_base table so the prompt engine can inject them as context,
// and stores new conversations after a positive reply lands. Ported
// from ClearEdge Leads lib/rag-engine.js, adapted to Drizzle via storage.ts.

import { storage } from '../storage';
import type { KnowledgeEntry } from '@shared/schema';

export interface StoreConversationArgs {
  workspaceId?: string | null;
  leadId: string;
  campaignId: string | null;
  outboundMessage: string;
  replyMessage: string;
  sentiment: string;
  industry?: string | null;
  titlePattern?: string | null;
}

export async function storeConversation(args: StoreConversationArgs): Promise<void> {
  const embeddingText = [args.outboundMessage, args.replyMessage].filter(Boolean).join('\n---\n');

  await storage.createKnowledgeEntry({
    workspaceId: args.workspaceId ?? null,
    leadId: args.leadId,
    campaignId: args.campaignId,
    outboundMessage: args.outboundMessage,
    replyMessage: args.replyMessage,
    sentiment: args.sentiment,
    industry: args.industry ?? null,
    titlePattern: args.titlePattern ?? null,
    embeddingText,
  });
}

export interface RetrieveSimilarArgs {
  industry?: string | null;
  titlePattern?: string | null;
  limit?: number;
  workspaceId?: string | null;
}

/**
 * Retrieve positive-sentiment examples similar to the current lead's
 * industry. Falls back to any positive example when no industry match
 * exists (handled inside storage.retrieveKnowledge).
 */
export async function retrieveSimilar(args: RetrieveSimilarArgs): Promise<KnowledgeEntry[]> {
  return await storage.retrieveKnowledge({
    industry: args.industry ?? null,
    sentiment: 'positive',
    limit: args.limit ?? 3,
    workspaceId: args.workspaceId ?? null,
  });
}

/**
 * Format retrieved examples into a prompt-ready context block. Returns
 * an empty string when there are no examples so the caller can safely
 * concatenate unconditionally.
 */
export function formatRagContext(examples: KnowledgeEntry[]): string {
  if (!examples || examples.length === 0) return '';

  const formatted = examples
    .map((ex, i) => {
      let block = `Example ${i + 1} (${ex.industry ?? 'general'}):\nOutreach: "${ex.outboundMessage.slice(0, 300)}"`;
      if (ex.replyMessage) {
        block += `\nPositive reply: "${ex.replyMessage.slice(0, 200)}"`;
      }
      return block;
    })
    .join('\n\n');

  return `\n\nHere are examples of successful outreach messages that received positive replies. Use them as inspiration for tone and approach, but write something unique:\n\n${formatted}\n`;
}
