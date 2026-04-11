// ClearEdge — Lead Enrichment Endpoint
// Uses Claude to enrich lead profiles based on available data.
// Can be extended to call Apollo/Clearbit/Hunter APIs in the future.
const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const logger = require('../lib/logger');
const { withRetry } = require('../lib/retry');

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const ENRICHMENT_PROMPT = `Given this LinkedIn profile information, research and provide enriched company/person data in valid JSON format. Only include fields you're reasonably confident about based on the information given.

Profile:
- Name: {{full_name}}
- Title: {{title}}
- Headline: {{headline}}
- Company: {{company}}
- Industry: {{industry}}

Return JSON with these fields (omit any you can't determine):
{
  "company_size": "small/medium/large/enterprise",
  "employee_count": "estimated number or range",
  "description": "1-2 sentence company description",
  "technologies": ["likely tech stack based on industry/role"],
  "pain_points": ["2-3 likely business challenges"],
  "talking_points": ["2-3 personalized conversation starters"],
  "icp_fit_score": 0-100
}

JSON only, no explanation:`;

// POST /api/enrich-leads
// Body: { lead_ids: string[] } or { all_pending: true }
async function enrichLeads(req, res) {
  try {
    const { lead_ids, all_pending } = req.body;

    let query = supabase.from('leads').select('*');

    if (all_pending) {
      query = query.eq('enrichment_status', 'pending').limit(50);
    } else if (lead_ids && lead_ids.length > 0) {
      query = query.in('id', lead_ids);
    } else {
      return res.status(400).json({ success: false, error: 'Provide lead_ids or all_pending' });
    }

    const { data: leads, error } = await query;
    if (error) return res.status(500).json({ success: false, error: error.message });

    let enriched = 0,
      failed = 0;

    for (const lead of leads || []) {
      try {
        const prompt = ENRICHMENT_PROMPT.replace('{{full_name}}', lead.full_name || 'Unknown')
          .replace('{{title}}', lead.title || 'Unknown')
          .replace('{{headline}}', lead.headline || '')
          .replace('{{company}}', lead.company || 'Unknown')
          .replace('{{industry}}', lead.industry || 'Unknown');

        const response = await withRetry(
          async () => {
            return anthropic.messages.create({
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 500,
              messages: [{ role: 'user', content: prompt }],
            });
          },
          { label: `claude:enrich:${lead.id}`, maxRetries: 2 }
        );

        const rawText = response.content[0]?.text || '{}';
        let enrichmentData;
        try {
          enrichmentData = JSON.parse(rawText);
        } catch {
          // Try extracting JSON from response
          const match = rawText.match(/\{[\s\S]*\}/);
          enrichmentData = match ? JSON.parse(match[0]) : {};
        }

        // Update company_size if we got it
        const updates = {
          enrichment_data: enrichmentData,
          enrichment_status: 'enriched',
          enriched_at: new Date().toISOString(),
        };
        if (enrichmentData.company_size && !lead.company_size) {
          updates.company_size = enrichmentData.company_size;
        }

        await supabase.from('leads').update(updates).eq('id', lead.id);

        enriched++;
        logger.info({ lead_id: lead.id, lead: lead.full_name }, 'Lead enriched');
      } catch (err) {
        logger.error({ lead_id: lead.id, error: err.message }, 'Enrichment failed for lead');
        await supabase.from('leads').update({ enrichment_status: 'failed' }).eq('id', lead.id);
        failed++;
      }
    }

    logger.info({ enriched, failed, total: (leads || []).length }, 'Enrichment batch complete');
    res.json({ success: true, data: { enriched, failed, total: (leads || []).length } });
  } catch (err) {
    logger.error({ error: err.message }, 'Enrichment endpoint error');
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = { enrichLeads };
