import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Shield, Plus, Trash2 } from "lucide-react";

interface SuppressionEntry {
  id: string;
  workspaceId: string | null;
  email: string | null;
  domain: string | null;
  reason: string;
  createdAt: string | null;
}

type AddMode = "email" | "domain";

export default function SuppressionList() {
  const [addMode, setAddMode] = useState<AddMode>("email");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("manual");

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<{ success: boolean; data: SuppressionEntry[] }>({
    queryKey: ["/api/suppression"],
  });
  const entries: SuppressionEntry[] = data?.data ?? [];

  const addMutation = useMutation({
    mutationFn: async () => {
      const body =
        addMode === "email"
          ? { email: value.trim().toLowerCase(), reason }
          : { domain: value.trim().toLowerCase().replace(/^@/, ""), reason };
      const res = await apiRequest("POST", "/api/suppression", body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/suppression"] });
      setValue("");
      toast({ title: "Added to suppression list" });
    },
    onError: (err: Error) => {
      toast({ title: "Add failed", description: err.message, variant: "destructive" });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/suppression/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/suppression"] });
      toast({ title: "Removed from suppression list" });
    },
  });

  const reasonColor: Record<string, string> = {
    unsubscribed: "bg-blue-100 text-blue-700",
    bounced: "bg-yellow-100 text-yellow-700",
    spam_report: "bg-red-100 text-red-700",
    manual: "bg-gray-100 text-gray-700",
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-red-600" />
          Suppression List
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Add new entry */}
        <div className="border rounded-lg p-4 bg-gray-50 space-y-3">
          <div className="text-xs font-medium text-gray-500 uppercase">Add entry</div>
          <div className="flex items-center gap-2">
            <Select value={addMode} onValueChange={(v) => setAddMode(v as AddMode)}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="domain">Domain</SelectItem>
              </SelectContent>
            </Select>
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={addMode === "email" ? "user@example.com" : "example.com (blocks whole domain)"}
              className="flex-1"
            />
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Manual</SelectItem>
                <SelectItem value="unsubscribed">Unsubscribed</SelectItem>
                <SelectItem value="bounced">Bounced</SelectItem>
                <SelectItem value="spam_report">Spam report</SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="sm"
              onClick={() => addMutation.mutate()}
              disabled={!value.trim() || addMutation.isPending}
            >
              <Plus className="h-4 w-4 mr-1" /> Add
            </Button>
          </div>
          <p className="text-xs text-gray-500">
            Domain suppression blocks every address at that domain — useful for competitor exclusion or entire company opt-outs.
          </p>
        </div>

        {/* List */}
        {isLoading ? (
          <p className="text-sm text-gray-500 py-4 text-center">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-gray-500 py-4 text-center">
            No suppressed addresses yet. Unsubscribes, bounces, and spam reports will appear here automatically.
          </p>
        ) : (
          <div className="space-y-2">
            {entries.map((e) => (
              <div
                key={e.id}
                className="flex items-center justify-between border rounded-lg p-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Badge className={`text-xs ${reasonColor[e.reason] ?? reasonColor.manual}`}>
                    {e.reason.replace(/_/g, " ")}
                  </Badge>
                  <span className="font-mono text-sm text-gray-900 truncate">
                    {e.email ?? `@${e.domain}`}
                  </span>
                  {e.createdAt && (
                    <span className="text-xs text-gray-500">
                      {new Date(e.createdAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    if (confirm(`Remove ${e.email ?? e.domain} from suppression list?`)) {
                      removeMutation.mutate(e.id);
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
