// ClearEdge — Analytics & Reporting Endpoints
const { createClient } = require('@supabase/supabase-js');
const logger = require('../lib/logger');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// GET /api/analytics/overview
async function getOverview(req, res) {
  try {
    const days = parseInt(req.query.days) || 30;
    const since = new Date(Date.now() - days * 86400000).toISOString();

    const [
      totalLeads,
      activeCampaigns,
      sentTotal,
      sentPeriod,
      connSent,
      connAccepted,
      msgSent,
      repliesAll,
      repliesPositive,
      meetingsBooked,
    ] = await Promise.all([
      supabase.from('leads').select('id', { count: 'exact', head: true }),
      supabase
        .from('campaigns')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'active'),
      supabase
        .from('send_log')
        .select('id', { count: 'exact', head: true })
        .eq('dispatch_status', 'success'),
      supabase
        .from('send_log')
        .select('id', { count: 'exact', head: true })
        .eq('dispatch_status', 'success')
        .gte('dispatched_at', since),
      supabase
        .from('send_log')
        .select('id', { count: 'exact', head: true })
        .eq('step_type', 'connection_request')
        .eq('dispatch_status', 'success')
        .gte('dispatched_at', since),
      supabase
        .from('engagement_events')
        .select('id', { count: 'exact', head: true })
        .eq('event_type', 'connection_accepted')
        .gte('occurred_at', since),
      supabase
        .from('send_log')
        .select('id', { count: 'exact', head: true })
        .in('step_type', ['message', 'inmail'])
        .eq('dispatch_status', 'success')
        .gte('dispatched_at', since),
      supabase
        .from('engagement_events')
        .select('id', { count: 'exact', head: true })
        .eq('event_type', 'reply_received')
        .gte('occurred_at', since),
      supabase
        .from('engagement_events')
        .select('id', { count: 'exact', head: true })
        .eq('event_type', 'reply_received')
        .eq('sentiment', 'positive')
        .gte('occurred_at', since),
      supabase
        .from('engagement_events')
        .select('id', { count: 'exact', head: true })
        .eq('event_type', 'meeting_booked')
        .gte('occurred_at', since),
    ]);

    const connRate =
      (connSent.count || 0) > 0
        ? (((connAccepted.count || 0) / connSent.count) * 100).toFixed(1)
        : '0.0';
    const replyRate =
      (msgSent.count || 0) > 0
        ? (((repliesAll.count || 0) / msgSent.count) * 100).toFixed(1)
        : '0.0';
    const positiveRate =
      (repliesAll.count || 0) > 0
        ? (((repliesPositive.count || 0) / repliesAll.count) * 100).toFixed(1)
        : '0.0';

    res.json({
      success: true,
      data: {
        period_days: days,
        total_leads: totalLeads.count || 0,
        active_campaigns: activeCampaigns.count || 0,
        messages_sent_total: sentTotal.count || 0,
        messages_sent_period: sentPeriod.count || 0,
        connection_requests_sent: connSent.count || 0,
        connections_accepted: connAccepted.count || 0,
        connection_rate: connRate,
        messages_sent: msgSent.count || 0,
        replies_received: repliesAll.count || 0,
        reply_rate: replyRate,
        positive_replies: repliesPositive.count || 0,
        positive_rate: positiveRate,
        meetings_booked: meetingsBooked.count || 0,
      },
    });
  } catch (err) {
    logger.error({ error: err.message }, 'Analytics overview error');
    res.status(500).json({ success: false, error: err.message });
  }
}

