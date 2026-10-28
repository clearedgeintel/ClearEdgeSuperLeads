// Custom-domain readiness check for the editor (GET /api/sites/:id/domain-check).
//
// 1. DNS: does the canonical host (and the other apex/www variant) resolve to
//    Railway? Railway gives each custom domain its own `*.up.railway.app` CNAME
//    target, so "points at Railway" means a CNAME into up.railway.app, or the
//    same addresses as the public service's Railway host when one is configured.
// 2. HTTPS: does https://<canonical>/healthz answer as the public site server?
//    That proves the domain reaches our service and the certificate is issued
//    (it also works through a Cloudflare proxy, where DNS shows Cloudflare IPs).
//
// The domain is user-supplied and the request runs server-side, so the HTTPS
// probe is skipped when the domain resolves to a private or internal address.

import { isIP } from 'net';
import { siteCanonicalHost, type Site } from '@shared/sites';

export interface DnsResolver {
  resolveCname(host: string): Promise<string[]>;
  resolve4(host: string): Promise<string[]>;
  resolve6(host: string): Promise<string[]>;
}

export type FetchLike = (
  url: string,
  init: { redirect: 'manual'; signal: AbortSignal; headers: Record<string, string> }
) => Promise<{ status: number; json(): Promise<unknown> }>;

export interface HostDns {
  host: string;
  cname: string[];
  addresses: string[];
  pointsAtRailway: boolean;
  error?: string;
}

export interface DomainCheckResult {
  domain: string;
  canonicalHost: string;
  otherHost: string;
  canonical: HostDns;
  other: HostDns;
  https: { ok: boolean; status?: number; error?: string };
  live: boolean;
  /** Canonical host reaches the public server over HTTPS and the site is live. */
  ready: boolean;
}

const RAILWAY_SUFFIX = '.up.railway.app';
const PUBLIC_SERVICE_MARKER = 'clearedge-public-sites';

/** Loopback, private, link-local, CGNAT, unique-local and unspecified ranges. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    if (x === '::' || x === '::1') return true;
    if (x.startsWith('::ffff:')) return isPrivateAddress(x.slice(7));
    return /^(fc|fd|fe8|fe9|fea|feb)/.test(x);
  }
  return true; // not an IP at all: treat as unsafe
}

async function settle<T>(p: Promise<T>, fallback: T): Promise<{ value: T; error?: string }> {
  try {
    return { value: await p };
  } catch (err) {
    const code = (err as { code?: string }).code;
    // "No such record" is an answer, not an error.
    if (code === 'ENODATA' || code === 'ENOTFOUND') return { value: fallback };
    return { value: fallback, error: code || (err as Error).message };
  }
}

async function lookupHost(dns: DnsResolver, host: string, railwayAddresses: Set<string>): Promise<HostDns> {
  const [cname, v4, v6] = await Promise.all([
    settle(dns.resolveCname(host), [] as string[]),
    settle(dns.resolve4(host), [] as string[]),
    settle(dns.resolve6(host), [] as string[]),
  ]);
  const addresses = [...v4.value, ...v6.value];
  const cnames = cname.value.map((c) => c.toLowerCase().replace(/\.$/, ''));
  const pointsAtRailway =
    cnames.some((c) => c.endsWith(RAILWAY_SUFFIX)) ||
    (railwayAddresses.size > 0 && addresses.length > 0 && addresses.some((a) => railwayAddresses.has(a)));
  const error = !addresses.length && !cnames.length ? (v4.error ?? cname.error) : undefined;
  return { host, cname: cnames, addresses, pointsAtRailway, ...(error ? { error } : {}) };
}

export async function checkCustomDomain(
  site: Pick<Site, 'customDomain' | 'customDomainWww' | 'status'>,
  deps: { dns: DnsResolver; fetch: FetchLike; railwayHost?: string | null; timeoutMs?: number }
): Promise<DomainCheckResult> {
  const canonicalHost = siteCanonicalHost(site);
  if (!canonicalHost || !site.customDomain) throw new Error('This site has no custom domain.');
  const otherHost = site.customDomainWww ? site.customDomain : `www.${site.customDomain}`;

  const railwayAddresses = new Set<string>();
  if (deps.railwayHost) {
    const [v4, v6] = await Promise.all([
      settle(deps.dns.resolve4(deps.railwayHost), [] as string[]),
      settle(deps.dns.resolve6(deps.railwayHost), [] as string[]),
    ]);
    for (const a of [...v4.value, ...v6.value]) railwayAddresses.add(a);
  }

  const [canonical, other] = await Promise.all([
    lookupHost(deps.dns, canonicalHost, railwayAddresses),
    lookupHost(deps.dns, otherHost, railwayAddresses),
  ]);

  let https: DomainCheckResult['https'];
  if (!canonical.addresses.length) {
    https = { ok: false, error: 'The domain does not resolve yet.' };
  } else if (canonical.addresses.some(isPrivateAddress)) {
    https = { ok: false, error: 'The domain resolves to a private address; not checked.' };
  } else {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 8000);
    try {
      const res = await deps.fetch(`https://${canonicalHost}/healthz`, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'user-agent': 'ClearEdge domain check' },
      });
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        /* not JSON */
      }
      const ours = (body as { service?: string } | null)?.service === PUBLIC_SERVICE_MARKER;
      https =
        res.status === 200 && ours
          ? { ok: true, status: 200 }
          : {
              ok: false,
              status: res.status,
              error: ours ? `Unexpected status ${res.status}.` : 'HTTPS works, but it is not the ClearEdge site server yet.',
            };
    } catch (err) {
      const e = err as { name?: string; cause?: { code?: string }; message?: string };
      const code = e.cause?.code ?? '';
      https = {
        ok: false,
        error:
          e.name === 'AbortError'
            ? 'Timed out connecting over HTTPS.'
            : /CERT|SSL|TLS|ALTNAME/i.test(code + (e.message ?? ''))
              ? 'The SSL certificate is not issued yet (Railway usually issues it within an hour).'
              : `Could not connect over HTTPS${code ? ` (${code})` : ''}.`,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    domain: site.customDomain,
    canonicalHost,
    otherHost,
    canonical,
    other,
    https,
    live: site.status === 'live',
    ready: https.ok && site.status === 'live',
  };
}
