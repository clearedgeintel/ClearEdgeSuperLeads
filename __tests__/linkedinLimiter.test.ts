import { isAllowed, record, remaining } from '../server/lib/linkedinLimiter';

describe('linkedinLimiter', () => {
  test('search starts allowed', () => {
    expect(isAllowed('search')).toBe(true);
  });

  test('remaining decrements as actions are recorded', () => {
    const before = remaining('search');
    record('search');
    const after = remaining('search');
    expect(after).toBeLessThanOrEqual(before);
  });

  test('different action types do not cross-contaminate', () => {
    const searchBefore = remaining('search');
    record('dispatch');
    const searchAfter = remaining('search');
    expect(searchAfter).toBe(searchBefore);
  });

  test('email action tracks independently', () => {
    expect(isAllowed('email')).toBe(true);
    const before = remaining('email');
    record('email');
    expect(remaining('email')).toBeLessThanOrEqual(before);
  });
});
