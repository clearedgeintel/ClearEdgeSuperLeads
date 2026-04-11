// Heuristic language detection + localization instruction lookup.
// Ported from ClearEdge Leads lib/language-detect.js. Pure functions,
// no I/O — picks a target language from the lead's location/headline
// fields and returns a prompt prefix telling Claude to write in that
// language with an appropriate register.

import type { Lead } from '@shared/schema';

type LangCode = 'en' | 'es' | 'fr' | 'de' | 'pt' | 'nl' | 'it' | 'ja' | 'zh';

const REGION_HINTS: Record<Exclude<LangCode, 'en'>, string[]> = {
  es: ['spain', 'españa', 'mexico', 'méxico', 'colombia', 'argentina', 'chile', 'peru'],
  fr: ['france', 'paris', 'quebec', 'montréal', 'montreal', 'belgium', 'belgique'],
  de: ['germany', 'deutschland', 'austria', 'österreich', 'switzerland', 'zürich', 'munich'],
  pt: ['brazil', 'brasil', 'portugal', 'lisboa'],
  nl: ['netherlands', 'amsterdam', 'rotterdam', 'nederland'],
  it: ['italy', 'italia', 'milano', 'roma'],
  ja: ['japan', '日本', 'tokyo'],
  zh: ['china', '中国', 'shanghai', 'beijing'],
};

const LOCALIZATION_INSTRUCTIONS: Record<LangCode, string> = {
  en: '',
  es: 'Write the message in Spanish (Español). Use formal "usted" form.',
  fr: 'Write the message in French (Français). Use formal "vous" form.',
  de: 'Write the message in German (Deutsch). Use formal "Sie" form.',
  pt: 'Write the message in Portuguese (Português).',
  nl: 'Write the message in Dutch (Nederlands).',
  it: 'Write the message in Italian (Italiano). Use formal "Lei" form.',
  ja: 'Write the message in Japanese (日本語). Use polite/formal register (です/ます form).',
  zh: 'Write the message in Simplified Chinese (简体中文).',
};

export function detectLanguage(lead: Pick<Lead, 'headline' | 'language'>): LangCode {
  // If the lead has an explicit language set (e.g. from profile metadata
  // or an earlier detection run), trust it.
  if (lead.language && isLangCode(lead.language)) return lead.language;

  const headline = (lead.headline ?? '').toLowerCase();
  // The unified leads table doesn't have a dedicated "location" field on
  // LinkedIn leads — headline tends to contain "Marketing Manager at X |
  // Paris, France", so scan headline instead.
  for (const [lang, keywords] of Object.entries(REGION_HINTS) as Array<[
    Exclude<LangCode, 'en'>,
    string[],
  ]>) {
    if (keywords.some((k) => headline.includes(k))) return lang;
  }
  return 'en';
}

export function getLocalizationInstruction(language: string | null | undefined): string {
  if (!language) return '';
  if (isLangCode(language)) return LOCALIZATION_INSTRUCTIONS[language];
  return '';
}

function isLangCode(value: string): value is LangCode {
  return ['en', 'es', 'fr', 'de', 'pt', 'nl', 'it', 'ja', 'zh'].includes(value);
}
