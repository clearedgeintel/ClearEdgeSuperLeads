// ClearEdge — RAG Engine for Message Personalization
// Retrieves similar successful outreach from the knowledge base to inform new messages.
const logger = require('./logger');

/**
 * Store a successful conversation pair in the knowledge base.
 */
async function storeConversation(
  supabase,
  { leadId, campaignId, outboundMessage, replyMessage, sentiment, industry, titlePattern }
) {
  const embeddingText = [outboundMessage, replyMessage].filter(Boolean).join('\n---\n');

  await supabase.from('knowledge_base').insert({
    lead_id: leadId,
    campaign_id: campaignId,
    outbound_message: outboundMessage,
    reply_message: replyMessage,
    sentiment,
    industry: industry || null,
    title_pattern: titlePattern || null,
    embedding_text: embeddingText,
  });

  logger.debug({ leadId, sentiment }, 'Stored conversation in knowledge base');
}

/**
 * Retrieve similar successful outreach examples for RAG context injection.
 * Matches by industry and sentiment='positive', returns top examples.
 */
async function retrieveSimilar(supabase, { industry, _titlePattern, limit = 3 }) {
  // Try industry + positive sentiment match first
  let query = supabase
    .from('knowledge_base')
    .select('outbound_message, reply_message, industry, title_pattern')
    .eq('sentiment', 'positive')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (industry) query = query.eq('industry', industry);

  let { data } = await query;

  // Fall back to any positive examples if no industry match
  if ((!data || data.length === 0) && industry) {
    const fallback = await supabase
      .from('knowledge_base')
      .select('outbound_message, reply_message, industry, title_pattern')
      .eq('sentiment', 'positive')
      .order('created_at', { ascending: false })
      .limit(limit);
    data = fallback.data;
  }

  return data || [];
}

/**
 * Format RAG examples into a prompt context block.
 */
function formatRagContext(examples) {
  if (!examples || examples.length === 0) return '';

  const formatted = examples
    .map((ex, i) => {
      let block = `Example ${i + 1} (${ex.industry || 'general'}):\nOutreach: "${ex.outbound_message.slice(0, 300)}"`;
      if (ex.reply_message) {
        block += `\nPositive reply: "${ex.reply_message.slice(0, 200)}"`;
      }
      return block;
    })
    .join('\n\n');

  return `\n\nHere are examples of successful outreach messages that received positive replies. Use them as inspiration for tone and approach, but write something unique:\n\n${formatted}\n`;
}

module.exports = { storeConversation, retrieveSimilar, formatRagContext };
