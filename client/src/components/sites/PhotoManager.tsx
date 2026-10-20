import { useRef, useState } from 'react';
import { ImagePlus, Loader2, Star, Trash2 } from 'lucide-react';
import type { Site, SitePhoto } from '@shared/sites';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { sitesRequest } from './api';

// Upload, label, reorder roles and remove site photos. Uploads go straight to
// the server; role/alt/remove edits save as a photos PATCH.
export default function PhotoManager({
  site,
  enabled,
  onChange,
}: {
  site: Site;
  enabled: boolean;
  onChange: (site: Site) => void;
}) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [alts, setAlts] = useState<Record<string, string>>({});

  async function savePhotos(photos: SitePhoto[]) {
    setSaving(true);
    try {
      onChange(await sitesRequest<Site>('PATCH', `/api/sites/${site.id}`, { photos }));
    } catch (e) {
      toast({ title: 'Could not save photos', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  async function onUpload(file: File) {
    const form = new FormData();
    form.append('file', file);
    form.append('alt', file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').slice(0, 300));
    form.append('role', site.photos.some((p) => p.role === 'hero') ? 'gallery' : 'hero');
    setUploading(true);
    try {
      onChange(await sitesRequest<Site>('POST', `/api/sites/${site.id}/photos`, form));
    } catch (e) {
      toast({ title: 'Upload failed', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const makeHero = (url: string) =>
    savePhotos(
      site.photos.map((p) => ({
        ...p,
        role: p.url === url ? ('hero' as const) : p.role === 'hero' ? ('gallery' as const) : p.role,
      }))
    );

  return (
    <div className="space-y-3">
      {!enabled && (
        <p className="text-xs text-gray-500">
          Photo uploads aren’t configured on this server (SUPABASE_URL / SUPABASE_SERVICE_KEY).
        </p>
      )}
      {site.photos.length === 0 && enabled && (
        <p className="text-sm text-gray-500">No photos yet. The first one you add becomes the hero image.</p>
      )}
      <ul className="space-y-2">
        {site.photos.map((p) => (
          <li key={p.url} className="flex items-center gap-3 rounded-lg border border-gray-200 p-2">
            <img src={p.url} alt={p.alt} className="h-14 w-20 rounded object-cover bg-gray-100" />
            <div className="flex-1 min-w-0 space-y-1">
              <Input
                aria-label="Alt text"
                placeholder="Describe the photo"
                value={alts[p.url] ?? p.alt}
                onChange={(e) => setAlts((a) => ({ ...a, [p.url]: e.target.value }))}
                onBlur={() => {
                  const alt = (alts[p.url] ?? p.alt).trim();
                  if (alt !== p.alt) savePhotos(site.photos.map((x) => (x.url === p.url ? { ...x, alt } : x)));
                }}
              />
              <span className="text-xs text-gray-500">{p.role === 'hero' ? 'Hero image' : 'Gallery'}</span>
            </div>
            {p.role !== 'hero' && (
              <Button variant="ghost" size="sm" title="Use as hero image" disabled={saving} onClick={() => makeHero(p.url)}>
                <Star className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              title="Remove photo"
              disabled={saving}
              onClick={() => savePhotos(site.photos.filter((x) => x.url !== p.url))}
            >
              <Trash2 className="h-4 w-4 text-gray-500" />
            </Button>
          </li>
        ))}
      </ul>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onUpload(file);
        }}
      />
      <Button
        variant="outline"
        size="sm"
        disabled={!enabled || uploading}
        onClick={() => fileRef.current?.click()}
      >
        {uploading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <ImagePlus className="h-4 w-4 mr-1" />}
        Add photo
      </Button>
      <p className="text-xs text-gray-500">JPEG, PNG or WebP, up to 10 MB.</p>
    </div>
  );
}
