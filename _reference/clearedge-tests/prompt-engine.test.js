const { interpolatePrompt } = require('../lib/prompt-engine');

jest.mock('../lib/logger', () => ({
  warn: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
}));

describe('interpolatePrompt', () => {
  const lead = {
    full_name: 'Jane Smith',
    title: 'VP Engineering',
    company: 'Acme Corp',
    industry: 'Technology',
    headline: 'Building great teams',
    company_size: 'enterprise',
    enrichment_data: {
      description: 'Cloud infrastructure company',
      technologies: ['React', 'Node.js'],
    },
  };

  test('replaces all template variables', () => {
    const template =
      'Hello {{full_name}}, I see you are {{title}} at {{company}} in {{industry}}. {{headline}}';
    const result = interpolatePrompt(template, lead, 'consultative');
    expect(result).toBe(
      'Hello Jane Smith, I see you are VP Engineering at Acme Corp in Technology. Building great teams'
    );
  });

  test('uses defaults for missing lead fields', () => {
    const template = '{{full_name}} at {{company}}';
    const result = interpolatePrompt(template, {}, 'direct');
    expect(result).toBe('the recipient at their company');
  });

  test('replaces tone variable', () => {
    const template = 'Tone: {{tone}}';
    const result = interpolatePrompt(template, {}, 'curiosity-led');
    expect(result).toBe('Tone: curiosity-led');
  });

  test('includes enrichment data', () => {
    const template = 'Context: {{enrichment}}';
    const result = interpolatePrompt(template, lead, 'consultative');
    expect(result).toContain('Cloud infrastructure company');
    expect(result).toContain('React, Node.js');
  });

  test('handles null enrichment_data gracefully', () => {
    const template = 'Context: {{enrichment}}';
    const result = interpolatePrompt(template, { enrichment_data: null }, 'consultative');
    expect(result).toBe('Context: ');
  });
});
