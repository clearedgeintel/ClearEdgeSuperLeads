import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SiteListItem } from '@shared/sites';
import SitesList from './SitesList';
import SiteGenerator from './SiteGenerator';
import SiteEditor from './SiteEditor';

type View = { kind: 'list' } | { kind: 'generate' } | { kind: 'edit'; id: string };

// Sites tab: list → generator → editor. `openSlug` (set when another tab asks
// to open a site, e.g. after "Generate demo site" on a lead) jumps straight to
// that site's editor once the list has loaded.
export default function SitesTab({
  openSlug,
  onOpened,
}: {
  openSlug?: string | null;
  onOpened?: () => void;
}) {
  const [view, setView] = useState<View>({ kind: 'list' });
  const { data: sites } = useQuery<SiteListItem[]>({ queryKey: ['/api/sites'] });

  useEffect(() => {
    if (!openSlug || !sites) return;
    const match = sites.find((s) => s.slug === openSlug);
    if (match) setView({ kind: 'edit', id: match.id });
    onOpened?.();
  }, [openSlug, sites, onOpened]);

  if (view.kind === 'generate') {
    return (
      <SiteGenerator
        onBack={() => setView({ kind: 'list' })}
        onCreated={(id) => setView({ kind: 'edit', id })}
      />
    );
  }
  if (view.kind === 'edit') {
    return <SiteEditor key={view.id} id={view.id} onBack={() => setView({ kind: 'list' })} />;
  }
  return (
    <SitesList onEdit={(id) => setView({ kind: 'edit', id })} onNew={() => setView({ kind: 'generate' })} />
  );
}
