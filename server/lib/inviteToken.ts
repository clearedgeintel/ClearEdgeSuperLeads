// HMAC-signed invite tokens. Unlike the stateless unsubscribe token, this one
// signs the invitation row id (not the email) — the DB row carries status +
// expiry so an invite can be revoked and can't be replayed after acceptance.
// The token is just a tamper-proof pointer to that row.
//
// Format: `base64url(invitationId) + "." + base64url(hmac-sha256(payload))`.

import crypto from 'crypto';

function secret(): string {
  return process.env.SESSION_SECRET || 'dev-invite-secret-change-me';
}

export function makeInviteToken(invitationId: string): string {
  const payload = Buffer.from(invitationId, 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyInviteToken(token: string): string | null {
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

export function makeInviteUrl(invitationId: string): string {
  const appUrl = process.env.APP_URL || 'http://localhost:5000';
  return `${appUrl}/accept-invite/${makeInviteToken(invitationId)}`;
}
