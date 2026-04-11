// ClearEdge — Batch Queue Generation Endpoint
const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const logger = require('../lib/logger');
const { withRetry } = require('../lib/retry');
const { selectPromptVersion, buildEnhancedPrompt } = require('../lib/prompt-engine');

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// POST /api/trigger-queue-generation
async function triggerQueueGeneration(req, res) {
  try {
    let generated = 0;
    let skipped = 0;
    const errors = [];

    const { data: enrollments, error: eErr } = await supabase
      .from('campaign_enrollments')
      .select('*, leads(*), campaigns(*)')
      .eq('status', 'active');

    if (eErr) {
      return res.status(500).json({ success: false, error: eErr.message });
    }

    // Sort by lead score descending — prioritize high-value leads
    const sorted = (enrollments || []).sort(
      (a, b) => (b.leads?.score || 0) - (a.leads?.score || 0)
    );

    logger.info({ enrollments: sorted.length }, 'Starting queue generation (score-prioritized)');

    for (const enrollment of sorted) {
      try {
        const campaign = enrollment.campaigns;
        if (!campaign || campaign.status !== 'active') {
          skipped++;
          continue;
        }

        // Check max touches
        const { count: totalSent } = await supabase
          .from('send_log')
          .select('id', { count: 'exact', head: true })
          .eq('lead_id', enrollment.lead_id)
          .eq('campaign_id', campaign.id)
          .eq('dispatch_status', 'success');

        if ((totalSent || 0) >= (campaign.max_touches || 5)) {
          await supabase
            .from('campaign_enrollments')
            .update({ status: 'completed' })
            .eq('id', enrollment.id);
          skipped++;
          continue;
        }

        // Check daily send limit
        const today = new Date().toISOString().split('T')[0];
        const { count: sentToday } = await supabase
          .from('send_log')
          .select('id', { count: 'exact', head: true })
          .eq('campaign_id', campaign.id)
          .gte('dispatched_at', today + 'T00:00:00Z');

        if ((sentToday || 0) >= campaign.daily_send_limit) {
          skipped++;
          continue;
        }

        // Get current step
        const { data: currentStep } = await supabase
          .from('campaign_steps')
          .select('*')
          .eq('campaign_id', campaign.id)
          .eq('step_order', enrollment.current_step_order)
          .single();

        if (!currentStep) {
          await supabase
            .from('campaign_enrollments')
            .update({ status: 'completed' })
            .eq('id', enrollment.id);
          skipped++;
          continue;
        }
        const nextStep = currentStep;

        // Check delay
        if (nextStep.delay_days > 0) {
          const { data: lastSend } = await supabase
            .from('send_log')
            .select('dispatched_at')
            .eq('lead_id', enrollment.lead_id)
            .eq('campaign_id', campaign.id)
            .order('dispatched_at', { ascending: false })
            .limit(1)
            .single();

          if (lastSend) {
            const daysSinceLast =
              (Date.now() - new Date(lastSend.dispatched_at).getTime()) / 86400000;
            if (daysSinceLast < nextStep.delay_days) {
              skipped++;
              continue;
            }
          }
        }

        // Deduplication check
        const { data: existing } = await supabase
          .from('send_queue')
          .select('id')
          .eq('enrollment_id', enrollment.id)
          .eq('campaign_step_id', nextStep.id)
          .limit(1);

        if (existing && existing.length > 0) {
          skipped++;
          continue;
        }

        // Select prompt version (A/B) and interpolate
        const lead = enrollment.leads;
        const tone = campaign.tone || 'consultative';
        const requireApproval = campaign.require_approval !== false;

        const { prompt: template, versionId } = await selectPromptVersion(
          supabase,
          campaign.id,
          nextStep.step_order,
          nextStep.prompt_template
        );

        const prompt = await buildEnhancedPrompt(supabase, { template, lead, tone });

        const message = await withRetry(
          async () => {
            return anthropic.messages.create({
              model: 'claude-sonnet-4-20250514',
              max_tokens: 500,
              messages: [{ role: 'user', content: prompt }],
            });
          },
          { label: `claude:queue-gen:${enrollment.id}` }
        );

        const aiDraft = message.content[0]?.text || '';
        const charCount = aiDraft.length;
        const overLimit = charCount > (nextStep.character_limit || 1900);
        const status = requireApproval ? 'pending' : 'approved';

        await supabase.from('send_queue').insert({
          enrollment_id: enrollment.id,
          lead_id: lead.id,
          campaign_step_id: nextStep.id,
          ai_draft: aiDraft,
          status,
          char_count: charCount,
          over_limit: overLimit,
          prompt_version_id: versionId,
        });

        generated++;
        logger.info(
          { lead: lead.full_name, step: nextStep.step_order, versionId, status },
          'Queue item generated'
        );
      } catch (err) {
        logger.error(
          { enrollment_id: enrollment.id, error: err.message },
          'Queue generation failed for enrollment'
        );
        errors.push({ enrollment_id: enrollment.id, error: err.message });
      }
    }

    logger.info({ generated, skipped, errors: errors.length }, 'Queue generation complete');
    res.json({ success: true, data: { generated, skipped, errors } });
  } catch (err) {
    logger.error({ error: err.message }, 'Trigger generation error');
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = { triggerQueueGeneration };
