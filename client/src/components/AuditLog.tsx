import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollText } from "lucide-react";

interface AuditEntry {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  userEmail: string | null;
  metadata: unknown;
  createdAt: string | null;
}

const ACTION_FILTERS = [
  'all',
  'gdpr_delete',
  'suppression_added',
  'suppression_removed',
  'unsubscribe',
  'bulk_deduplicate',
  'webhook_created',
  'webhook_deleted',
  'webhook_delivered',
  'webhook_failed',
  'linkedin_connection_request',
  'linkedin_message',
  'linkedin_inmail',
];

export default function AuditLog() {
  const [action, setAction] = useState<string>('all');
  const [search, setSearch] = useState('');

  const qs = new URLSearchParams();
  if (action !== 'all') qs.set('action', action);
  qs.set('limit', '200');

  const { data, isLoading } = useQuery<{ success: boolean; data: AuditEntry[] }>({
    queryKey: ['/api/audit-log', action],
    queryFn: async () => {
      const res = await fetch(`/api/audit-log?${qs.toString()}`, { credentials: 'include' });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
  });
  const entries: AuditEntry[] = data?.data ?? [];

  const filtered = search
    ? entries.filter((e) =>
        [e.action, e.entityType, e.entityId, e.userEmail, JSON.stringify(e.metadata)]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(search.toLowerCase())
      )
    : entries;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ScrollText className="h-5 w-5 text-gray-600" />
          Audit Log
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2 mb-4">
          <Select value={action} onValueChange={setAction}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACTION_FILTERS.map((a) => (
                <SelectItem key={a} value={a}>
                  {a === 'all' ? 'All actions' : a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            placeholder="Search entries..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1"
          />
        </div>

        {isLoading ? (
          <p className="text-sm text-gray-500 py-4 text-center">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-gray-500 py-4 text-center">No audit entries match these filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-gray-500 uppercase">
                  <th className="py-2 pr-4">When</th>
                  <th className="py-2 pr-4">Who</th>
                  <th className="py-2 pr-4">Action</th>
                  <th className="py-2 pr-4">Target</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr key={e.id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="py-2 pr-4 text-xs text-gray-600 whitespace-nowrap">
                      {e.createdAt ? new Date(e.createdAt).toLocaleString() : '—'}
                    </td>
                    <td className="py-2 pr-4 text-xs">
                      {e.userEmail ?? <span className="text-gray-400">system</span>}
                    </td>
                    <td className="py-2 pr-4">
                      <Badge variant="outline" className="text-xs">{e.action}</Badge>
                    </td>
                    <td className="py-2 pr-4 text-xs">
                      {e.entityType && <span className="text-gray-500">{e.entityType}</span>}
                      {e.entityId && <span className="font-mono ml-1">{e.entityId.slice(0, 8)}…</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
