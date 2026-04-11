// ClearEdge — HubSpot Integration
const { createClient } = require('@supabase/supabase-js');
const logger = require('../lib/logger');
const { withRetry } = require('../lib/retry');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const HUBSPOT_API = 'https://api.hubapi.com';

function getHubSpotHeaders() {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) throw new Error('HUBSPOT_ACCESS_TOKEN not configured');
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

// Map ClearEdge status to HubSpot lifecycle stage
const STATUS_MAP = {
  new: 'subscriber',
  contacted: 'lead',
  connected: 'lead',
  replied: 'marketingqualifiedlead',
  meeting_booked: 'salesqualifiedlead',
  disqualified: 'other',
};

// POST /api/hubspot/sync-leads
// Body: { lead_ids: string[] } or { all_unsynced: true }
async function syncLeadsToHubSpot(req, res) {
  try {
    const { lead_ids, all_unsynced } = req.body;

    let query = supabase.from('leads').select('*').is('deleted_at', null);
    if (all_unsynced) {
      query = query.is('hubspot_contact_id', null).limit(100);
    } else if (lead_ids?.length > 0) {
      query = query.in('id', lead_ids);
    } else {
      return res.status(400).json({ success: false, error: 'Provide lead_ids or all_unsynced' });
    }

    const { data: leads, error } = await query;
    if (error) return res.status(500).json({ success: false, error: error.message });

    let synced = 0,
      updated = 0,
      failed = 0;

    for (const lead of leads || []) {
      try {
        const properties = {
          firstname: (lead.full_name || '').split(' ')[0] || '',
          lastname: (lead.full_name || '').split(' ').slice(1).join(' ') || '',
          jobtitle: lead.title || '',
          company: lead.company || '',
          industry: lead.industry || '',
          linkedin_url: lead.linkedin_url || '',
          lifecyclestage: STATUS_MAP[lead.status] || 'subscriber',
        };
        if (lead.email) properties.email = lead.email;

        if (lead.hubspot_contact_id) {
          // Update existing contact
          await withRetry(
            async () => {
              const resp = await fetch(
                `${HUBSPOT_API}/crm/v3/objects/contacts/${lead.hubspot_contact_id}`,
                {
                  method: 'PATCH',
                  headers: getHubSpotHeaders(),
                  body: JSON.stringify({ properties }),
                }
              );
              if (!resp.ok) {
                const text = await resp.text();
                const err = new Error(`HubSpot ${resp.status}: ${text}`);
                err.status = resp.status;
                throw err;
              }
              return resp.json();
            },
            { label: `hubspot:update:${lead.id}`, maxRetries: 2 }
          );
          updated++;
        } else {
          // Create new contact
          const contact = await withRetry(
            async () => {
              const resp = await fetch(`${HUBSPOT_API}/crm/v3/objects/contacts`, {
                method: 'POST',
                headers: getHubSpotHeaders(),
                body: JSON.stringify({ properties }),
              });
              if (!resp.ok) {
                const text = await resp.text();
                // If conflict (already exists), search by email
                if (resp.status === 409 && lead.email) {
                  const searchResp = await fetch(`${HUBSPOT_API}/crm/v3/objects/contacts/search`, {
                    method: 'POST',
                    headers: getHubSpotHeaders(),
                    body: JSON.stringify({
                      filterGroups: [
                        {
                          filters: [{ propertyName: 'email', operator: 'EQ', value: lead.email }],
                        },
                      ],
                    }),
                  });
                  const searchResult = await searchResp.json();
                  if (searchResult.results?.[0]) return searchResult.results[0];
                }
                const err = new Error(`HubSpot ${resp.status}: ${text}`);
                err.status = resp.status;
                throw err;
              }
              return resp.json();
            },
            { label: `hubspot:create:${lead.id}`, maxRetries: 2 }
          );

          await supabase
            .from('leads')
            .update({
              hubspot_contact_id: contact.id,
              hubspot_synced_at: new Date().toISOString(),
            })
            .eq('id', lead.id);
          synced++;
        }

        await supabase
          .from('leads')
          .update({ hubspot_synced_at: new Date().toISOString() })
          .eq('id', lead.id);

        logger.info({ lead_id: lead.id, lead: lead.full_name }, 'Synced to HubSpot');
      } catch (err) {
        logger.error({ lead_id: lead.id, error: err.message }, 'HubSpot sync failed');
        failed++;
      }
    }

    logger.info({ synced, updated, failed }, 'HubSpot sync complete');
    res.json({ success: true, data: { synced, updated, failed, total: (leads || []).length } });
  } catch (err) {
    logger.error({ error: err.message }, 'HubSpot sync error');
    res.status(500).json({ success: false, error: err.message });
  }
}

// POST /api/hubspot/webhook
// Receives events from HubSpot (contact property changes, deal stage changes)
async function hubspotWebhook(req, res) {
  try {
    const events = Array.isArray(req.body) ? req.body : [req.body];

    for (const event of events) {
      await supabase.from('webhook_log').insert({
        source: 'hubspot',
        event_type: event.subscriptionType || event.eventType || 'unknown',
        payload: event,
      });
    }

    logger.info({ count: events.length }, 'HubSpot webhook received');
    res.status(200).json({ success: true });
  } catch (err) {
    logger.error({ error: err.message }, 'HubSpot webhook error');
    res.status(500).json({ success: false, error: err.message });
  }
}

// GET /api/hubspot/status
async function hubspotStatus(req, res) {
  try {
    const hasToken = !!process.env.HUBSPOT_ACCESS_TOKEN;

    const { count: totalLeads } = await supabase
      .from('leads')
      .select('id', { count: 'exact', head: true });
    const { count: syncedLeads } = await supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .not('hubspot_contact_id', 'is', null);
    const { count: unsyncedLeads } = await supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .is('hubspot_contact_id', null)
      .is('deleted_at', null);

    res.json({
      success: true,
      data: {
        configured: hasToken,
        total_leads: totalLeads || 0,
        synced: syncedLeads || 0,
        unsynced: unsyncedLeads || 0,
      },
    });
  } catch (err) {
    logger.error({ error: err.message }, 'HubSpot status error');
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = { syncLeadsToHubSpot, hubspotWebhook, hubspotStatus };
