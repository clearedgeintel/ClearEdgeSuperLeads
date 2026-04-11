// ClearEdge — AI Message Generation Endpoint
const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const logger = require('../lib/logger');
const { withRetry } = require('../lib/retry');
const { selectPromptVersion, buildEnhancedPrompt } = require('../lib/prompt-engine');
const { trackApiCall } = require('../lib/api-tracker');

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// POST /api/generate-messages
// Body: { enrollment_id, step_id }
async function generateMessage(req, res) {
  try {
    const { enrollment_id, step_id } = req.body;

    // Fetch enrollment + lead
    const { data: enrollment, error: eErr } = await supabase
      .from('campaign_enrollments')
      .select('*, leads(*), campaigns(tone, require_approval)')
      .eq('id', enrollment_id)
      .single();
    if (eErr || !enrollment) {
      return res.status(404).json({ success: false, error: 'Enrollment not found' });
    }

    // Fetch campaign step
    const { data: step, error: sErr } = await supabase
      .from('campaign_steps')
      .select('*')
      .eq('id', step_id)
      .single();
    if (sErr || !step) {
      return res.status(404).json({ success: false, error: 'Campaign step not found' });
    }

    const lead = enrollment.leads;
    const tone = enrollment.campaigns?.tone || 'consultative';
    const requireApproval = enrollment.campaigns?.require_approval !== false;

    // Select prompt version (A/B testing) or fall back to step template
    const { prompt: template, versionId } = await selectPromptVersion(
      supabase,
      step.campaign_id,
      step.step_order,
      step.prompt_template
    );

    const prompt = await buildEnhancedPrompt(supabase, { template, lead, tone });

    // Call Claude API with retry
    const message = await withRetry(
      async () => {
        logger.debug({ enrollment_id, step_id, versionId }, 'Calling Claude API');
        return anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 500,
          messages: [{ role: 'user', content: prompt }],
        });
      },
      { label: 'claude:generate-message' }
    );

    const aiDraft = message.content[0]?.text || '';
    const charCount = aiDraft.length;
    const overLimit = charCount > (step.character_limit || 1900);

    // Track API usage
    trackApiCall({
      provider: 'claude',
      endpoint: 'messages.create',
      model: 'claude-sonnet-4-20250514',
      inputTokens: message.usage?.input_tokens,
      outputTokens: message.usage?.output_tokens,
      campaignId: step.campaign_id,
      leadId: lead.id,
    });

    // Auto-approve if campaign doesn't require approval
    const status = requireApproval ? 'pending' : 'approved';

    // Insert into send_queue
    const { data: queueItem, error: qErr } = await supabase
      .from('send_queue')
      .insert({
        enrollment_id,
        lead_id: lead.id,
        campaign_step_id: step_id,
        ai_draft: aiDraft,
        status,
        char_count: charCount,
        over_limit: overLimit,
        prompt_version_id: versionId,
      })
      .select()
      .single();

    if (qErr) {
      return res.status(500).json({ success: false, error: qErr.message });
    }

    logger.info(
      {
        queue_item_id: queueItem.id,
        lead: lead.full_name,
        charCount,
        overLimit,
        versionId,
        status,
      },
      'Message generated'
    );

    res.json({
      success: true,
      data: {
        queue_item_id: queueItem.id,
        ai_draft: aiDraft,
        char_count: charCount,
        over_limit: overLimit,
        prompt_version: versionId,
        status,
      },
    });
  } catch (err) {
    logger.error({ error: err.message }, 'Generate message error');
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = { generateMessage };