// GET /api/analytics/campaigns
async function getCampaignComparison(req, res) {
  try {
    const { data: campaigns } = await supabase
      .from('campaigns')
      .select('id, name, status, tone, daily_send_limit, require_approval, max_touches, created_at')
      .order('created_at', { ascending: false });

    const results = [];
    for (const c of campaigns || []) {
      const [enrollments, sentLogs, replies, positiveReplies, meetings] = await Promise.all([
        supabase.from('campaign_enrollments').select('leads(status)').eq('campaign_id', c.id),
        supabase
          .from('send_log')
          .select('id', { count: 'exact', head: true })
          .eq('campaign_id', c.id)
          .eq('dispatch_status', 'success'),
        supabase
          .from('send_log')
          .select('lead_id')
          .eq('campaign_id', c.id)
          .eq('dispatch_status', 'success')
          .then(async (sent) => {
            if (!sent.data?.length) return { count: 0 };
            const leadIds = [...new Set(sent.data.map((s) => s.lead_id))];
            return supabase
              .from('engagement_events')
              .select('id', { count: 'exact', head: true })
              .eq('event_type', 'reply_received')
              .in('lead_id', leadIds);
          }),
        supabase
          .from('send_log')
          .select('lead_id')
          .eq('campaign_id', c.id)
          .eq('dispatch_status', 'success')
          .then(async (sent) => {
            if (!sent.data?.length) return { count: 0 };
            const leadIds = [...new Set(sent.data.map((s) => s.lead_id))];
            return supabase
              .from('engagement_events')
              .select('id', { count: 'exact', head: true })
              .eq('event_type', 'reply_received')
              .eq('sentiment', 'positive')
              .in('lead_id', leadIds);
          }),
        supabase
          .from('send_log')
          .select('lead_id')
          .eq('campaign_id', c.id)
          .eq('dispatch_status', 'success')
          .then(async (sent) => {
            if (!sent.data?.length) return { count: 0 };
            const leadIds = [...new Set(sent.data.map((s) => s.lead_id))];
            return supabase
              .from('engagement_events')
              .select('id', { count: 'exact', head: true })
              .eq('event_type', 'meeting_booked')
              .in('lead_id', leadIds);
          }),
      ]);

      const statuses = (enrollments.data || []).map((e) => e.leads?.status);
      const enrolled = statuses.length;
      const sent = sentLogs.count || 0;

      results.push({
        ...c,
        enrolled,
        contacted: statuses.filter((s) => s && s !== 'new').length,
        connected: statuses.filter((s) => ['connected', 'replied', 'meeting_booked'].includes(s))
          .length,
        replied: replies.count || 0,
        positive_replies: positiveReplies.count || 0,
        meetings_booked: meetings.count || 0,
        messages_sent: sent,
        reply_rate: sent > 0 ? (((replies.count || 0) / sent) * 100).toFixed(1) : '0.0',
        positive_rate:
          (replies.count || 0) > 0
            ? (((positiveReplies.count || 0) / replies.count) * 100).toFixed(1)
            : '0.0',
      });
    }

    res.json({ success: true, data: results });
  } catch (err) {
    logger.error({ error: err.message }, 'Campaign comparison error');
    res.status(500).json({ success: false, error: err.message });
  }
}

// GET /api/analytics/api-costs
async function getApiCosts(req, res) {
  try {
    const days = parseInt(req.query.days) || 30;
    const since = new Date(Date.now() - days * 86400000).toISOString();

    const { data: logs } = await supabase
      .from('api_usage_log')
      .select('provider, model, input_tokens, output_tokens, campaign_id')
      .gte('created_at', since);

    // Aggregate by provider
    const summary = {
      claude: { calls: 0, input_tokens: 0, output_tokens: 0 },
      unipile: { calls: 0 },
    };
    const byCampaign = {};

    for (const log of logs || []) {
      const p = summary[log.provider] || { calls: 0 };
      p.calls++;
      if (log.input_tokens) p.input_tokens = (p.input_tokens || 0) + log.input_tokens;
      if (log.output_tokens) p.output_tokens = (p.output_tokens || 0) + log.output_tokens;
      summary[log.provider] = p;

      if (log.campaign_id) {
        if (!byCampaign[log.campaign_id]) byCampaign[log.campaign_id] = { claude: 0, unipile: 0 };
        byCampaign[log.campaign_id][log.provider]++;
      }
    }

    // Estimate costs (rough pricing)
    const claudeCost =
      ((summary.claude.input_tokens || 0) / 1_000_000) * 0.8 +
      ((summary.claude.output_tokens || 0) / 1_000_000) * 4.0;

    res.json({
      success: true,
      data: {
        period_days: days,
        total_calls: (logs || []).length,
        by_provider: summary,
        by_campaign: byCampaign,
        estimated_claude_cost_usd: claudeCost.toFixed(4),
      },
    });
  } catch (err) {
    logger.error({ error: err.message }, 'API costs error');
    res.status(500).json({ success: false, error: err.message });
  }
}

// GET /api/analytics/prompt-leaderboard
async function getPromptLeaderboard(req, res) {
  try {
    const { data } = await supabase
      .from('prompt_versions')
      .select('*, campaigns(name)')
      .gt('times_used', 0)
      .order('reply_count', { ascending: false })
      .limit(20);

    const leaderboard = (data || []).map((v) => ({
      id: v.id,
      campaign_name: v.campaigns?.name || '—',
      variant: v.variant,
      step_order: v.step_order,
      times_used: v.times_used,
      reply_count: v.reply_count,
      positive_reply_count: v.positive_reply_count,
      reply_rate: v.times_used > 0 ? ((v.reply_count / v.times_used) * 100).toFixed(1) : '0.0',
      positive_rate:
        v.reply_count > 0 ? ((v.positive_reply_count / v.reply_count) * 100).toFixed(1) : '0.0',
      prompt_preview: (v.prompt_template || '').slice(0, 100),
    }));

    res.json({ success: true, data: leaderboard });
  } catch (err) {
    logger.error({ error: err.message }, 'Prompt leaderboard error');
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = { getOverview, getCampaignComparison, getApiCosts, getPromptLeaderboard };
