// Custom-domain normalization and validation. Domains are stored lowercased
// without a leading "www." (a CHECK constraint on sites enforces the same).

// RFC 1123 labels: 1–63 chars of [a-z0-9-], not starting/ending with '-'.
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/** Lowercase, trim, strip scheme/path/port/trailing dot and a leading "www.". */
export function normalizeCustomDomain(input: string): string {
  let d = input.trim().toLowerCase();
  d = d.replace(/^[a-z][a-z0-9+.-]*:\/\//, ''); // scheme
  d = d.split(/[/?#]/)[0]; // path, query, fragment
  d = d.replace(/:\d+$/, ''); // port
  d = d.replace(/\.$/, ''); // trailing dot
  if (d.startsWith('www.')) d = d.slice(4);
  return d;
}

/** True for a normalized public hostname like "example.com" or "shop.example.co.uk". */
export function isValidCustomDomain(domain: string): boolean {
  if (!domain || domain.length > 253) return false;
  if (domain !== normalizeCustomDomain(domain)) return false;
  const labels = domain.split('.');
  if (labels.length < 2) return false;
  if (!labels.every((l) => LABEL.test(l))) return false;
  // TLD must contain a letter (rejects IPv4 addresses like 10.0.0.1).
  if (!/[a-z]/.test(labels[labels.length - 1])) return false;
  return !/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/.test(domain);
}
