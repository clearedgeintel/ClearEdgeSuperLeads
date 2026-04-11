// ClearEdge — API Usage Tracker
// Logs Claude and Unipile API calls for cost visibility.
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

/**
 * Log an API call for cost tracking.
 * @param {object} opts
 * @param {'claude'|'unipile'} opts.provider
 * @param {string} opts.endpoint
 * @param {string} [opts.model]
 * @param {number} [opts.inputTokens]
 * @param {number} [opts.outputTokens]
 * @param {string} [opts.campaignId]
 * @param {string} [opts.leadId]
 */
async function trackApiCall(opts) {
  try {
    await supabase.from('api_usage_log').insert({
      provider: opts.provider,
      endpoint: opts.endpoint,
      model: opts.model || null,
      input_tokens: opts.inputTokens || null,
      output_tokens: opts.outputTokens || null,
      campaign_id: opts.campaignId || null,
      lead_id: opts.leadId || null,
    });
  } catch (_) {
    // Don't fail the request if tracking fails
  }
}

module.exports = { trackApiCall };
