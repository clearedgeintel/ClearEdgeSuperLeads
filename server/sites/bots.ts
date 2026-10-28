// User agents that shouldn't count as site views: search crawlers, link
// unfurlers (Slack, iMessage, Facebook…), headless browsers and monitors.

const BOT_UA =
  /bot\b|bot\/|crawl|spider|slurp|preview|facebookexternalhit|facebot|embedly|quora link|whatsapp|telegram|discord|slack|skype|linkedin|pinterest|vkshare|w3c_validator|headless|phantomjs|puppeteer|playwright|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|statuscake|curl\/|wget\/|python-requests|python-urllib|go-http-client|okhttp|java\/|axios\/|node-fetch|undici|httpclient|libwww|scrapy/i;

export function isBot(userAgent: string | null | undefined): boolean {
  // No user agent at all is a script, not a person.
  if (!userAgent || !userAgent.trim()) return true;
  return BOT_UA.test(userAgent);
}
