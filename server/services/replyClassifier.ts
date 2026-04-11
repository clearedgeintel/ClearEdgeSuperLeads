// Claude-backed reply sentiment classifier. Ported from ClearEdge Leads
// lib/reply-classifier.js. Returns one of: positive | negative | neutral
// | out_of_office | unclassified. Kept as a standalone service so Phase 4's
// prompt-engine consolidation can reuse it without creating a circular
// import through aiService.

import Anthropic from '@anthropic-ai/sdk';
import { withRetry } from '../lib/retry';
import { trackApiCall } from '../lib/apiTracker';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' });

const CLASSIFICATION_PROMPT = `Classify the following LinkedIn reply message into exactly one category. Reply with ONLY the category name, nothing else.

Categories:
- positive: Interested, wants to learn more, asks questions, agrees to a call/meeting
- negative: Not interested, asks to stop, declines, unsubscribe
- neutral: Acknowledges but noncommittal, asks a clarifying question, no clear intent
- out_of_office: Auto-reply, vacation, OOO message

Message:
"""
{{message}}
"""

Category:`;

export type ReplySentiment =
  | 'positive'
  | 'negative'
  | 'neutral'
  | 'out_of_office'
  | 'unclassified';

const VALID_SENTIMENTS: ReplySentiment[] = [
  'positive',
  'negative',
  'neutral',
  'out_of_office',
];

export async function classifyReply(
  messageText: string | null | undefined
): Promise<ReplySentiment> {
  if (!messageText || messageText.trim().length === 0) return 'unclassified';

  try {
    const prompt = CLASSIFICATION_PROMPT.replace('{{message}}', messageText.slice(0, 1000));

    const response = await withRetry(
      () =>
        anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 20,
          messages: [{ role: 'user', content: prompt }],
        }),
      { label: 'claude:classify-reply', maxRetries: 2 }
    );

    await trackApiCall({
      provider: 'claude',
      endpoint: 'messages.create',
      model: 'claude-haiku-4-5-20251001',
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
    });

    const block = response.content[0];
    const raw = (block && block.type === 'text' ? block.text : '').trim().toLowerCase();
    return VALID_SENTIMENTS.find((v) => raw.includes(v)) ?? 'unclassified';
  } catch (err) {
    console.error('[replyClassifier] classification failed', err);
    return 'unclassified';
  }
}
