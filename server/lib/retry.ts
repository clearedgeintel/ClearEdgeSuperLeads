// Retry with exponential backoff + jitter. Ported from ClearEdge Leads
// lib/retry.js. Phase 6 swapped the Phase 3 console.warn placeholder
// for the pino logger so retries show up in structured log output.

import { logger } from './logger';

const DEFAULTS = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  retryableStatuses: new Set([408, 429, 500, 502, 503, 504]),
};

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  label?: string;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const maxRetries = opts.maxRetries ?? DEFAULTS.maxRetries;
  const baseDelayMs = opts.baseDelayMs ?? DEFAULTS.baseDelayMs;
  const maxDelayMs = opts.maxDelayMs ?? DEFAULTS.maxDelayMs;
  const label = opts.label;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      const isLast = attempt === maxRetries;
      const e = err as { status?: number; statusCode?: number; message?: string };
      const status = e.status ?? e.statusCode;
      const message = e.message ?? '';
      const isRetryable =
        !status ||
        (status !== undefined && DEFAULTS.retryableStatuses.has(status)) ||
        /ECONNRESET|ETIMEDOUT|ENOTFOUND|fetch failed/i.test(message);

      if (isLast || !isRetryable) throw err;

      const delay = Math.min(baseDelayMs * Math.pow(2, attempt) + Math.random() * 500, maxDelayMs);
      logger.warn(
        {
          attempt: attempt + 1,
          maxRetries,
          delayMs: Math.round(delay),
          label,
          error: message,
        },
        'retrying after error'
      );
      await sleep(delay);
    }
  }

  // Unreachable — the loop either returns or throws.
  throw new Error('withRetry: exhausted retries without success');
}
