// ClearEdge — Settings & Configuration Endpoints
const { createClient } = require('@supabase/supabase-js');
const logger = require('../lib/logger');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// GET /api/settings
async function getSettings(req, res) {
  try {
    const { data } = await supabase.from('app_config').select('key, value');
    const settings = {};
    (data || []).forEach((r) => {
      settings[r.key] = r.value;
    });

    res.json({ success: true, data: settings });
  } catch (err) {
    logger.error({ error: err.message }, 'Get settings error');
    res.status(500).json({ success: false, error: err.message });
  }
}

// PUT /api/settings
// Body: { key: string, value: string }
async function updateSetting(req, res) {
  try {
    const { key, value } = req.body;

    const { error } = await supabase
      .from('app_config')
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });

    if (error) return res.status(500).json({ success: false, error: error.message });

    logger.info({ key }, 'Setting updated');
    res.json({ success: true });
  } catch (err) {
    logger.error({ error: err.message }, 'Update setting error');
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = { getSettings, updateSetting };
