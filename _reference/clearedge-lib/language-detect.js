// ClearEdge — Language Detection and Localization

/**
 * Detect the language/locale of a prospect based on their profile info.
 * Returns ISO 639-1 code (e.g., 'en', 'es', 'fr', 'de').
 */
async function detectLanguage(lead) {
  // Quick heuristic: if location contains known non-English regions
  const location = (lead.location || '').toLowerCase();
  const headline = (lead.headline || '').toLowerCase();

  const regionHints = {
    es: ['spain', 'españa', 'mexico', 'méxico', 'colombia', 'argentina', 'chile', 'peru'],
    fr: ['france', 'paris', 'quebec', 'montréal', 'montreal', 'belgium', 'belgique'],
    de: ['germany', 'deutschland', 'austria', 'österreich', 'switzerland', 'zürich', 'munich'],
    pt: ['brazil', 'brasil', 'portugal', 'lisboa'],
    nl: ['netherlands', 'amsterdam', 'rotterdam', 'nederland'],
    it: ['italy', 'italia', 'milano', 'roma'],
    ja: ['japan', '日本', 'tokyo'],
    zh: ['china', '中国', 'shanghai', 'beijing'],
  };

  for (const [lang, keywords] of Object.entries(regionHints)) {
    if (keywords.some((k) => location.includes(k) || headline.includes(k))) {
      return lang;
    }
  }

  return 'en';
}

/**
 * Generate a localization instruction to prepend to the prompt.
 */
function getLocalizationInstruction(language) {
  const instructions = {
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

  return instructions[language] || '';
}

module.exports = { detectLanguage, getLocalizationInstruction };
