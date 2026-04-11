const { classifyReply } = require('../lib/reply-classifier');

jest.mock('../lib/logger', () => ({
  warn: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
}));

// Mock the Anthropic SDK
jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: {
      create: jest.fn(),
    },
  }));
});

describe('classifyReply', () => {
  test('returns unclassified for empty message', async () => {
    const result = await classifyReply('');
    expect(result).toBe('unclassified');
  });

  test('returns unclassified for null message', async () => {
    const result = await classifyReply(null);
    expect(result).toBe('unclassified');
  });

  test('returns unclassified on API error', async () => {
    // The mock will throw since create is not set up to resolve
    const Anthropic = require('@anthropic-ai/sdk');
    const instance = new Anthropic();
    instance.messages.create.mockRejectedValue(new Error('API Error'));

    const result = await classifyReply('some message');
    expect(result).toBe('unclassified');
  });
});
