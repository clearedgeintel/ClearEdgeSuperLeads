// HMAC-signed invite tokens. Unlike the stateless unsubscribe token, this one
// signs the invitation row id (not the email) — the DB row carries status +
// expiry so an invite can be revoked and can't be replayed after acceptance.
// The token is just a tamper-proof pointer to that row.
//
// Format: `base64url(invitationId) + "." + base64url(hmac-sha256(payload))`
// (see server/lib/signedToken.ts).

import { makeSignedToken, verifySignedToken } from './signedToken';

function secret(): string {
  return process.env.SESSION_SECRET || 'dev-invite-secret-change-me';
}

export function makeInviteToken(invitationId: string): string {
  return makeSignedToken(invitationId, secret());
}

export function verifyInviteToken(token: string): string | null {
  return verifySignedToken(token, secret());
}

export function makeInviteUrl(invitationId: string): string {
  const appUrl = process.env.APP_URL || 'http://localhost:5000';
  return `${appUrl}/accept-invite/${makeInviteToken(invitationId)}`;
}
