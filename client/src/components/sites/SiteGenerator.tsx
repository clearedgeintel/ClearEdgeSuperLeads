import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Sparkles } from 'lucide-react';
import type { GenerateResponse } from '@shared/sites';
import { queryClient } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { sitesRequest } from './api';

// Generate a site from a Google Maps link or "Business Name, City ST".
// Ported from Instant Site's Generator page.
export default function SiteGenerator({
  onCreated,
  onBack,
}: {
  onCreated: (id: string) => void;
  onBack: () => void;
}) {
  const [input, setInput] = useState('');
  const [locHint, setLocHint] = useState('');
  const [error, setError] = useState<string | null>(null);

  const generate = useMutation({
    mutationFn: () =>
      sitesRequest<GenerateResponse>('POST', '/api/sites/generate', {
        input: input.trim(),
        ...(locHint.trim() ? { locHint: locHint.trim() } : {}),
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['/api/sites'] });
      onCreated(result.id);
    },
    onError: (e: Error) => setError(e.message),
  });

  function onGenerate() {
    if (input.trim().length < 2) {
      setError('Paste a Google Maps link, or a business name and city.');
      return;
    }
    setError(null);
    generate.mutate();
  }

  return (
    <div className="max-w-2xl space-y-6">
      <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
        <ArrowLeft className="h-4 w-4 mr-1" /> All sites
      </Button>
      <div>
        <h1 className="text-2xl font-bold text-gray-900">New demo site</h1>
        <p className="text-sm text-gray-600 mt-1">
          Paste a Google Maps URL (short links work too) or a business name and city. We research the
          business and build a one-page demo site. To build one from a lead you already have, use
          “Generate demo site” on the lead.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="gen-input">Google Maps link or “Business Name, City ST”</Label>
            <Textarea
              id="gen-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') onGenerate();
              }}
              rows={3}
              placeholder="https://maps.app.goo.gl/…  or  Lone Star Roofing, Austin TX"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="gen-loc">Location hint (optional)</Label>
            <Input
              id="gen-loc"
              value={locHint}
              onChange={(e) => setLocHint(e.target.value)}
              placeholder="Austin, TX"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button onClick={onGenerate} disabled={generate.isPending}>
            {generate.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4 mr-2" />
            )}
            {generate.isPending ? 'Researching and building…' : 'Generate site'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
