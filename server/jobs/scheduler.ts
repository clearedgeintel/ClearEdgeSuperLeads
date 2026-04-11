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

type JobFn = () => Promise<void>;

async function runJob(name: string, fn: JobFn): Promise<void> {
  const started = Date.now();
  try {
    await fn();
    console.log(`[jobs] ${name} ok`, { ms: Date.now() - started });
  } catch (err) {
    console.error(`[jobs] ${name} failed`, { ms: Date.now() - started, err });
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
    console.log('[jobs] scheduler disabled via DISABLE_SCHEDULER=1');
    return;
  }

  // Queue generation — build AI drafts for active enrollments every 15 min
  cron.schedule('*/15 * * * *', () => {
    void runJob('queueGeneration', async () => {
      const result = await queueGenerationService.generateBatch();
      console.log('[jobs] queueGeneration result', result);
    });
  });

  // Queue dispatch — send approved items every 5 min (workspace-global
  // dispatch; Phase 9 switches to per-workspace iteration when multi-
  // tenancy activates).
  cron.schedule('*/5 * * * *', () => {
    void runJob('queueDispatch', async () => {
      const result = await unipileDispatchService.dispatchApproved(null);
      console.log('[jobs] queueDispatch result', result);
    });
  });

  // Inbox sync — poll Unipile for new replies + acceptances every 10 min
  cron.schedule('*/10 * * * *', () => {
    void runJob('inboxSync', async () => {
      const result = await inboxSyncService.sync(null);
      console.log('[jobs] inboxSync result', result);
    });
  });

  started = true;
  console.log('[jobs] scheduler started (queueGeneration 15m, queueDispatch 5m, inboxSync 10m)');
}
