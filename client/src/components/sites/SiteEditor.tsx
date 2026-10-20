import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Download,
  ExternalLink,
  Globe,
  Loader2,
  Plus,
  Rocket,
  Save,
  Trash2,
  Undo2,
} from 'lucide-react';
import {
  SAMPLE_TESTIMONIAL_AUTHOR,
  type BusinessData,
  type Site,
  type SiteSubmission,
  type Theme,
} from '@shared/sites';
import { queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { publicSiteHref, sitesRequest, SitesApiError, type SitesConfig } from './api';
import PhotoManager from './PhotoManager';

const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: 'slate', label: 'Slate (dark, bold)' },
  { value: 'clean', label: 'Clean (light, professional)' },
  { value: 'warm', label: 'Warm (friendly)' },
];

const selectCls =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

// Site editor. Ported from Instant Site's Editor page, plus photos, owner
// notification email, custom domain and publish.
export default function SiteEditor({ id, onBack }: { id: string; onBack: () => void }) {
  const { toast } = useToast();
  const siteKey = [`/api/sites/${id}`];
  const { data: loaded, error: loadError } = useQuery<Site>({ queryKey: siteKey });
  const { data: config } = useQuery<SitesConfig>({ queryKey: ['/api/sites/config'] });
  const { data: submissions } = useQuery<SiteSubmission[]>({
    queryKey: [`/api/sites/${id}/submissions`],
  });
  // Signed preview link on the public server (falls back to the in-app preview).
  // Tokens last 30 minutes; refetch well before that.
  const { data: preview } = useQuery<{ url: string; external: boolean }>({
    queryKey: [`/api/sites/${id}/preview-url`],
    staleTime: 10 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
  });

  const [site, setSite] = useState<Site | null>(null);
  const [data, setData] = useState<BusinessData | null>(null);
  const [theme, setTheme] = useState<Theme>('slate');
  const [notifyEmail, setNotifyEmail] = useState('');
  const [customDomain, setCustomDomain] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishErrors, setPublishErrors] = useState<string[]>([]);
  const [previewKey, setPreviewKey] = useState(0);

  function load(s: Site) {
    setSite(s);
    setData(s.data);
    setTheme(s.theme);
    setNotifyEmail(s.notifyEmail ?? '');
    setCustomDomain(s.customDomain ?? '');
    setDirty(false);
  }

  useEffect(() => {
    if (loaded) load(loaded);
  }, [loaded]);

  const previewSrc = useMemo(() => {
    if (!preview) return '';
    const sep = preview.url.includes('?') ? '&' : '?';
    return `${preview.url}${sep}theme=${theme}&v=${previewKey}`;
  }, [preview, theme, previewKey]);

  function touch() {
    setDirty(true);
    setSaved(false);
  }

  function update<K extends keyof BusinessData>(key: K, value: BusinessData[K]) {
    setData((d) => (d ? { ...d, [key]: value } : d));
    touch();
  }

  /** Apply a server response without discarding unsaved form edits. */
  function applyServerSite(next: Site) {
    setSite(next);
    queryClient.setQueryData(siteKey, next);
    queryClient.invalidateQueries({ queryKey: ['/api/sites'] });
  }

  async function save(): Promise<boolean> {
    if (!data || !site) return false;
    setSaving(true);
    try {
      const updated = await sitesRequest<Site>('PATCH', `/api/sites/${site.id}`, {
        data,
        theme,
        notifyEmail: notifyEmail.trim() || null,
        customDomain: customDomain.trim() || null,
      });
      applyServerSite(updated);
      load(updated);
      setSaved(true);
      setPreviewKey((k) => k + 1);
      setTimeout(() => setSaved(false), 2000);
      return true;
    } catch (e) {
      const err = e as SitesApiError;
      toast({
        title: 'Could not save',
        description: [err.message, ...(err.errors ?? [])].join(' '),
        variant: 'destructive',
      });
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    if (!site) return;
    if (dirty && !(await save())) return;
    setPublishing(true);
    setPublishErrors([]);
    try {
      const updated = await sitesRequest<Site>('POST', `/api/sites/${site.id}/publish`);
      applyServerSite(updated);
      toast({ title: 'Site is live' });
    } catch (e) {
      const err = e as SitesApiError;
      if (err.errors?.length) setPublishErrors(err.errors);
      else toast({ title: 'Publish failed', description: err.message, variant: 'destructive' });
    } finally {
      setPublishing(false);
    }
  }

  async function unpublish() {
    if (!site) return;
    setPublishing(true);
    try {
      applyServerSite(await sitesRequest<Site>('POST', `/api/sites/${site.id}/unpublish`));
      toast({ title: 'Site is back to a demo' });
    } catch (e) {
      toast({ title: 'Unpublish failed', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setPublishing(false);
    }
  }

  async function downloadHtml() {
    if (!site) return;
    if (dirty && !(await save())) return;
    const res = await fetch(`/api/sites/${site.id}/preview`, { credentials: 'include' });
    const blob = new Blob([await res.text()], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${site.slug}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loadError) {
    return (
      <div className="space-y-4">
        <BackButton onBack={onBack} />
        <p className="text-red-600">{(loadError as Error).message}</p>
      </div>
    );
  }
  if (!site || !data) {
    return (
      <div className="flex items-center gap-2 text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading editor…
      </div>
    );
  }

  const liveHref = publicSiteHref(config, site.slug);
  const isLive = site.status === 'live';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <BackButton onBack={onBack} />
          <h1 className="text-xl font-bold text-gray-900 truncate">{data.name || 'Untitled'}</h1>
          <Badge className={isLive ? 'bg-green-100 text-green-800 border-transparent' : 'bg-gray-100 text-gray-700 border-transparent'}>
            {site.status}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={save} disabled={saving || !dirty} variant="outline">
            {saving ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : saved ? (
              <Check className="h-4 w-4 mr-2" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            {dirty ? 'Save changes' : 'Saved'}
          </Button>
          {isLive ? (
            <Button variant="outline" onClick={unpublish} disabled={publishing}>
              <Undo2 className="h-4 w-4 mr-2" /> Unpublish
            </Button>
          ) : (
            <Button onClick={publish} disabled={publishing}>
              {publishing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Rocket className="h-4 w-4 mr-2" />}
              Publish
            </Button>
          )}
        </div>
      </div>

      {publishErrors.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900">
          <p className="font-medium text-sm">Before this site can go live:</p>
          <ul className="mt-1 list-disc pl-5 text-sm space-y-0.5">
            {publishErrors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Form column */}
        <div className="space-y-6">
          {!data.phone && (
            <div className="flex gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">
              <AlertTriangle className="h-5 w-5 shrink-0 text-red-500" />
              <div className="text-sm">
                <strong>No verified phone number.</strong> Research didn’t confirm one, and a wrong
                number on a “we built this for you” site kills the pitch. Add the correct number
                below before sending.
              </div>
            </div>
          )}

          <Section title="Appearance">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Theme">
                <select
                  className={selectCls}
                  value={theme}
                  onChange={(e) => {
                    setTheme(e.target.value as Theme);
                    touch();
                  }}
                >
                  {THEME_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Brand color">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    aria-label="Brand color picker"
                    value={/^#[0-9a-fA-F]{6}$/.test(data.brandColor) ? data.brandColor : '#2563eb'}
                    onChange={(e) => update('brandColor', e.target.value)}
                    className="h-10 w-12 rounded border border-input"
                  />
                  <Input value={data.brandColor} onChange={(e) => update('brandColor', e.target.value)} />
                </div>
              </Field>
            </div>
          </Section>

          <Section title="Going live">
            <Field label="Notification email (quote requests go here)">
              <Input
                type="email"
                value={notifyEmail}
                placeholder="owner@example.com"
                onChange={(e) => {
                  setNotifyEmail(e.target.value);
                  touch();
                }}
              />
            </Field>
            <Field label="Custom domain (optional)">
              <Input
                value={customDomain}
                placeholder="example.com"
                onChange={(e) => {
                  setCustomDomain(e.target.value);
                  touch();
                }}
              />
            </Field>
            <p className="text-xs text-gray-500 flex gap-1.5">
              <Globe className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              Stored without “www.”. DNS setup instructions for the domain will appear here once
              custom-domain hosting is switched on.
            </p>
          </Section>

          <Section title="Photos">
            <PhotoManager site={site} enabled={!!config?.photoUploadsEnabled} onChange={applyServerSite} />
          </Section>

          <Section title="Business">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Name">
                <Input value={data.name} onChange={(e) => update('name', e.target.value)} />
              </Field>
              <Field label="Category">
                <Input value={data.category} onChange={(e) => update('category', e.target.value)} />
              </Field>
              <Field label="City">
                <Input value={data.city} onChange={(e) => update('city', e.target.value)} />
              </Field>
              <Field label="State">
                <Input value={data.state} onChange={(e) => update('state', e.target.value)} />
              </Field>
              <Field label="Phone">
                <Input
                  value={data.phone ?? ''}
                  placeholder="(512) 555-0142"
                  onChange={(e) => update('phone', e.target.value ? e.target.value : null)}
                />
              </Field>
              <Field label="Website">
                <Input
                  value={data.website ?? ''}
                  onChange={(e) => update('website', e.target.value ? e.target.value : null)}
                />
              </Field>
              <Field label="Rating">
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  max="5"
                  value={data.rating ?? ''}
                  onChange={(e) => update('rating', e.target.value === '' ? null : Number(e.target.value))}
                />
              </Field>
              <Field label="Review count">
                <Input
                  type="number"
                  min="0"
                  value={data.reviewCount ?? ''}
                  onChange={(e) =>
                    update('reviewCount', e.target.value === '' ? null : Math.round(Number(e.target.value)))
                  }
                />
              </Field>
              <Field label="Hours">
                <Input value={data.hours} onChange={(e) => update('hours', e.target.value)} />
              </Field>
              <Field label="Years in business">
                <Input
                  value={data.yearsInBusiness ?? ''}
                  onChange={(e) => update('yearsInBusiness', e.target.value ? e.target.value : null)}
                />
              </Field>
            </div>
            <Field label="Tagline (10 words or fewer)">
              <Input value={data.tagline} onChange={(e) => update('tagline', e.target.value)} />
            </Field>
            <Field label="About">
              <Textarea rows={3} value={data.about} onChange={(e) => update('about', e.target.value)} />
            </Field>
          </Section>

          <Section title="Services">
            {data.services.map((s, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  placeholder="Service name"
                  value={s.name}
                  onChange={(e) => {
                    const next = [...data.services];
                    next[i] = { ...next[i], name: e.target.value };
                    update('services', next);
                  }}
                />
                <Input
                  placeholder="Short description"
                  value={s.desc}
                  onChange={(e) => {
                    const next = [...data.services];
                    next[i] = { ...next[i], desc: e.target.value };
                    update('services', next);
                  }}
                />
                <RemoveButton onClick={() => update('services', data.services.filter((_, j) => j !== i))} />
              </div>
            ))}
            <AddButton onClick={() => update('services', [...data.services, { name: '', desc: '' }])}>
              Add service
            </AddButton>
          </Section>

          <Section title="Service areas">
            <div className="flex flex-wrap gap-2">
              {data.serviceAreas.map((a, i) => (
                <div key={i} className="flex items-center gap-1">
                  <Input
                    className="w-36"
                    value={a}
                    onChange={(e) => {
                      const next = [...data.serviceAreas];
                      next[i] = e.target.value;
                      update('serviceAreas', next);
                    }}
                  />
                  <RemoveButton
                    onClick={() => update('serviceAreas', data.serviceAreas.filter((_, j) => j !== i))}
                  />
                </div>
              ))}
            </div>
            <AddButton onClick={() => update('serviceAreas', [...data.serviceAreas, ''])}>Add area</AddButton>
          </Section>

          <Section title="Testimonials">
            <p className="text-xs text-amber-700">
              These ship as clearly labeled samples. Replace the author with a real name (and the text
              with a real quote) before sending, or remove them. A site can’t go live with samples.
            </p>
            {data.testimonials.map((t, i) => {
              const isSample = t.author === SAMPLE_TESTIMONIAL_AUTHOR;
              return (
                <div key={i} className="rounded-lg border border-gray-200 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    {isSample ? (
                      <Badge className="bg-amber-100 text-amber-800 border-transparent">
                        SAMPLE — replace before sending
                      </Badge>
                    ) : (
                      <span />
                    )}
                    <RemoveButton
                      onClick={() => update('testimonials', data.testimonials.filter((_, j) => j !== i))}
                    />
                  </div>
                  <Textarea
                    rows={2}
                    value={t.text}
                    onChange={(e) => {
                      const next = [...data.testimonials];
                      next[i] = { ...next[i], text: e.target.value };
                      update('testimonials', next);
                    }}
                  />
                  <Input
                    placeholder="Author (real name)"
                    value={isSample ? '' : t.author}
                    onChange={(e) => {
                      const next = [...data.testimonials];
                      next[i] = { ...next[i], author: e.target.value };
                      update('testimonials', next);
                    }}
                  />
                </div>
              );
            })}
            <AddButton onClick={() => update('testimonials', [...data.testimonials, { text: '', author: '' }])}>
              Add testimonial
            </AddButton>
          </Section>

          <Section title={`Quote requests${submissions?.length ? ` (${submissions.length})` : ''}`}>
            {!submissions?.length ? (
              <p className="text-sm text-gray-500">None yet.</p>
            ) : (
              <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
                {submissions.map((s) => (
                  <li key={s.id} className="p-3 text-sm">
                    <div className="flex justify-between gap-2">
                      <span className="font-medium text-gray-900">{s.name}</span>
                      <span className="text-gray-400">{new Date(s.createdAt).toLocaleString()}</span>
                    </div>
                    <div className="text-gray-600">{[s.phone, s.email].filter(Boolean).join(' · ')}</div>
                    {s.message && <p className="mt-1 text-gray-700 whitespace-pre-wrap">{s.message}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        {/* Preview column */}
        <Card className="overflow-hidden flex flex-col lg:sticky lg:top-6 lg:h-[calc(100vh-8rem)]">
          <div className="flex items-center justify-between gap-2 border-b px-4 py-2">
            <span className="text-sm text-gray-500 truncate">
              Preview · /s/{site.slug}
              {dirty && <span className="ml-2 text-amber-600">unsaved: save to update</span>}
            </span>
            <div className="flex items-center gap-2">
              {liveHref && (
                <Button variant="outline" size="sm" asChild>
                  <a href={liveHref} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-3.5 w-3.5 mr-1" /> Open
                  </a>
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={downloadHtml}>
                <Download className="h-3.5 w-3.5 mr-1" /> HTML
              </Button>
            </div>
          </div>
          <iframe key={previewSrc} title="Site preview" src={previewSrc} className="flex-1 w-full bg-white min-h-[60vh]" />
        </Card>
      </div>
    </div>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
      <ArrowLeft className="h-4 w-4 mr-1" /> All sites
    </Button>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold uppercase tracking-wide text-gray-500">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-gray-600">{label}</Label>
      {children}
    </div>
  );
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick} title="Remove" className="shrink-0">
      <Trash2 className="h-4 w-4 text-gray-500" />
    </Button>
  );
}

function AddButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <Button variant="outline" size="sm" onClick={onClick} className="border-dashed">
      <Plus className="h-4 w-4 mr-1" /> {children}
    </Button>
  );
}
