// Custom-domain check: DNS interpretation, the HTTPS probe, and the guard
// against probing private addresses. DNS and fetch are fakes.

import { checkCustomDomain, isPrivateAddress, type DnsResolver, type FetchLike } from '../../server/sites/domainCheck';
import { siteCanonicalHost } from '../../shared/sites';

type Records = Record<string, { cname?: string[]; a?: string[]; aaaa?: string[] }>;

function fakeDns(records: Records): DnsResolver {
  const nodata = () => Object.assign(new Error('no data'), { code: 'ENODATA' });
  const get = (host: string, k: 'cname' | 'a' | 'aaaa') => {
    const v = records[host]?.[k];
    return v ? Promise.resolve(v) : Promise.reject(nodata());
  };
  return {
    resolveCname: (h) => get(h, 'cname'),
    resolve4: (h) => get(h, 'a'),
    resolve6: (h) => get(h, 'aaaa'),
  };
}

const ours: FetchLike = async () => ({ status: 200, json: async () => ({ ok: true, service: 'clearedge-public-sites' }) });

const site = { customDomain: 'acme-roofing.com', customDomainWww: true, status: 'live' as const };

describe('siteCanonicalHost', () => {
  test('www or bare, null without a domain', () => {
    expect(siteCanonicalHost({ customDomain: 'a.com', customDomainWww: true })).toBe('www.a.com');
    expect(siteCanonicalHost({ customDomain: 'a.com', customDomainWww: false })).toBe('a.com');
    expect(siteCanonicalHost({ customDomain: null, customDomainWww: true })).toBeNull();
  });
});

describe('checkCustomDomain', () => {
  test('ready: www CNAMEs into up.railway.app, HTTPS answers as the site server, site live', async () => {
    const fetch = jest.fn(ours);
    const r = await checkCustomDomain(site, {
      dns: fakeDns({
        'www.acme-roofing.com': { cname: ['g05ns7.up.railway.app.'], a: ['66.33.22.1'] },
        'acme-roofing.com': { a: ['198.51.100.20'] }, // registrar forwarding
      }),
      fetch,
    });
    expect(r).toMatchObject({
      canonicalHost: 'www.acme-roofing.com',
      otherHost: 'acme-roofing.com',
      canonical: { pointsAtRailway: true, cname: ['g05ns7.up.railway.app'] },
      other: { pointsAtRailway: false },
      https: { ok: true, status: 200 },
      live: true,
      ready: true,
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://www.acme-roofing.com/healthz',
      expect.objectContaining({ redirect: 'manual' })
    );
  });

  test('matches the public service addresses when DNS is a flattened apex', async () => {
    const r = await checkCustomDomain(
      { ...site, customDomainWww: false },
      {
        dns: fakeDns({
          'acme-roofing.com': { a: ['66.33.22.1'] },
          'clearedge-sites.up.railway.app': { a: ['66.33.22.1'] },
        }),
        fetch: ours,
        railwayHost: 'clearedge-sites.up.railway.app',
      }
    );
    expect(r.canonical.pointsAtRailway).toBe(true);
    expect(r.ready).toBe(true);
  });

  test('not ready until published', async () => {
    const r = await checkCustomDomain(
      { ...site, status: 'draft' },
      { dns: fakeDns({ 'www.acme-roofing.com': { cname: ['x.up.railway.app'], a: ['66.33.22.1'] } }), fetch: ours }
    );
    expect(r.https.ok).toBe(true);
    expect(r.ready).toBe(false);
  });

  test('another server answering HTTPS (the old host) is not ready', async () => {
    const r = await checkCustomDomain(site, {
      dns: fakeDns({ 'www.acme-roofing.com': { a: ['203.0.113.50'] } }),
      fetch: async () => ({ status: 200, json: async () => ({ hello: 'old site' }) }),
    });
    expect(r.canonical.pointsAtRailway).toBe(false);
    expect(r.https).toMatchObject({ ok: false, error: expect.stringMatching(/not the ClearEdge site server/) });
    expect(r.ready).toBe(false);
  });

  test('certificate not issued yet', async () => {
    const r = await checkCustomDomain(site, {
      dns: fakeDns({ 'www.acme-roofing.com': { cname: ['x.up.railway.app'], a: ['66.33.22.1'] } }),
      fetch: async () => {
        throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ERR_TLS_CERT_ALTNAME_INVALID' } });
      },
    });
    expect(r.https.error).toMatch(/certificate is not issued/);
  });

  test('no DNS yet: no HTTPS probe', async () => {
    const fetch = jest.fn(ours);
    const r = await checkCustomDomain(site, { dns: fakeDns({}), fetch });
    expect(r.canonical).toMatchObject({ addresses: [], cname: [], pointsAtRailway: false });
    expect(r.https.error).toMatch(/does not resolve/);
    expect(fetch).not.toHaveBeenCalled();
  });

  test.each(['127.0.0.1', '10.0.0.5', '169.254.169.254', '192.168.1.1', '172.16.0.1', '100.64.0.1', '::1', 'fd00::1'])(
    'never probes a domain resolving to %s',
    async (ip) => {
      const fetch = jest.fn(ours);
      const isV6 = ip.includes(':');
      const r = await checkCustomDomain(site, {
        dns: fakeDns({ 'www.acme-roofing.com': isV6 ? { aaaa: [ip] } : { a: [ip] } }),
        fetch,
      });
      expect(r.https.error).toMatch(/private address/);
      expect(fetch).not.toHaveBeenCalled();
    }
  );

  test('times out', async () => {
    const r = await checkCustomDomain(site, {
      dns: fakeDns({ 'www.acme-roofing.com': { a: ['66.33.22.1'] } }),
      fetch: (_url, init) =>
        new Promise((_res, rej) =>
          init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))
        ),
      timeoutMs: 20,
    });
    expect(r.https.error).toMatch(/Timed out/);
  });

  test('requires a domain', async () => {
    await expect(
      checkCustomDomain({ customDomain: null, customDomainWww: false, status: 'live' }, { dns: fakeDns({}), fetch: ours })
    ).rejects.toThrow(/no custom domain/);
  });
});

describe('isPrivateAddress', () => {
  test.each(['8.8.8.8', '66.33.22.1', '2606:4700::1111'])('public: %s', (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });
  test.each(['0.0.0.0', '127.0.0.1', '10.1.2.3', '172.31.255.255', '192.168.0.1', '169.254.1.1', '100.100.0.1', '224.0.0.1', '::', '::1', 'fe80::1', 'fc00::1', '::ffff:10.0.0.1', 'not-an-ip'])(
    'private: %s',
    (ip) => {
      expect(isPrivateAddress(ip)).toBe(true);
    }
  );
});
