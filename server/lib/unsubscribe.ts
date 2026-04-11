// HMAC-signed stateless unsubscribe tokens. Keeping these in a shared
// lib instead of inline in routes.ts means emailService can generate
// the URL at send time and the unsubscribe GET route can verify it.
//
// The token is `base64url(email) + "." + base64url(hmac-sha256(payload))`.
// Anyone who replays the token can only unsubscribe the exact address
// it was issued for — no forged third-party unsubs.

import crypto from 'crypto';

function secret(): string {
  return process.env.SESSION_SECRET || 'dev-unsubscribe-secret-change-me';
}

export function makeUnsubscribeToken(email: string): string {
  const payload = Buffer.from(email.toLowerCase(), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyUnsubscribeToken(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;
  try {
    return Buffer.from(payload, 'base64url').toString('utf8');
  } catch {
    return null;
  }
}

export function makeUnsubscribeUrl(email: string): string {
  const appUrl = process.env.APP_URL || 'http://localhost:5000';
  return `${appUrl}/unsubscribe/${makeUnsubscribeToken(email)}`;
}
