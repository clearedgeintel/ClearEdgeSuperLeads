// ClearEdge — Unipile Dispatch Endpoint
const { createClient } = require('@supabase/supabase-js');
const logger = require('../lib/logger');
const { withRetry } = require('../lib/retry');
const { isAllowed, record, humanDelay, remaining } = require('../lib/linkedin-limiter');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function getConfig(key) {
  const { data } = await supabase.from('app_config').select('value').eq('key', key).single();
  return data?.value;
}

function getBaseUrl() {
  const raw = process.env.UNIPILE_BASE_URL || 'https://api30.unipile.com:16074/api/v1/accounts';
  return raw.replace(/\/api\/v1\/accounts\/?$/, '');
}

async function unipileRequest(method, path, body) {
  return withRetry(
    async () => {
      const url = `${getBaseUrl()}${path}`;
      logger.debug({ method, url }, 'Unipile request');

      const res = await fetch(url, {
        method,
        headers: {
          'X-API-KEY': process.env.UNIPILE_API_KEY,
          'Content-Type': 'application/json',
          accept: 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!res.ok) {
        const text = await res.text();
        const err = new Error(`Unipile ${res.status}: ${text}`);
        err.status = res.status;
        throw err;
      }

      const data = await res.json();
      logger.debug({ method, url, status: res.status }, 'Unipile response OK');
      return data;
    },
    { label: `unipile:${method}:${path}` }
  );
}

async function logLinkedinAudit(supabase, { lead_id, action, details, status }) {
  await supabase.from('linkedin_audit_log').insert({
    lead_id,
    action,
    details,
    status,
  });
}

// POST /api/dispatch-approved
async function dispatchApproved(req, res) {
  try {
    const accountId = (await getConfig('unipile_account_id')) || process.env.UNIPILE_ACCOUNT_ID;

    // Fetch all approved queue items
    const { data: items, error } = await supabase
      .from('send_queue')
      .select(
        '*, leads(id, unipile_member_id, full_name, email), campaign_steps(step_type, campaign_id)'
      )
      .eq('status', 'approved');

    if (error) return res.status(500).json({ success: false, error: error.message });

    let sent = 0,
      failed = 0,
      rateLimited = 0;

    for (const item of items || []) {
      // Check LinkedIn dispatch rate limit
      if (!isAllowed('dispatch')) {
        logger.warn({ remaining: remaining('dispatch') }, 'LinkedIn dispatch hourly limit reached');
        rateLimited += (items || []).length - sent - failed - rateLimited;
        break;
      }

      const lead = item.leads;
      const stepType = item.campaign_steps?.step_type;
      const messageText = item.edited_draft || item.ai_draft;
      const memberId = lead?.unipile_member_id;
      let actualStepType = stepType;

      if (!memberId) {
        await supabase.from('send_queue').update({ status: 'failed' }).eq('id', item.id);
        failed++;
        continue;
      }

      try {
        let result;

        if (stepType === 'connection_request') {
          let alreadyConnected = false;
          try {
            const profile = await unipileRequest(
              'GET',
              `/api/v1/users/${memberId}?account_id=${encodeURIComponent(accountId)}`
            );
            if (profile?.network_distance === 'DISTANCE_1' || profile?.is_connection) {
              alreadyConnected = true;
            }
          } catch (_) {
            // If profile check fails, try the invite anyway
          }

          if (alreadyConnected) {
            actualStepType = 'message';
            result = await unipileRequest('POST', '/api/v1/chats', {
              account_id: accountId,
              attendees_ids: [memberId],
              text: messageText,
            });
            await supabase.from('leads').update({ status: 'connected' }).eq('id', lead.id);
          } else {
            result = await unipileRequest('POST', '/api/v1/users/invite', {
              account_id: accountId,
              provider: 'LINKEDIN',
              provider_id: memberId,
              message: messageText,
            });
          }
        } else if (stepType === 'inmail') {
          let subject = '',
            body = messageText;
          try {
            const parsed = JSON.parse(messageText);
            subject = parsed.subject || '';
            body = parsed.body || messageText;
          } catch (_) {
            /* use raw text as body */
          }

          result = await unipileRequest('POST', '/api/v1/chats', {
            account_id: accountId,
            attendees_ids: [memberId],
            text: subject ? `${subject}\n\n${body}` : body,
          });
        } else if (stepType === 'email') {
          // Email dispatch via Unipile
          const leadEmail = lead.email;
          if (!leadEmail) {
            await supabase.from('send_queue').update({ status: 'failed' }).eq('id', item.id);
            logger.warn({ lead_id: lead.id }, 'No email address for email step');
            failed++;
            continue;
          }

          if (!isAllowed('email')) {
            logger.warn({ remaining: remaining('email') }, 'Email hourly limit reached');
            rateLimited++;
            continue;
          }

          let subject = '',
            body = messageText;
          try {
            const parsed = JSON.parse(messageText);
            subject = parsed.subject || 'Following up';
            body = parsed.body || messageText;
          } catch (_) {
            /* use raw text as body */
          }

          result = await unipileRequest('POST', '/api/v1/emails', {
            account_id: accountId,
            to: [{ email: leadEmail, name: lead.full_name || '' }],
            subject: subject || 'Following up',
            body,
          });
          record('email');
        } else {
          // Regular LinkedIn message
          result = await unipileRequest('POST', '/api/v1/chats', {
            account_id: accountId,
            attendees_ids: [memberId],
            text: messageText,
          });
        }

        // Record the dispatch for rate limiting
        const channel = stepType === 'email' ? 'email' : 'linkedin';
        if (channel === 'linkedin') record('dispatch');

        // Log the send
        await supabase.from('send_log').insert({
          queue_item_id: item.id,
          lead_id: lead.id,
          campaign_id: item.campaign_steps?.campaign_id,
          message_text: messageText,
          step_type: actualStepType,
          channel,
          unipile_message_id: result?.invitation_id || result?.id || null,
          dispatch_status: 'success',
        });

        // Audit log
        await logLinkedinAudit(supabase, {
          lead_id: lead.id,
          action: actualStepType,
          details: { queue_item_id: item.id, unipile_id: result?.invitation_id || result?.id },
          status: 'success',
        });

        await supabase.from('send_queue').update({ status: 'sent' }).eq('id', item.id);

        if (actualStepType === 'connection_request') {
          await supabase.from('leads').update({ status: 'contacted' }).eq('id', lead.id);
        }

        // Advance enrollment step
        const { data: enrollment } = await supabase
          .from('campaign_enrollments')
          .select('current_step_order')
          .eq('id', item.enrollment_id)
          .single();

        if (enrollment) {
          await supabase
            .from('campaign_enrollments')
            .update({ current_step_order: enrollment.current_step_order + 1 })
            .eq('id', item.enrollment_id);
        }

        sent++;
        logger.info({ lead: lead.full_name, stepType: actualStepType }, 'Message dispatched');

        // Human-like delay between dispatches
        if (items.indexOf(item) < items.length - 1) {
          await humanDelay();
        }
      } catch (err) {
        logger.error({ lead_id: lead.id, error: err.message }, 'Dispatch failed for lead');

        await supabase.from('send_log').insert({
          queue_item_id: item.id,
          lead_id: lead.id,
          campaign_id: item.campaign_steps?.campaign_id,
          message_text: messageText,
          step_type: actualStepType || stepType,
          dispatch_status: 'failed',
        });

        await logLinkedinAudit(supabase, {
          lead_id: lead.id,
          action: actualStepType || stepType,
          details: { queue_item_id: item.id, error: err.message },
          status: 'failed',
        });

        await supabase.from('send_queue').update({ status: 'failed' }).eq('id', item.id);
        failed++;
      }
    }

    logger.info(
      { sent, failed, rateLimited, total: (items || []).length },
      'Dispatch batch complete'
    );
    res.json({
      success: true,
      data: { sent, failed, rate_limited: rateLimited, total: (items || []).length },
    });
  } catch (err) {
    logger.error({ error: err.message }, 'Dispatch endpoint error');
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = { dispatchApproved };
