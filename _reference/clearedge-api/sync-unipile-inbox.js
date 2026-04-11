// ClearEdge — Unipile Inbox Sync Endpoint
const { createClient } = require('@supabase/supabase-js');
const logger = require('../lib/logger');
const { withRetry } = require('../lib/retry');
const { classifyReply } = require('../lib/reply-classifier');
const { recordReplyForVersion } = require('../lib/prompt-engine');
const { storeConversation } = require('../lib/rag-engine');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

function getBaseUrl() {
  const raw = process.env.UNIPILE_BASE_URL || 'https://api30.unipile.com:16074/api/v1/accounts';
  return raw.replace(/\/api\/v1\/accounts\/?$/, '');
}

async function unipileGet(path) {
  return withRetry(
    async () => {
      const url = `${getBaseUrl()}${path}`;
      logger.debug({ url }, 'Unipile GET');

      const res = await fetch(url, {
        headers: { 'X-API-KEY': process.env.UNIPILE_API_KEY, accept: 'application/json' },
      });

      if (!res.ok) {
        const text = await res.text();
        const err = new Error(`Unipile ${res.status}: ${text}`);
        err.status = res.status;
        throw err;
      }

      return res.json();
    },
    { label: `unipile:GET:${path}` }
  );
}

// POST /api/sync-unipile-inbox
async function syncUnipileInbox(req, res) {
  try {
    let replies = 0;
    let connectionsAccepted = 0;
    const classifications = { positive: 0, negative: 0, neutral: 0, out_of_office: 0 };

    // 1. Check for new messages / replies
    let chatItems = [];
    try {
      const chats = await unipileGet('/api/v1/chats');
      chatItems = Array.isArray(chats?.items) ? chats.items : Array.isArray(chats) ? chats : [];
    } catch (err) {
      logger.warn({ error: err.message }, 'Chat fetch failed, skipping replies check');
    }

    const { data: leads } = await supabase
      .from('leads')
      .select('id, unipile_member_id, status')
      .not('unipile_member_id', 'is', null);

    const leadMap = {};
    (leads || []).forEach((l) => {
      leadMap[l.unipile_member_id] = l;
    });

    for (const chat of chatItems) {
      const senderId = chat.sender_id || chat.attendees?.[0]?.id;
      if (!senderId || !leadMap[senderId]) continue;

      const lead = leadMap[senderId];

      const { data: existing } = await supabase
        .from('engagement_events')
        .select('id')
        .eq('lead_id', lead.id)
        .eq('event_type', 'reply_received')
        .limit(1);

      if (!existing || existing.length === 0) {
        const messageText = chat.last_message || chat.text || '';

        // Classify reply sentiment
        const sentiment = await classifyReply(messageText);
        if (classifications[sentiment] !== undefined) {
          classifications[sentiment]++;
        }

        await supabase.from('engagement_events').insert({
          lead_id: lead.id,
          event_type: 'reply_received',
          event_data: { message: messageText, chat_id: chat.id },
          sentiment,
        });

        // Update lead status based on sentiment
        if (lead.status !== 'meeting_booked') {
          await supabase.from('leads').update({ status: 'replied' }).eq('id', lead.id);
        }

        // Pause enrollment on reply
        const { data: enrollment } = await supabase
          .from('campaign_enrollments')
          .select('id')
          .eq('lead_id', lead.id)
          .eq('status', 'active')
          .limit(1)
          .single();

        if (enrollment) {
          await supabase
            .from('campaign_enrollments')
            .update({ status: 'paused' })
            .eq('id', enrollment.id);
        }

        // Track reply against the prompt version that generated the message
        const { data: lastQueueItem } = await supabase
          .from('send_queue')
          .select('id')
          .eq('lead_id', lead.id)
          .eq('status', 'sent')
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (lastQueueItem) {
          await recordReplyForVersion(supabase, lastQueueItem.id, sentiment === 'positive');

          // Store in knowledge base for RAG
          const { data: queueData } = await supabase
            .from('send_queue')
            .select('ai_draft, campaign_step_id, campaign_steps(campaign_id)')
            .eq('id', lastQueueItem.id)
            .single();

          if (queueData?.ai_draft) {
            await storeConversation(supabase, {
              leadId: lead.id,
              campaignId: queueData.campaign_steps?.campaign_id,
              outboundMessage: queueData.ai_draft,
              replyMessage: messageText,
              sentiment,
              industry: lead.industry || null,
              titlePattern: lead.title || null,
            });
          }
        }

        replies++;
        logger.info({ lead_id: lead.id, sentiment }, 'New reply detected and classified');
      }
    }

    // 2. Check for accepted connections
    let inviteItems = [];
    try {
      const invitations = await unipileGet('/api/v1/linkedin/invitations?status=accepted');
      inviteItems = Array.isArray(invitations?.items)
        ? invitations.items
        : Array.isArray(invitations)
          ? invitations
          : [];
    } catch (err) {
      logger.warn({ error: err.message }, 'Invitation check unavailable, skipping');
    }

    for (const invite of inviteItems) {
      const memberId = invite.linkedin_member_id || invite.recipient_id;
      if (!memberId || !leadMap[memberId]) continue;

      const lead = leadMap[memberId];

      const { data: existing } = await supabase
        .from('engagement_events')
        .select('id')
        .eq('lead_id', lead.id)
        .eq('event_type', 'connection_accepted')
        .limit(1);

      if (!existing || existing.length === 0) {
        await supabase.from('engagement_events').insert({
          lead_id: lead.id,
          event_type: 'connection_accepted',
          event_data: { invitation_id: invite.id },
        });

        if (['new', 'contacted'].includes(lead.status)) {
          await supabase.from('leads').update({ status: 'connected' }).eq('id', lead.id);
        }

        connectionsAccepted++;
        logger.info({ lead_id: lead.id }, 'Connection accepted');
      }
    }

    logger.info({ replies, connectionsAccepted, classifications }, 'Inbox sync complete');
    res.json({
      success: true,
      data: { replies, connections_accepted: connectionsAccepted, classifications },
    });
  } catch (err) {
    logger.error({ error: err.message }, 'Sync inbox error');
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = { syncUnipileInbox };
