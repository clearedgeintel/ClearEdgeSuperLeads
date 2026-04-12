// SSE connection hook with auto-reconnect. Establishes a persistent
// EventSource to /api/events, dispatches incoming events via a callback,
// and reconnects with exponential backoff on drop. The hook is mounted
// once at the Dashboard level and passes events down to child components
// via TanStack Query invalidation (the simplest integration path — each
// component just re-fetches its query key when the relevant SSE event
// arrives, rather than maintaining a separate real-time state tree).

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from './use-toast';

const EVENT_QUERY_MAP: Record<string, string[]> = {
  queue_updated: ['/api/queue', '/api/queue/stats'],
  reply_received: ['/api/inbox/events', '/api/analytics/overview'],
  connection_accepted: ['/api/inbox/events', '/api/analytics/overview'],
  campaign_completed: ['/api/campaigns'],
  limit_warning: ['/api/linkedin/limits', '/api/workspace/usage'],
};

export function useSSE(): void {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const retryRef = useRef(0);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let cancelled = false;

    function connect() {
      if (cancelled) return;

      const source = new EventSource('/api/events', { withCredentials: true });
      sourceRef.current = source;

      source.addEventListener('connected', () => {
        retryRef.current = 0;
      });

      for (const eventType of Object.keys(EVENT_QUERY_MAP)) {
        source.addEventListener(eventType, (e) => {
          const keys = EVENT_QUERY_MAP[eventType];
          if (keys) {
            for (const key of keys) {
              queryClient.invalidateQueries({ queryKey: [key] });
            }
          }

          // Toast on reply_received so the operator notices even if they're
          // on a different tab.
          if (eventType === 'reply_received') {
            try {
              const data = JSON.parse((e as MessageEvent).data);
              toast({
                title: 'New reply received',
                description: `${data?.replies ?? 1} new reply(ies) classified.`,
              });
            } catch {
              toast({ title: 'New reply received' });
            }
          }
        });
      }

      source.onerror = () => {
        source.close();
        sourceRef.current = null;
        if (cancelled) return;
        // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s max.
        const delay = Math.min(1000 * Math.pow(2, retryRef.current), 30_000);
        retryRef.current++;
        setTimeout(connect, delay);
      };
    }

    connect();

    return () => {
      cancelled = true;
      sourceRef.current?.close();
      sourceRef.current = null;
    };
  }, [queryClient, toast]);
}
