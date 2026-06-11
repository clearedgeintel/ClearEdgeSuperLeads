// HMAC-signed stateless unsubscribe tokens. Keeping these in a shared
// lib instead of inline in routes.ts means emailService can generate
// the URL at send time and the unsubscribe GET route can verify it.
//
// The token is `base64url(email) + "." + base64url(hmac-sha256(payload))`
// (see server/lib/signedToken.ts). Anyone who replays the token can only
// unsubscribe the exact address it was issued for — no forged third-party
// unsubs.

import { makeSignedToken, verifySignedToken } from './signedToken';

function secret(): string {
  return process.env.SESSION_SECRET || 'dev-unsubscribe-secret-change-me';
}

export function makeUnsubscribeToken(email: string): string {
  return makeSignedToken(email.toLowerCase(), secret());
}

export function verifyUnsubscribeToken(token: string): string | null {
  return verifySignedToken(token, secret());
}

export function makeUnsubscribeUrl(email: string): string {
  const appUrl = process.env.APP_URL || 'http://localhost:5000';
  return `${appUrl}/unsubscribe/${makeUnsubscribeToken(email)}`;
}
