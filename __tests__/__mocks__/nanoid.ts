// CJS mock for nanoid (ESM-only). Jest can't parse nanoid's ESM import
// so we provide a trivial replacement that generates unique-enough IDs
// for test purposes. Uses crypto.randomUUID which is always available
// in Node 18+.
import crypto from 'crypto';

export function nanoid(size?: number): string {
  const uuid = crypto.randomUUID().replace(/-/g, '');
  return size ? uuid.slice(0, size) : uuid.slice(0, 21);
}
