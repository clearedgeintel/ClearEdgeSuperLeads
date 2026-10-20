import { useMutation, useQuery } from '@tanstack/react-query';
import { ExternalLink, Globe, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import type { SiteListItem } from '@shared/sites';
import { queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { publicSiteHref, sitesRequest, type SitesConfig } from './api';

const STATUS_STYLES: Record<string, string> = {
  live: 'bg-green-100 text-green-800 border-transparent',
  sent: 'bg-blue-100 text-blue-800 border-transparent',
  draft: 'bg-gray-100 text-gray-700 border-transparent',
};

// Sites in this workspace, newest first. Ported from Instant Site's Dashboard.
export default function SitesList({
  onEdit,
  onNew,
}: {
  onEdit: (id: string) => void;
  onNew: () => void;
}) {
  const { toast } = useToast();
  const { data: sites, isLoading, error } = useQuery<SiteListItem[]>({ queryKey: ['/api/sites'] });
  const { data: config } = useQuery<SitesConfig>({ queryKey: ['/api/sites/config'] });

  const remove = useMutation({
    mutationFn: (id: string) => sitesRequest('DELETE', `/api/sites/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/sites'] });
      toast({ title: 'Site deleted' });
    },
    onError: (e: Error) => toast({ title: 'Delete failed', description: e.message, variant: 'destructive' }),
  });

  function onDelete(site: SiteListItem) {
    if (
      confirm(
        `Delete the site for "${site.data.name}"? It will no longer be reachable at /s/${site.slug}.`
      )
    ) {
      remove.mutate(site.id);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Globe className="h-6 w-6 text-sky-600" />
            Sites
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            Demo and live one-page sites for your leads and clients.
          </p>
        </div>
        <Button onClick={onNew}>
          <Plus className="h-4 w-4 mr-2" /> New site
        </Button>
      </div>

      {error && <p className="text-sm text-red-600">{(error as Error).message}</p>}
      {isLoading && (
        <div className="flex items-center gap-2 text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      )}
      {sites && sites.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-gray-600">
            No sites yet. Generate one from a lead (“Generate demo site”), or{' '}
            <button onClick={onNew} className="text-sky-600 hover:underline">
              from a Google Maps link
            </button>
            .
          </CardContent>
        </Card>
      )}

      {sites && sites.length > 0 && (
        <Card>
          <ul className="divide-y divide-gray-100">
            {sites.map((s) => {
              const href = publicSiteHref(config, s.slug);
              return (
                <li key={s.id} className="flex items-center justify-between gap-4 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-gray-900 truncate">{s.data.name}</span>
                      <Badge className={STATUS_STYLES[s.status] ?? STATUS_STYLES.draft}>{s.status}</Badge>
                      {!s.data.phone && <Badge variant="destructive">no phone</Badge>}
                      {s.viewCount > 0 && (
                        <Badge
                          variant="outline"
                          title={
                            s.lastViewedAt
                              ? `Last viewed ${new Date(s.lastViewedAt).toLocaleString()}`
                              : undefined
                          }
                        >
                          {s.viewCount} view{s.viewCount === 1 ? '' : 's'}
                        </Badge>
                      )}
                      {s.submissionCount > 0 && (
                        <Badge className="bg-sky-100 text-sky-800 border-transparent">
                          {s.submissionCount} quote request{s.submissionCount === 1 ? '' : 's'}
                        </Badge>
                      )}
                    </div>
                    <div className="text-sm text-gray-500 truncate">
                      {[s.data.category, [s.data.city, s.data.state].filter(Boolean).join(', ')]
                        .filter(Boolean)
                        .join(' · ')}{' '}
                      · <span className="text-gray-400">/s/{s.slug}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {href && (
                      <Button variant="outline" size="sm" asChild>
                        <a href={href} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="h-3.5 w-3.5 mr-1" /> Open
                        </a>
                      </Button>
                    )}
                    <Button size="sm" onClick={() => onEdit(s.id)}>
                      <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      title="Delete site"
                      onClick={() => onDelete(s)}
                      disabled={remove.isPending && remove.variables === s.id}
                    >
                      {remove.isPending && remove.variables === s.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5 text-gray-500" />
                      )}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
