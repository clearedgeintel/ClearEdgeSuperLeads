const { detectLanguage, getLocalizationInstruction } = require('../lib/language-detect');

jest.mock('@anthropic-ai/sdk', () => jest.fn().mockImplementation(() => ({})));
jest.mock('../lib/logger', () => ({
  warn: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
}));

describe('detectLanguage', () => {
  test('defaults to en for US locations', async () => {
    const lang = await detectLanguage({ location: 'New York, United States' });
    expect(lang).toBe('en');
  });

  test('detects Spanish for Spain', async () => {
    const lang = await detectLanguage({ location: 'Madrid, Spain' });
    expect(lang).toBe('es');
  });

  test('detects French for Paris', async () => {
    const lang = await detectLanguage({ location: 'Paris, France' });
    expect(lang).toBe('fr');
  });

  test('detects German for Germany', async () => {
    const lang = await detectLanguage({ location: 'Munich, Germany' });
    expect(lang).toBe('de');
  });

  test('defaults to en for empty lead', async () => {
    const lang = await detectLanguage({});
    expect(lang).toBe('en');
  });
});

describe('getLocalizationInstruction', () => {
  test('returns empty for English', () => {
    expect(getLocalizationInstruction('en')).toBe('');
  });

  test('returns Spanish instruction', () => {
    const inst = getLocalizationInstruction('es');
    expect(inst).toContain('Spanish');
    expect(inst).toContain('usted');
  });

  test('returns empty for unknown language', () => {
    expect(getLocalizationInstruction('xx')).toBe('');
  });
});
