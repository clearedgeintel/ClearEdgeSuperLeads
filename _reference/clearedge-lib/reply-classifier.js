// ClearEdge — Reply Sentiment Classifier using Claude
const Anthropic = require('@anthropic-ai/sdk');
const logger = require('./logger');
const { withRetry } = require('./retry');

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

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

/**
 * Classify a reply message's sentiment using Claude.
 * Returns: 'positive' | 'negative' | 'neutral' | 'out_of_office' | 'unclassified'
 */
async function classifyReply(messageText) {
  if (!messageText || messageText.trim().length === 0) {
    return 'unclassified';
  }

  try {
    const prompt = CLASSIFICATION_PROMPT.replace('{{message}}', messageText.slice(0, 1000));

    const response = await withRetry(
      async () => {
        return anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 20,
          messages: [{ role: 'user', content: prompt }],
        });
      },
      { label: 'claude:classify-reply', maxRetries: 2 }
    );

    const raw = (response.content[0]?.text || '').trim().toLowerCase();

    const valid = ['positive', 'negative', 'neutral', 'out_of_office'];
    const sentiment = valid.find((v) => raw.includes(v)) || 'unclassified';

    logger.debug({ messagePreview: messageText.slice(0, 80), sentiment }, 'Reply classified');
    return sentiment;
  } catch (err) {
    logger.error({ error: err.message }, 'Reply classification failed');
    return 'unclassified';
  }
}

module.exports = { classifyReply };
