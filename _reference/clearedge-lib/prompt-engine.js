// ClearEdge — Prompt Template Engine with A/B Versioning, RAG, and i18n
const logger = require('./logger');
const { retrieveSimilar, formatRagContext } = require('./rag-engine');
const { getLocalizationInstruction } = require('./language-detect');

/**
 * Select a prompt version for a campaign step.
 */
async function selectPromptVersion(supabase, campaignId, stepOrder, fallbackTemplate) {
  const { data: versions } = await supabase
    .from('prompt_versions')
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('step_order', stepOrder);

  if (!versions || versions.length === 0) {
    return { prompt: fallbackTemplate, versionId: null };
  }

  const maxUsed = Math.max(...versions.map((v) => v.times_used), 1);
  const weights = versions.map((v) => maxUsed - v.times_used + 1);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let rand = Math.random() * totalWeight;

  let selected = versions[0];
  for (let i = 0; i < versions.length; i++) {
    rand -= weights[i];
    if (rand <= 0) {
      selected = versions[i];
      break;
    }
  }

  await supabase
    .from('prompt_versions')
    .update({ times_used: selected.times_used + 1 })
    .eq('id', selected.id);

  logger.debug(
    { campaignId, stepOrder, variant: selected.variant, versionId: selected.id },
    'Selected prompt version'
  );

  return { prompt: selected.prompt_template, versionId: selected.id };
}

/**
 * Record a reply against the prompt version that generated the original message.
 */
async function recordReplyForVersion(supabase, queueItemId, isPositive) {
  const { data: item } = await supabase
    .from('send_queue')
    .select('prompt_version_id')
    .eq('id', queueItemId)
    .single();

  if (!item?.prompt_version_id) return;

  const { data: version } = await supabase
    .from('prompt_versions')
    .select('reply_count, positive_reply_count')
    .eq('id', item.prompt_version_id)
    .single();

  if (!version) return;

  const update = { reply_count: version.reply_count + 1 };
  if (isPositive) {
    update.positive_reply_count = version.positive_reply_count + 1;
  }

  await supabase.from('prompt_versions').update(update).eq('id', item.prompt_version_id);

  logger.info(
    { versionId: item.prompt_version_id, isPositive },
    'Recorded reply for prompt version'
  );
}

/**
 * Interpolate template variables into a prompt string.
 */
function interpolatePrompt(template, lead, tone) {
  return (template || '')
    .replace(/\{\{full_name\}\}/g, lead.full_name || 'the recipient')
    .replace(/\{\{title\}\}/g, lead.title || 'their role')
    .replace(/\{\{company\}\}/g, lead.company || 'their company')
    .replace(/\{\{industry\}\}/g, lead.industry || 'their industry')
    .replace(/\{\{headline\}\}/g, lead.headline || '')
    .replace(/\{\{tone\}\}/g, tone || 'consultative')
    .replace(/\{\{company_size\}\}/g, lead.company_size || '')
    .replace(/\{\{enrichment\}\}/g, formatEnrichment(lead.enrichment_data));
}

/**
 * Build a fully enhanced prompt with RAG context, calendar link, and language.
 */
async function buildEnhancedPrompt(supabase, { template, lead, tone, includeRag = true }) {
  let prompt = interpolatePrompt(template, lead, tone);

  // Inject RAG context from successful conversations
  if (includeRag) {
    try {
      const examples = await retrieveSimilar(supabase, {
        industry: lead.industry,
        titlePattern: lead.title,
      });
      const ragContext = formatRagContext(examples);
      if (ragContext) {
        prompt += ragContext;
      }
    } catch (err) {
      logger.debug({ error: err.message }, 'RAG retrieval skipped');
    }
  }

  // Inject calendar link if available
  try {
    const { data: config } = await supabase
      .from('app_config')
      .select('value')
      .eq('key', 'calendly_link')
      .single();
    if (config?.value) {
      prompt += `\n\nIf appropriate, include this scheduling link near the end: ${config.value}`;
    }
  } catch (_) {
    // No calendar link configured
  }

  // Add language instruction
  const language = lead.language || 'en';
  const langInstruction = getLocalizationInstruction(language);
  if (langInstruction) {
    prompt = langInstruction + '\n\n' + prompt;
  }

  return prompt;
}

function formatEnrichment(data) {
  if (!data) return '';
  const parts = [];
  if (data.description) parts.push(`Company: ${data.description}`);
  if (data.technologies) parts.push(`Tech stack: ${data.technologies.join(', ')}`);
  if (data.funding) parts.push(`Funding: ${data.funding}`);
  if (data.employee_count) parts.push(`Employees: ${data.employee_count}`);
  return parts.join('. ');
}

module.exports = {
  selectPromptVersion,
  recordReplyForVersion,
  interpolatePrompt,
  buildEnhancedPrompt,
};
