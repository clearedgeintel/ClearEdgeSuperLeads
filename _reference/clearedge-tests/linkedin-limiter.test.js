const { isAllowed, record, remaining } = require('../lib/linkedin-limiter');

// Suppress logger output during tests
jest.mock('../lib/logger', () => ({
  warn: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
}));

describe('linkedin-limiter', () => {
  test('allows actions under the limit', () => {
    expect(isAllowed('search')).toBe(true);
    expect(remaining('search')).toBeGreaterThan(0);
  });

  test('tracks recorded actions', () => {
    const before = remaining('dispatch');
    record('dispatch');
    expect(remaining('dispatch')).toBe(before - 1);
  });

  test('returns true for unknown action types', () => {
    expect(isAllowed('unknown')).toBe(true);
    expect(remaining('unknown')).toBe(Infinity);
  });
});
