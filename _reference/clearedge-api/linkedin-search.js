// ClearEdge — LinkedIn Search via Unipile
const { createClient } = require('@supabase/supabase-js');
const logger = require('../lib/logger');
const { withRetry } = require('../lib/retry');
const { isAllowed, record, remaining } = require('../lib/linkedin-limiter');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

function getBaseUrl() {
  const raw = process.env.UNIPILE_BASE_URL || 'https://api30.unipile.com:16074/api/v1/accounts';
  return raw.replace(/\/api\/v1\/accounts\/?$/, '');
}

// POST /api/linkedin-search
async function linkedinSearch(req, res) {
  try {
    // Check LinkedIn search rate limit
    if (!isAllowed('search')) {
      logger.warn({ remaining: remaining('search') }, 'LinkedIn search hourly limit reached');
      return res.status(429).json({
        success: false,
        error: 'LinkedIn search hourly limit reached. Try again later.',
        remaining: remaining('search'),
      });
    }

    const { query, title, company, industry, location, cursor } = req.body;

    // Read account ID from DB first (admin-configurable), fall back to env
    const { data: configRow } = await supabase
      .from('app_config')
      .select('value')
      .eq('key', 'unipile_account_id')
      .single();
    const accountId =
      configRow?.value && configRow.value !== 'YOUR_LINKEDIN_ACCOUNT_ID'
        ? configRow.value
        : process.env.UNIPILE_ACCOUNT_ID;

    // Validation handled by Zod middleware in routes/api.js

    const keywords = [query, title, company, industry, location].filter(Boolean).join(' ');

    const searchUrl = `${getBaseUrl()}/api/v1/linkedin/search?account_id=${encodeURIComponent(accountId)}`;

    // Build request body — include cursor for pagination
    const searchBody = {
      api: 'classic',
      category: 'people',
      keywords,
      limit: 100,
    };
    if (cursor) searchBody.cursor = cursor;

    const result = await withRetry(
      async () => {
        logger.debug({ keywords, cursor: cursor || 'none' }, 'LinkedIn search request');

        const response = await fetch(searchUrl, {
          method: 'POST',
          headers: {
            'X-API-KEY': process.env.UNIPILE_API_KEY,
            'Content-Type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify(searchBody),
        });

        if (!response.ok) {
          const text = await response.text();
          const err = new Error(`Unipile ${response.status}: ${text}`);
          err.status = response.status;
          throw err;
        }

        return response.json();
      },
      { label: 'unipile:linkedin-search' }
    );

    // Record search for rate limiting
    record('search');

    // Map Unipile response to normalized profiles
    const profiles = (result.items || []).map((p) => {
      let degree = null;
      if (p.network_distance === 'DISTANCE_1') degree = 1;
      else if (p.network_distance === 'DISTANCE_2') degree = 2;
      else if (p.network_distance === 'DISTANCE_3') degree = 3;

      let linkedinUrl = p.public_profile_url || p.profile_url || null;
      if (!linkedinUrl && p.public_identifier) {
        linkedinUrl = `https://www.linkedin.com/in/${p.public_identifier}`;
      }

      return {
        linkedin_url: linkedinUrl,
        full_name: p.name || null,
        headline: p.headline || null,
        location: p.location || null,
        industry: p.industry || null,
        connection_degree: degree,
        member_id: p.id || null,
        profile_picture: p.profile_picture_url || null,
        public_identifier: p.public_identifier || null,
      };
    });

    const paging = result.paging || {};

    logger.info({ keywords, results: profiles.length }, 'LinkedIn search complete');

    res.json({
      success: true,
      data: profiles,
      total: paging.total_count || profiles.length,
      cursor: result.cursor || null,
    });
  } catch (err) {
    logger.error({ error: err.message }, 'LinkedIn search error');
    res.status(500).json({ success: false, error: err.message });
  }
}

// POST /api/linkedin-search/save — save selected profiles as leads
async function saveSearchResults(req, res) {
  try {
    const { profiles } = req.body;
    // Validation handled by Zod middleware in routes/api.js

    let saved = 0,
      skipped = 0,
      errors = 0;

    for (const p of profiles) {
      if (!p.linkedin_url) {
        errors++;
        continue;
      }

      const record = {
        linkedin_url: p.linkedin_url,
        full_name: p.full_name || null,
        title: p.headline || null,
        company: null,
        industry: p.industry || null,
        headline: p.headline || null,
        connection_degree: p.connection_degree ? parseInt(p.connection_degree) : null,
        unipile_member_id: p.member_id || null,
        status: 'new',
        score: 0,
      };

      const { error } = await supabase
        .from('leads')
        .upsert(record, { onConflict: 'linkedin_url', ignoreDuplicates: false });

      if (error) {
        if (error.code === '23505') skipped++;
        else errors++;
      } else {
        saved++;
      }
    }

    logger.info({ saved, skipped, errors }, 'Search results saved');
    res.json({ success: true, data: { saved, skipped, errors } });
  } catch (err) {
    logger.error({ error: err.message }, 'Save search results error');
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = { linkedinSearch, saveSearchResults };
