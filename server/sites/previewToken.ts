// Short-lived signed tokens that let the admin editor preview a site on the
// public server (`/s/:slug?preview=1&token=…`). The admin app signs, the
// public server verifies; both need SITE_PREVIEW_SECRET. It's a dedicated
// secret so the public service never holds the admin SESSION_SECRET.

import { makeSignedToken, verifySignedToken } from '../lib/signedToken';

export const PREVIEW_TOKEN_TTL_MS = 30 * 60 * 1000;

const DEV_FALLBACK = 'dev-only-site-preview-secret';

/** The signing secret, or null in production when it isn't configured. */
export function previewSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.SITE_PREVIEW_SECRET) return env.SITE_PREVIEW_SECRET;
  return env.NODE_ENV === 'production' ? null : DEV_FALLBACK;
}

export function makePreviewToken(
  siteId: string,
  secret: string,
  now = Date.now(),
  ttlMs = PREVIEW_TOKEN_TTL_MS
): string {
  return makeSignedToken(JSON.stringify({ s: siteId, e: now + ttlMs }), secret);
}

/** True only for an unexpired token issued for this exact site. */
export function verifyPreviewToken(
  token: string | undefined,
  siteId: string,
  secret: string,
  now = Date.now()
): boolean {
  if (!token) return false;
  const value = verifySignedToken(token, secret);
  if (!value) return false;
  try {
    const { s, e } = JSON.parse(value) as { s?: unknown; e?: unknown };
    return s === siteId && typeof e === 'number' && e > now;
  } catch {
    return false;
  }
}
