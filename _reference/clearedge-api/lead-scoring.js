// ClearEdge — AI Lead Scoring Endpoint
const { createClient } = require('@supabase/supabase-js');
const logger = require('../lib/logger');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Scoring weights
const WEIGHTS = {
  has_title: 10,
  has_company: 5,
  has_industry: 5,
  has_headline: 5,
  enriched: 10,
  icp_fit: 0.3, // multiplier on enrichment icp_fit_score
  connection_1st: 15,
  connection_2nd: 8,
  connection_3rd: 3,
  replied: 20,
  connected: 10,
  meeting_booked: 25,
  stale_penalty_per_30d: -5, // decay for leads with no activity
};

function computeScore(lead, engagementCount) {
  let score = 0;
  const factors = {};

  // Profile completeness
  if (lead.title) {
    score += WEIGHTS.has_title;
    factors.title = WEIGHTS.has_title;
  }
  if (lead.company) {
    score += WEIGHTS.has_company;
    factors.company = WEIGHTS.has_company;
  }
  if (lead.industry) {
    score += WEIGHTS.has_industry;
    factors.industry = WEIGHTS.has_industry;
  }
  if (lead.headline) {
    score += WEIGHTS.has_headline;
    factors.headline = WEIGHTS.has_headline;
  }

  // Enrichment
  if (lead.enrichment_status === 'enriched') {
    score += WEIGHTS.enriched;
    factors.enriched = WEIGHTS.enriched;

    if (lead.enrichment_data?.icp_fit_score) {
      const icpBonus = Math.round(lead.enrichment_data.icp_fit_score * WEIGHTS.icp_fit);
      score += icpBonus;
      factors.icp_fit = icpBonus;
    }
  }

  // Connection degree
  if (lead.connection_degree === 1) {
    score += WEIGHTS.connection_1st;
    factors.connection = WEIGHTS.connection_1st;
  } else if (lead.connection_degree === 2) {
    score += WEIGHTS.connection_2nd;
    factors.connection = WEIGHTS.connection_2nd;
  } else if (lead.connection_degree === 3) {
    score += WEIGHTS.connection_3rd;
    factors.connection = WEIGHTS.connection_3rd;
  }

  // Engagement signals
  if (lead.status === 'replied' || lead.status === 'meeting_booked') {
    score += WEIGHTS.replied;
    factors.replied = WEIGHTS.replied;
  }
  if (['connected', 'replied', 'meeting_booked'].includes(lead.status)) {
    score += WEIGHTS.connected;
    factors.connected = WEIGHTS.connected;
  }
  if (lead.status === 'meeting_booked') {
    score += WEIGHTS.meeting_booked;
    factors.meeting_booked = WEIGHTS.meeting_booked;
  }

  // Stale decay — penalize leads with no engagement events and old updated_at
  if (engagementCount === 0 && lead.updated_at) {
    const daysSinceUpdate = (Date.now() - new Date(lead.updated_at).getTime()) / 86400000;
    const periods = Math.floor(daysSinceUpdate / 30);
    if (periods > 0) {
      const penalty = periods * WEIGHTS.stale_penalty_per_30d;
      score += penalty;
      factors.stale_decay = penalty;
    }
  }

  return { score: Math.max(0, Math.min(100, score)), factors };
}

// POST /api/score-leads
// Body: { lead_ids: string[] } or { all: true }
async function scoreLeads(req, res) {
  try {
    const { lead_ids, all } = req.body;

    let query = supabase.from('leads').select('*');
    if (all) {
      query = query.limit(500);
    } else if (lead_ids?.length > 0) {
      query = query.in('id', lead_ids);
    } else {
      return res.status(400).json({ success: false, error: 'Provide lead_ids or set all to true' });
    }

    const { data: leads, error } = await query;
    if (error) return res.status(500).json({ success: false, error: error.message });

    let scored = 0;
    for (const lead of leads || []) {
      // Count engagement events
      const { count } = await supabase
        .from('engagement_events')
        .select('id', { count: 'exact', head: true })
        .eq('lead_id', lead.id);

      const { score, factors } = computeScore(lead, count || 0);

      await supabase
        .from('leads')
        .update({
          score,
          score_factors: factors,
          score_updated_at: new Date().toISOString(),
        })
        .eq('id', lead.id);

      scored++;
    }

    logger.info({ scored, total: (leads || []).length }, 'Lead scoring complete');
    res.json({ success: true, data: { scored } });
  } catch (err) {
    logger.error({ error: err.message }, 'Lead scoring error');
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = { scoreLeads, computeScore };
