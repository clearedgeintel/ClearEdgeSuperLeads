// Shared alerting helper for all cron jobs. On failure, logs a
// structured error and posts to the workspace's Slack webhook (if
// configured in app_config). Called from the scheduler's runJob
// try/catch blocks. Also tracks last_ok / last_error timestamps
// in app_config for the Settings → Automation health panel.

import { storage } from '../storage';
import { logger } from '../lib/logger';

export async function notifyJobFailure(
  jobName: string,
  err: unknown,
  workspaceId?: string | null
): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  logger.error({ job: jobName, err: message }, 'job failure alert');

  // Record last_error in app_config for the Settings health panel.
  try {
    await storage.setAppConfig(
      `job:${jobName}:last_error`,
      JSON.stringify({ message, at: new Date().toISOString() }),
      workspaceId
    );
  } catch {
    // Best-effort — don't let config write failure mask the original error.
  }

  // Post to Slack if the workspace has a webhook configured.
  try {
    const slackUrl = await storage.getAppConfig('slack_webhook_url', workspaceId);
    if (!slackUrl) return;

    await fetch(slackUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `:warning: ClearEdge job failure: *${jobName}*\n\`\`\`${message}\`\`\``,
      }),
    });
  } catch (slackErr) {
    logger.warn({ err: slackErr }, 'Slack notification failed');
  }
}

export async function recordJobSuccess(
  jobName: string,
  workspaceId?: string | null
): Promise<void> {
  try {
    await storage.setAppConfig(
      `job:${jobName}:last_ok`,
      new Date().toISOString(),
      workspaceId
    );
  } catch {
    // Best-effort.
  }
}
