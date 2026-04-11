const { formatRagContext } = require('../lib/rag-engine');

jest.mock('../lib/logger', () => ({
  warn: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
}));

describe('formatRagContext', () => {
  test('returns empty string for no examples', () => {
    expect(formatRagContext([])).toBe('');
    expect(formatRagContext(null)).toBe('');
  });

  test('formats examples with outreach and reply', () => {
    const examples = [
      {
        outbound_message: 'Hi, loved your work on AI hiring tools.',
        reply_message: 'Thanks! Would love to chat more about this.',
        industry: 'Technology',
      },
    ];
    const result = formatRagContext(examples);
    expect(result).toContain('Example 1 (Technology)');
    expect(result).toContain('loved your work');
    expect(result).toContain('Positive reply');
    expect(result).toContain('successful outreach');
  });

  test('handles examples without reply', () => {
    const examples = [{ outbound_message: 'Hello there', reply_message: null, industry: null }];
    const result = formatRagContext(examples);
    expect(result).toContain('Example 1 (general)');
    expect(result).not.toContain('Positive reply');
  });

  test('truncates long messages', () => {
    const examples = [
      {
        outbound_message: 'A'.repeat(500),
        reply_message: 'B'.repeat(500),
        industry: 'Tech',
      },
    ];
    const result = formatRagContext(examples);
    expect(result.length).toBeLessThan(1000);
  });
});
