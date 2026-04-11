// Hunter.io email verification. Called before committing an email
// address to a send — maps Hunter's `status` field onto our three-
// value `email_verified` column:
//
//   deliverable   → safe to send
//   risky         → send at your own risk (catch-all / webmail / greylisted)
//   undeliverable → blocked by EmailService
//
// Graceful degradation: when HUNTER_API_KEY isn't set we return
// 'skipped' so the caller can decide whether to block or proceed.
// This keeps the Phase 8 port functional for workspaces without a
// Hunter subscription.

import { withRetry } from '../lib/retry';
import { trackApiCall } from '../lib/apiTracker';

export type EmailVerificationStatus =
  | 'deliverable'
  | 'risky'
  | 'undeliverable'
  | 'skipped'
  | 'error';

export interface EmailVerificationResult {
  status: EmailVerificationStatus;
  score?: number;
  reason?: string;
  raw?: unknown;
}

interface HunterResponse {
  data?: {
    status?: string;
    result?: string;
    score?: number;
    disposable?: boolean;
    webmail?: boolean;
    accept_all?: boolean;
  };
}

export async function verifyEmailWithHunter(
  email: string,
  workspaceId?: string | null
): Promise<EmailVerificationResult> {
  const apiKey = process.env.HUNTER_API_KEY;
  if (!apiKey) {
    return { status: 'skipped', reason: 'HUNTER_API_KEY not set' };
  }

  try {
    const url = `https://api.hunter.io/v2/email-verifier?email=${encodeURIComponent(
      email
    )}&api_key=${encodeURIComponent(apiKey)}`;

    const body = await withRetry<HunterResponse>(
      async () => {
        const res = await fetch(url);
        if (!res.ok) {
          const text = await res.text();
          const err: Error & { status?: number } = new Error(
            `Hunter ${res.status}: ${text}`
          );
          err.status = res.status;
          throw err;
        }
        return (await res.json()) as HunterResponse;
      },
      { label: 'hunter:verify', maxRetries: 2 }
    );

    await trackApiCall({
      provider: 'unipile', // Reusing provider enum; Phase 10 enrichment adds 'hunter'
      endpoint: 'email-verifier',
      workspaceId: workspaceId ?? undefined,
    });

    // Hunter's `status` is one of: valid | invalid | accept_all | webmail |
    // disposable | unknown. Map those onto our three-way outcome.
    const raw = body.data?.status ?? body.data?.result ?? 'unknown';
    let status: EmailVerificationStatus = 'risky';
    if (raw === 'valid') status = 'deliverable';
    else if (raw === 'invalid' || raw === 'disposable') status = 'undeliverable';
    else status = 'risky'; // accept_all, webmail, unknown all count as risky

    return {
      status,
      score: body.data?.score,
      reason: raw,
      raw: body.data,
    };
  } catch (err) {
    console.error('[emailVerification] hunter call failed', err);
    return { status: 'error', reason: err instanceof Error ? err.message : String(err) };
  }
}
