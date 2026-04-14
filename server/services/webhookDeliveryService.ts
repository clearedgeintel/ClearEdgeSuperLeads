// Outbound webhook delivery — signs each payload with the endpoint's
// per-endpoint secret (HMAC-SHA256), retries 3x with exponential
// backoff, and logs delivery to audit_log. Ported from the Phase 12
// roadmap spec.
//
// Supported events (emitted by services/routes after state changes):
//   lead.reply_received, lead.connection_accepted, lead.status_changed,
//   campaign.completed, email.bounced, meeting.booked
//
// Keeping delivery fire-and-forget in the caller (not awaited in-line)
// means a slow subscriber endpoint doesn't block user-facing requests.

import crypto from 'crypto';
import { storage } from '../storage';
import { withRetry } from '../lib/retry';
import { logger } from '../lib/logger';

export type WebhookEventType =
  | 'lead.reply_received'
  | 'lead.connection_accepted'
  | 'lead.status_changed'
  | 'campaign.completed'
  | 'email.bounced'
  | 'meeting.booked';

function sign(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Deliver an event to every active endpoint subscribed to it. Fire-
 * and-forget — returns void, swallows per-endpoint failures after
 * logging. The caller decides whether to await.
 */
export async function deliverWebhookEvent(
  workspaceId: string,
  eventType: WebhookEventType,
  data: Record<string, unknown>
): Promise<void> {
  const endpoints = await storage.getActiveWebhookEndpointsForEvent(workspaceId, eventType);
  if (endpoints.length === 0) return;

  const payload = JSON.stringify({
    event: eventType,
    workspaceId,
    timestamp: new Date().toISOString(),
    data,
  });

  for (const endpoint of endpoints) {
    const signature = sign(payload, endpoint.secret);
    try {
      await withRetry(
        async () => {
          const res = await fetch(endpoint.url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-ClearEdge-Event': eventType,
              'X-ClearEdge-Signature': signature,
            },
            body: payload,
            signal: AbortSignal.timeout(10_000),
          });
          if (!res.ok) {
            const err: Error & { status?: number } = new Error(`Webhook ${res.status}`);
            err.status = res.status;
            throw err;
          }
        },
        { label: `webhook:${eventType}:${endpoint.id}`, maxRetries: 3 }
      );

      await storage.createAuditEntry({
        workspaceId,
        userId: null,
        action: 'webhook_delivered',
        entityType: 'webhook_endpoint',
        entityId: endpoint.id,
        metadata: { eventType, url: endpoint.url },
      });
    } catch (err) {
      logger.warn(
        { endpointId: endpoint.id, url: endpoint.url, eventType, err },
        'webhook delivery failed'
      );
      await storage.createAuditEntry({
        workspaceId,
        userId: null,
        action: 'webhook_failed',
        entityType: 'webhook_endpoint',
        entityId: endpoint.id,
        metadata: {
          eventType,
          url: endpoint.url,
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }
}

/**
 * Send a one-off test payload to a specific endpoint. Used by the
 * "Test webhook" button in Settings.
 */
export async function sendTestWebhook(endpointId: string): Promise<{
  ok: boolean;
  status?: number;
  error?: string;
}> {
  const endpoint = await storage.getWebhookEndpoint(endpointId);
  if (!endpoint) return { ok: false, error: 'Endpoint not found' };

  const payload = JSON.stringify({
    event: 'test.ping',
    timestamp: new Date().toISOString(),
    data: { message: 'ClearEdge test webhook' },
  });
  const signature = sign(payload, endpoint.secret);

  try {
    const res = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ClearEdge-Event': 'test.ping',
        'X-ClearEdge-Signature': signature,
      },
      body: payload,
      signal: AbortSignal.timeout(10_000),
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
