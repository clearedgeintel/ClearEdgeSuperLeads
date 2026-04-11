// ClearEdge — Retry with Exponential Backoff
const logger = require('./logger');

const DEFAULTS = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  retryableStatuses: [408, 429, 500, 502, 503, 504],
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry an async function with exponential backoff + jitter.
 * @param {Function} fn - Async function to retry. Receives attempt number (0-based).
 * @param {object} opts - { maxRetries, baseDelayMs, maxDelayMs, label }
 */
async function withRetry(fn, opts = {}) {
  const { maxRetries, baseDelayMs, maxDelayMs, label } = { ...DEFAULTS, ...opts };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      const isLast = attempt === maxRetries;

      // Check if error is retryable
      const status = err.status || err.statusCode;
      const isRetryable =
        !status ||
        DEFAULTS.retryableStatuses.includes(status) ||
        /ECONNRESET|ETIMEDOUT|ENOTFOUND|fetch failed/i.test(err.message);

      if (isLast || !isRetryable) {
        throw err;
      }

      // Exponential backoff with jitter
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt) + Math.random() * 500, maxDelayMs);

      logger.warn(
        { attempt: attempt + 1, maxRetries, delay: Math.round(delay), label, error: err.message },
        `Retrying after error`
      );

      await sleep(delay);
    }
  }
}

module.exports = { withRetry, sleep };
