import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Webhook, Plus, Trash2, Send, Eye, EyeOff } from "lucide-react";

interface WebhookEndpoint {
  id: string;
  url: string;
  events: string[];
  secret: string;
  isActive: boolean;
  createdAt: string | null;
}

const SUPPORTED_EVENTS = [
  'lead.reply_received',
  'lead.connection_accepted',
  'lead.status_changed',
  'campaign.completed',
  'email.bounced',
  'meeting.booked',
];

export default function WebhookEndpoints() {
  const [showForm, setShowForm] = useState(false);
  const [url, setUrl] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [revealedSecrets, setRevealedSecrets] = useState<Set<string>>(new Set());

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data } = useQuery<{ success: boolean; data: WebhookEndpoint[] }>({
    queryKey: ['/api/webhooks/endpoints'],
  });
  const endpoints: WebhookEndpoint[] = data?.data ?? [];

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/webhooks/endpoints', {
        url,
        events: selectedEvents,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/webhooks/endpoints'] });
      setShowForm(false);
      setUrl('');
      setSelectedEvents([]);
      toast({ title: 'Webhook created', description: 'Copy the secret now — it is only shown once.' });
    },
    onError: (err: Error) => {
      toast({ title: 'Create failed', description: err.message, variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest('DELETE', `/api/webhooks/endpoints/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/webhooks/endpoints'] });
      toast({ title: 'Webhook deleted' });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async (args: { id: string; isActive: boolean }) => {
      const res = await apiRequest('PATCH', `/api/webhooks/endpoints/${args.id}`, {
        isActive: args.isActive,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/webhooks/endpoints'] });
    },
  });

  const testMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest('POST', `/api/webhooks/endpoints/${id}/test`);
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: data?.success ? 'Test delivered' : 'Test failed',
        description: data?.data?.status
          ? `Endpoint returned ${data.data.status}`
          : data?.data?.error,
        variant: data?.success ? 'default' : 'destructive',
      });
    },
  });

  function toggleEvent(event: string) {
    setSelectedEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]
    );
  }

  function toggleSecretReveal(id: string) {
    setRevealedSecrets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Webhook className="h-5 w-5 text-indigo-600" />
            Outbound Webhooks
          </CardTitle>
          {!showForm && (
            <Button size="sm" onClick={() => setShowForm(true)}>
              <Plus className="h-4 w-4 mr-1" /> New endpoint
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {showForm && (
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 space-y-3">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://your-endpoint.example.com/webhooks/clearedge"
            />
            <div>
              <div className="text-xs font-medium text-gray-600 mb-2">Subscribe to events:</div>
              <div className="flex flex-wrap gap-2">
                {SUPPORTED_EVENTS.map((ev) => (
                  <label key={ev} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedEvents.includes(ev)}
                      onChange={() => toggleEvent(ev)}
                    />
                    <code className="text-xs">{ev}</code>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2 justify-end">
              <Button size="sm" variant="outline" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => createMutation.mutate()}
                disabled={!url || selectedEvents.length === 0 || createMutation.isPending}
              >
                Create endpoint
              </Button>
            </div>
          </div>
        )}

        {endpoints.length === 0 && !showForm && (
          <p className="text-sm text-gray-500 py-4 text-center">
            No webhook endpoints configured. Add one to receive real-time event notifications.
          </p>
        )}

        <div className="space-y-2">
          {endpoints.map((e) => (
            <div key={e.id} className="border rounded-lg p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <code className="text-sm text-gray-900 truncate">{e.url}</code>
                    {!e.isActive && <Badge variant="outline">inactive</Badge>}
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {e.events.map((ev) => (
                      <Badge key={ev} variant="outline" className="text-xs">{ev}</Badge>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 mt-2 text-xs">
                    <span className="text-gray-500">Secret:</span>
                    <code className="font-mono">
                      {revealedSecrets.has(e.id) ? e.secret : '•'.repeat(24)}
                    </code>
                    <button
                      onClick={() => toggleSecretReveal(e.id)}
                      className="text-gray-500 hover:text-gray-700"
                    >
                      {revealedSecrets.has(e.id) ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={e.isActive}
                    onCheckedChange={(checked) =>
                      toggleMutation.mutate({ id: e.id, isActive: checked })
                    }
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => testMutation.mutate(e.id)}
                    disabled={testMutation.isPending}
                  >
                    <Send className="h-4 w-4 mr-1" /> Test
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (confirm(`Delete webhook endpoint ${e.url}?`)) deleteMutation.mutate(e.id);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
