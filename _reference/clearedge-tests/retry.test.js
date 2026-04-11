const { withRetry } = require('../lib/retry');

// Suppress logger output during tests
jest.mock('../lib/logger', () => ({
  warn: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
}));

describe('withRetry', () => {
  test('returns result on first success', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 10 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('retries on transient error then succeeds', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValue('recovered');

    const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 10 });
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test('throws after exhausting retries', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('ETIMEDOUT'));

    await expect(withRetry(fn, { maxRetries: 2, baseDelayMs: 10 })).rejects.toThrow('ETIMEDOUT');
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  test('does not retry non-retryable status codes', async () => {
    const err = new Error('Bad Request');
    err.status = 400;
    const fn = jest.fn().mockRejectedValue(err);

    await expect(withRetry(fn, { maxRetries: 3, baseDelayMs: 10 })).rejects.toThrow('Bad Request');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('retries on 429 (rate limited)', async () => {
    const err429 = new Error('Too Many Requests');
    err429.status = 429;
    const fn = jest.fn().mockRejectedValueOnce(err429).mockResolvedValue('ok');

    const result = await withRetry(fn, { maxRetries: 2, baseDelayMs: 10 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test('retries on 503 (service unavailable)', async () => {
    const err503 = new Error('Service Unavailable');
    err503.status = 503;
    const fn = jest
      .fn()
      .mockRejectedValueOnce(err503)
      .mockRejectedValueOnce(err503)
      .mockResolvedValue('ok');

    const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 10 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
