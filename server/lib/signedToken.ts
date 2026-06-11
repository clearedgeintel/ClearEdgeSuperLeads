// Shared HMAC-signed token primitives. Both the unsubscribe link (unsubscribe.ts)
// and the workspace invite link (inviteToken.ts) are stateless `payload.sig`
// tokens with the same construction; this is the single source of truth so a
// security fix or format change happens in one place.
//
// Token format: `base64url(value) + "." + base64url(hmacSHA256(payload))`.
// Callers pass the signing secret (SESSION_SECRET with a per-use dev fallback),
// which keeps each token namespace distinct.

import crypto from 'crypto';

/** Length-checked, timing-safe comparison of two base64/base64url strings. */
export function timingSafeEqualB64(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** Sign a value into a stateless `payload.sig` token. */
export function makeSignedToken(value: string, secret: string): string {
  const payload = Buffer.from(value, 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

/** Verify a `payload.sig` token; returns the original value, or null if invalid. */
export function verifySignedToken(token: string, secret: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  if (!timingSafeEqualB64(sig, expected)) return null;
  try {
    return Buffer.from(payload, 'base64url').toString('utf8');
  } catch {
    return null;
  }
}
