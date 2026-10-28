import { useState } from 'react';
import { CheckCircle2, Circle, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { siteCanonicalHost, type Site } from '@shared/sites';
import { Button } from '@/components/ui/button';
import { sitesRequest } from './api';

interface HostDns {
  host: string;
  cname: string[];
  addresses: string[];
  pointsAtRailway: boolean;
  error?: string;
}
interface DomainCheck {
  canonicalHost: string;
  otherHost: string;
  canonical: HostDns;
  other: HostDns;
  https: { ok: boolean; status?: number; error?: string };
  live: boolean;
  ready: boolean;
}

// The manual DNS checklist for a saved custom domain, plus a live check.
// v1 doesn't call Railway's API: each domain gets its own CNAME target and TXT
// record in the Railway dashboard, which the steps tell you to copy exactly.
export default function DomainSetup({ site }: { site: Site }) {
  const [check, setCheck] = useState<DomainCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canonical = siteCanonicalHost(site);
  if (!canonical || !site.customDomain) return null;
  const apex = site.customDomain;
  const www = `www.${apex}`;

  async function runCheck() {
    setChecking(true);
    setError(null);
    try {
      setCheck(await sitesRequest<DomainCheck>('GET', `/api/sites/${site.id}/domain-check`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
      <p className="font-medium text-gray-900">
        Connect <span className="font-mono">{canonical}</span>
      </p>
      <ol className="list-decimal space-y-2 pl-5 text-gray-700">
        <li>
          In Railway, open the <strong>public</strong> site service → Settings → Networking → Custom Domain,
          and add <code className="font-mono">{canonical}</code>.
        </li>
        <li>
          At the DNS provider, create the two records Railway shows for it, copied exactly:
          <ul className="mt-1 list-disc pl-5">
            <li>
              a <strong>CNAME</strong> for <code className="font-mono">{site.customDomainWww ? 'www' : '@'}</code>{' '}
              pointing at the target Railway gives (it looks like <code className="font-mono">xxxxxx.up.railway.app</code>)
            </li>
            <li>
              the <strong>TXT</strong> verification record. Without it Railway answers 404 even after the CNAME
              works.
            </li>
          </ul>
        </li>
        {site.customDomainWww ? (
          <li>
            Send the bare domain to www: use the registrar’s <strong>URL forwarding</strong> (301) from{' '}
            <code className="font-mono">{apex}</code> to <code className="font-mono">https://{www}</code>. Or, if
            the DNS provider supports CNAME flattening / ALIAS (Cloudflare, DNSimple, Namecheap, bunny.net), add{' '}
            <code className="font-mono">{apex}</code> in Railway too and point it there; it will redirect to www.
          </li>
        ) : (
          <li>
            A bare domain needs <strong>CNAME flattening or an ALIAS/ANAME record</strong> (Cloudflare, DNSimple,
            Namecheap, bunny.net). GoDaddy, Route 53, Squarespace and Hostinger can’t do it; use www instead
            (tick “Use www” above) and forward the bare domain to it.
          </li>
        )}
        <li>
          On Cloudflare with the proxy on (orange cloud), set SSL/TLS to <strong>Full</strong>, not Full (Strict).
        </li>
        <li>
          Railway issues the SSL certificate once DNS resolves, usually within an hour. Then publish the site
          and check below.
        </li>
      </ol>

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={runCheck} disabled={checking}>
          {checking ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
          Check domain
        </Button>
        {check && (
          <span className={check.ready ? 'text-green-700 font-medium' : 'text-gray-600'}>
            {check.ready ? 'Live on its domain' : 'Not ready yet'}
          </span>
        )}
      </div>
      {error && <p className="text-red-600">{error}</p>}
      {check && (
        <ul className="space-y-1">
          <Status ok={check.canonical.pointsAtRailway} label={`${check.canonicalHost} points at Railway`} detail={dnsDetail(check.canonical)} />
          <Status ok={check.https.ok} label={`HTTPS works on ${check.canonicalHost}`} detail={check.https.error} />
          <Status ok={check.live} label="Site is published" detail={check.live ? undefined : 'Publish it to serve it on the domain.'} />
          <Status
            ok={check.other.pointsAtRailway || null}
            label={`${check.otherHost} (optional)`}
            detail={check.other.pointsAtRailway ? 'Points at Railway and redirects.' : 'Not pointed at Railway; fine if your registrar forwards it.'}
          />
        </ul>
      )}
    </div>
  );
}

function dnsDetail(d: HostDns): string | undefined {
  if (d.pointsAtRailway) return undefined;
  if (d.error) return `DNS lookup failed (${d.error}).`;
  if (d.cname.length) return `CNAME is ${d.cname.join(', ')}.`;
  if (d.addresses.length) return `Resolves to ${d.addresses.slice(0, 3).join(', ')} (behind a proxy? the HTTPS check decides).`;
  return 'No DNS records yet.';
}

function Status({ ok, label, detail }: { ok: boolean | null; label: string; detail?: string }) {
  const Icon = ok === null ? Circle : ok ? CheckCircle2 : XCircle;
  const color = ok === null ? 'text-gray-400' : ok ? 'text-green-600' : 'text-red-500';
  return (
    <li className="flex gap-2">
      <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${color}`} />
      <span>
        {label}
        {detail && <span className="block text-xs text-gray-500">{detail}</span>}
      </span>
    </li>
  );
}
