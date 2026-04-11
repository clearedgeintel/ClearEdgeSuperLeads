// ClearEdge — CSV Export Endpoint
const { createClient } = require('@supabase/supabase-js');
const logger = require('../lib/logger');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const CSV_COLUMNS = [
  'full_name',
  'title',
  'company',
  'industry',
  'company_size',
  'headline',
  'linkedin_url',
  'status',
  'score',
  'connection_degree',
  'enrichment_status',
  'created_at',
  'updated_at',
];

function escapeCSV(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// GET /api/export/leads
async function exportLeads(req, res) {
  try {
    const { status, min_score, enrichment_status } = req.query;

    let query = supabase
      .from('leads')
      .select('*')
      .is('deleted_at', null)
      .order('score', { ascending: false });

    if (status) query = query.eq('status', status);
    if (min_score) query = query.gte('score', parseInt(min_score));
    if (enrichment_status) query = query.eq('enrichment_status', enrichment_status);

    const { data: leads, error } = await query.limit(5000);
    if (error) return res.status(500).json({ success: false, error: error.message });

    // Build CSV
    const header = CSV_COLUMNS.join(',');
    const rows = (leads || []).map((lead) =>
      CSV_COLUMNS.map((col) => escapeCSV(lead[col])).join(',')
    );
    const csv = [header, ...rows].join('\n');

    logger.info({ count: (leads || []).length, status, min_score }, 'CSV export');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="clearedge-leads-${new Date().toISOString().split('T')[0]}.csv"`
    );
    res.send(csv);
  } catch (err) {
    logger.error({ error: err.message }, 'Export error');
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = { exportLeads };
