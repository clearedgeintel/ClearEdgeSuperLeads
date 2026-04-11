// ClearEdge — Queue Management Endpoints
const { createClient } = require('@supabase/supabase-js');
const logger = require('../lib/logger');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// POST /api/queue/bulk-approve
// Body: { ids: string[] }
async function bulkApprove(req, res) {
  try {
    const { ids } = req.body;

    const { data, error } = await supabase
      .from('send_queue')
      .update({ status: 'approved', reviewed_at: new Date().toISOString() })
      .in('id', ids)
      .eq('status', 'pending')
      .select('id');

    if (error) return res.status(500).json({ success: false, error: error.message });

    logger.info({ approved: data.length, requested: ids.length }, 'Bulk approve complete');
    res.json({ success: true, data: { approved: data.length } });
  } catch (err) {
    logger.error({ error: err.message }, 'Bulk approve error');
    res.status(500).json({ success: false, error: err.message });
  }
}

// POST /api/queue/bulk-skip
// Body: { ids: string[] }
async function bulkSkip(req, res) {
  try {
    const { ids } = req.body;

    const { data, error } = await supabase
      .from('send_queue')
      .update({ status: 'skipped', reviewed_at: new Date().toISOString() })
      .in('id', ids)
      .eq('status', 'pending')
      .select('id');

    if (error) return res.status(500).json({ success: false, error: error.message });

    logger.info({ skipped: data.length, requested: ids.length }, 'Bulk skip complete');
    res.json({ success: true, data: { skipped: data.length } });
  } catch (err) {
    logger.error({ error: err.message }, 'Bulk skip error');
    res.status(500).json({ success: false, error: err.message });
  }
}

// GET /api/queue/stats
async function queueStats(req, res) {
  try {
    const statuses = ['pending', 'approved', 'sent', 'skipped', 'failed'];
    const counts = {};

    for (const status of statuses) {
      const { count } = await supabase
        .from('send_queue')
        .select('id', { count: 'exact', head: true })
        .eq('status', status);
      counts[status] = count || 0;
    }

    res.json({ success: true, data: counts });
  } catch (err) {
    logger.error({ error: err.message }, 'Queue stats error');
    res.status(500).json({ success: false, error: err.message });
  }
}

// GET /api/prompt-versions/:campaignId
async function getPromptVersions(req, res) {
  try {
    const { campaignId } = req.params;

    const { data, error } = await supabase
      .from('prompt_versions')
      .select('*')
      .eq('campaign_id', campaignId)
      .order('step_order')
      .order('variant');

    if (error) return res.status(500).json({ success: false, error: error.message });

    // Calculate reply rate for each version
    const versionsWithRates = (data || []).map((v) => ({
      ...v,
      reply_rate: v.times_used > 0 ? ((v.reply_count / v.times_used) * 100).toFixed(1) : '0.0',
      positive_rate:
        v.reply_count > 0 ? ((v.positive_reply_count / v.reply_count) * 100).toFixed(1) : '0.0',
    }));

    res.json({ success: true, data: versionsWithRates });
  } catch (err) {
    logger.error({ error: err.message }, 'Get prompt versions error');
    res.status(500).json({ success: false, error: err.message });
  }
}

// POST /api/prompt-versions
// Body: { campaign_id, step_order, variant, prompt_template, description }
async function createPromptVersion(req, res) {
  try {
    const { campaign_id, step_order, variant, prompt_template, description } = req.body;

    const { data, error } = await supabase
      .from('prompt_versions')
      .insert({ campaign_id, step_order, variant, prompt_template, description })
      .select()
      .single();

    if (error) return res.status(500).json({ success: false, error: error.message });

    logger.info({ versionId: data.id, campaign_id, variant }, 'Prompt version created');
    res.json({ success: true, data });
  } catch (err) {
    logger.error({ error: err.message }, 'Create prompt version error');
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = { bulkApprove, bulkSkip, queueStats, getPromptVersions, createPromptVersion };
