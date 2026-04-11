// ClearEdge — Campaign Optimization & Voice-of-Customer Analysis
const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const logger = require('../lib/logger');
const { withRetry } = require('../lib/retry');

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// POST /api/optimize/campaigns
// Auto-pause underperforming campaigns and suggest improvements
async function optimizeCampaigns(req, res) {
  try {
    const { data: campaigns } = await supabase.from('campaigns').select('*').eq('status', 'active');

    const results = [];

    for (const campaign of campaigns || []) {
      // Get send count and reply count
      const { count: sent } = await supabase
        .from('send_log')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', campaign.id)
        .eq('dispatch_status', 'success');

      if ((sent || 0) < 10) continue; // Not enough data

      const { data: sentLeadIds } = await supabase
        .from('send_log')
        .select('lead_id')
        .eq('campaign_id', campaign.id)
        .eq('dispatch_status', 'success');

      const leadIds = [...new Set((sentLeadIds || []).map((s) => s.lead_id))];

      const { count: replies } = await supabase
        .from('engagement_events')
        .select('id', { count: 'exact', head: true })
        .eq('event_type', 'reply_received')
        .in('lead_id', leadIds);

      const replyRate = sent > 0 ? ((replies || 0) / sent) * 100 : 0;
      const threshold = campaign.auto_pause_threshold || 0;

      const action = {
        campaign_id: campaign.id,
        name: campaign.name,
        sent,
        replies: replies || 0,
        reply_rate: replyRate.toFixed(1),
      };

      // Auto-pause if below threshold and threshold is set
      if (threshold > 0 && replyRate < threshold) {
        await supabase
          .from('campaigns')
          .update({ status: 'paused', last_optimization_at: new Date().toISOString() })
          .eq('id', campaign.id);
        action.action = 'paused';
        action.reason = `Reply rate ${replyRate.toFixed(1)}% below threshold ${threshold}%`;
        logger.warn(action, 'Campaign auto-paused');
      } else {
        action.action = 'ok';
      }

      results.push(action);
    }

    // Generate improvement suggestions for campaigns with data
    const campaignsWithData = results.filter((r) => r.sent >= 10);
    let suggestions = [];

    if (campaignsWithData.length > 0) {
      try {
        const summaryText = campaignsWithData
          .map((c) => `- ${c.name}: ${c.sent} sent, ${c.replies} replies (${c.reply_rate}%)`)
          .join('\n');

        const response = await withRetry(
          async () => {
            return anthropic.messages.create({
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 500,
              messages: [
                {
                  role: 'user',
                  content: `You are an outreach optimization expert. Given these LinkedIn campaign stats, provide 3-5 specific, actionable suggestions to improve reply rates. Be concise (1-2 sentences each).

Campaign performance:
${summaryText}

Return as JSON array: ["suggestion 1", "suggestion 2", ...]`,
                },
              ],
            });
          },
          { label: 'claude:optimize', maxRetries: 1 }
        );

        const raw = response.content[0]?.text || '[]';
        try {
          suggestions = JSON.parse(raw);
        } catch {
          const match = raw.match(/\[[\s\S]*\]/);
          suggestions = match ? JSON.parse(match[0]) : [];
        }
      } catch (err) {
        logger.error({ error: err.message }, 'Optimization suggestions failed');
      }
    }

    res.json({ success: true, data: { campaigns: results, suggestions } });
  } catch (err) {
    logger.error({ error: err.message }, 'Campaign optimization error');
    res.status(500).json({ success: false, error: err.message });
  }
}

// POST /api/optimize/voc-analysis
// Analyze recent replies for common themes and objections
async function vocAnalysis(req, res) {
  try {
    const days = parseInt(req.query.days) || 30;
    const since = new Date(Date.now() - days * 86400000).toISOString();

    // Get recent replies
    const { data: events } = await supabase
      .from('engagement_events')
      .select('event_data, sentiment, leads(industry, title)')
      .eq('event_type', 'reply_received')
      .gte('occurred_at', since)
      .order('occurred_at', { ascending: false })
      .limit(50);

    const replies = (events || [])
      .map((e) => e.event_data?.message)
      .filter((m) => m && m.trim().length > 10);

    if (replies.length < 3) {
      return res.json({
        success: true,
        data: {
          message: 'Not enough replies for analysis',
          insights: [],
          reply_count: replies.length,
        },
      });
    }

    const repliesText = replies.map((r, i) => `${i + 1}. "${r.slice(0, 300)}"`).join('\n');

    const response = await withRetry(
      async () => {
        return anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          messages: [
            {
              role: 'user',
              content: `Analyze these ${replies.length} LinkedIn outreach replies. Identify patterns and return structured insights.

Replies:
${repliesText}

Return JSON with this structure:
{
  "objections": ["common objection 1", ...],
  "interests": ["topic/pain point they care about", ...],
  "questions": ["questions they ask", ...],
  "trends": ["overall patterns or trends", ...],
  "sentiment_summary": "1-2 sentence summary of overall sentiment",
  "recommendations": ["actionable recommendation 1", ...]
}`,
            },
          ],
        });
      },
      { label: 'claude:voc-analysis' }
    );

    const raw = response.content[0]?.text || '{}';
    let insights;
    try {
      insights = JSON.parse(raw);
    } catch {
      const match = raw.match(/\{[\s\S]*\}/);
      insights = match ? JSON.parse(match[0]) : {};
    }

    // Store insights in DB
    for (const [type, items] of Object.entries(insights)) {
      if (!Array.isArray(items)) continue;
      if (!['objections', 'interests', 'questions', 'trends'].includes(type)) continue;
      const insightType =
        type === 'objections'
          ? 'objection'
          : type === 'interests'
            ? 'interest'
            : type === 'questions'
              ? 'question'
              : 'trend';

      for (const content of items) {
        // Upsert: increment frequency if similar exists
        const { data: existing } = await supabase
          .from('voc_insights')
          .select('id, frequency')
          .eq('insight_type', insightType)
          .ilike('content', `%${content.slice(0, 50)}%`)
          .limit(1);

        if (existing && existing.length > 0) {
          await supabase
            .from('voc_insights')
            .update({
              frequency: existing[0].frequency + 1,
              last_seen_at: new Date().toISOString(),
            })
            .eq('id', existing[0].id);
        } else {
          await supabase.from('voc_insights').insert({
            insight_type: insightType,
            content,
            example_replies: replies.slice(0, 3),
          });
        }
      }
    }

    logger.info({ reply_count: replies.length }, 'VoC analysis complete');
    res.json({ success: true, data: { reply_count: replies.length, insights } });
  } catch (err) {
    logger.error({ error: err.message }, 'VoC analysis error');
    res.status(500).json({ success: false, error: err.message });
  }
}

// GET /api/optimize/insights
async function getInsights(req, res) {
  try {
    const { data } = await supabase
      .from('voc_insights')
      .select('*')
      .order('frequency', { ascending: false })
      .limit(50);

    const grouped = { objection: [], interest: [], question: [], trend: [] };
    (data || []).forEach((i) => {
      if (grouped[i.insight_type]) grouped[i.insight_type].push(i);
    });

    res.json({ success: true, data: grouped });
  } catch (err) {
    logger.error({ error: err.message }, 'Get insights error');
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = { optimizeCampaigns, vocAnalysis, getInsights };
