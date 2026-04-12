// In-process scheduler using node-cron. Imported once from server/index.ts
// on boot. Each job wraps its work in try/catch so a thrown error in one
// cron tick doesn't cascade into the next. Per-job health (last_ok /
// last_error) will be tracked in app_config starting Phase 11 — for now
// we just log.
//
// Phase 9 adds usageResetJob, Phase 10 adds reEnrichmentJob, Phase 11
// adds dailyDigestJob. This file is the single wiring point for all of
// them.

import cron from 'node-cron';
import { queueGenerationService } from '../services/queueGenerationService';
import { unipileDispatchService } from '../services/unipileDispatchService';
import { inboxSyncService } from '../services/inboxSyncService';
import { enrichmentService } from '../services/enrichmentService';
import { analyticsService } from '../services/analyticsService';
import { storage } from '../storage';
import { logger } from '../lib/logger';
import { notifyJobFailure, recordJobSuccess } from './alerting';
import { leads } from '@shared/schema';
import { and, lte, or, eq, isNull } from 'drizzle-orm';
import { db } from '../db';

type JobFn = () => Promise<void>;

async function runJob(name: string, fn: JobFn): Promise<void> {
  const started = Date.now();
  try {
    await fn();
    logger.info({ job: name, ms: Date.now() - started }, 'job ok');
    await recordJobSuccess(name);
  } catch (err) {
    logger.error({ job: name, ms: Date.now() - started, err }, 'job failed');
    await notifyJobFailure(name, err);
  }
}

let started = false;

/**
 * Start all in-process cron jobs. Idempotent — safe to call multiple
 * times (subsequent calls are no-ops). Disabled in the test environment
 * so Jest runs don't fire jobs.
 */
export function startScheduler(): void {
  if (started) return;
  if (process.env.NODE_ENV === 'test') return;
  if (process.env.DISABLE_SCHEDULER === '1') {
    logger.info('scheduler disabled via DISABLE_SCHEDULER=1');
    return;
  }

  // Queue generation — build AI drafts for active enrollments every 15 min
  cron.schedule('*/15 * * * *', () => {
    void runJob('queueGeneration', async () => {
      const result = await queueGenerationService.generateBatch();
      logger.info({ result }, 'queueGeneration batch');
    });
  });

  // Queue dispatch — send approved items every 5 min (workspace-global
  // dispatch; Phase 9 switches to per-workspace iteration when multi-
  // tenancy activates).
  cron.schedule('*/5 * * * *', () => {
    void runJob('queueDispatch', async () => {
      const result = await unipileDispatchService.dispatchApproved(null);
      logger.info({ result }, 'queueDispatch batch');
    });
  });

  // Inbox sync — poll Unipile for new replies + acceptances every 10 min
  cron.schedule('*/10 * * * *', () => {
    void runJob('inboxSync', async () => {
      const result = await inboxSyncService.sync(null);
      logger.info({ result }, 'inboxSync batch');
    });
  });

  // Phase 9 — monthly usage counter reset. Fires at 00:05 UTC on the
  // 1st of every month so we don't race the Stripe invoice rollover.
  // Resets monthly_email_sends_used + monthly_linkedin_sends_used to
  // zero for every workspace.
  cron.schedule('5 0 1 * *', () => {
    void runJob('usageReset', async () => {
      const resetCount = await storage.resetAllWorkspaceCounters();
      logger.info({ workspacesReset: resetCount }, 'monthly usage reset complete');
    });
  });

  // Phase 10 — daily re-enrichment sweep at 3am UTC. Finds leads where
  // re_enrich_after has expired and status is not 'converted'. Batched
  // at 50 leads per tick to avoid burning through API quotas.
  cron.schedule('0 3 * * *', () => {
    void runJob('reEnrichment', async () => {
      const now = new Date();
      const staleLeads = await db
        .select()
        .from(leads)
        .where(
          and(
            lte(leads.reEnrichAfter, now),
            or(
              eq(leads.status, 'new'),
              eq(leads.status, 'contacted'),
              eq(leads.status, 'connected'),
              eq(leads.status, 'replied'),
              isNull(leads.status)
            )!
          )
        )
        .limit(50);

      let enriched = 0;
      for (const lead of staleLeads) {
        try {
          await enrichmentService.enrichLead(lead.id, lead.workspaceId);
          enriched++;
        } catch (err) {
          logger.warn({ leadId: lead.id, err }, 'reEnrichment failed for lead');
        }
      }
      logger.info({ found: staleLeads.length, enriched }, 'reEnrichment sweep');
    });
  });

  // Phase 11 — daily digest at 8am UTC. Queries last 24h activity and
  // posts a summary to the workspace's Slack webhook (if configured).
  // Falls back to logging if no webhook is set.
  cron.schedule('0 8 * * *', () => {
    void runJob('dailyDigest', async () => {
      const slackUrl = await storage.getAppConfig('slack_webhook_url');
      const overview = await analyticsService.getOverview(1); // last 1 day
      const queueStats = await storage.getQueueStats();

      const lines = [
        `:chart_with_upwards_trend: *ClearEdge Daily Digest*`,
        `*Last 24h:*`,
        `• Messages sent: ${overview.messagesSentPeriod}`,
        `• Connections accepted: ${overview.connectionsAccepted}`,
        `• Replies: ${overview.repliesReceived} (${overview.replyRate}% rate)`,
        `• Positive replies: ${overview.positiveReplies}`,
        `• Meetings booked: ${overview.meetingsBooked}`,
        `*Queue:*`,
        `• Pending: ${queueStats.pending ?? 0}`,
        `• Approved: ${queueStats.approved ?? 0}`,
        `• Sent: ${queueStats.sent ?? 0}`,
      ];
      const text = lines.join('\n');

      if (slackUrl) {
        try {
          await fetch(slackUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
          });
          logger.info('daily digest posted to Slack');
        } catch (err) {
          logger.warn({ err }, 'daily digest Slack post failed');
        }
      } else {
        logger.info({ text }, 'daily digest (no Slack webhook configured)');
      }
    });
  });

  started = true;
  logger.info(
    'scheduler started (queueGen 15m, dispatch 5m, inbox 10m, usageReset 1st, reEnrich 3am, digest 8am)'
  );
}
