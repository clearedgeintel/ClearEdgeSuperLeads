// Retry with exponential backoff + jitter. Ported from ClearEdge Leads
// lib/retry.js; logger.warn call swapped for console.warn since the GBP
// base doesn't use pino yet — Phase 6's structured-logger pass replaces it.

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
      console.warn('[retry]', {
        attempt: attempt + 1,
        maxRetries,
        delay: Math.round(delay),
        label,
        error: message,
      });
      await sleep(delay);
    }
  }

  // Unreachable — the loop either returns or throws.
  throw new Error('withRetry: exhausted retries without success');
}
