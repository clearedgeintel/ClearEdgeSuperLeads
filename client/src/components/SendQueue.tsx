import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Send, Check, X, Edit3, ListChecks, AlertTriangle, Zap } from "lucide-react";

interface QueueItem {
  id: string;
  leadId: string;
  enrollmentId: string | null;
  campaignStepId: string | null;
  channel: string;
  aiDraft: string | null;
  editedDraft: string | null;
  status: string;
  charCount: number | null;
  overLimit: boolean;
  createdAt: string | null;
}

interface QueueStats {
  pending: number;
  approved: number;
  sent: number;
  skipped: number;
  failed: number;
}

const TABS = ["pending", "approved", "sent", "skipped", "failed"] as const;

export default function SendQueue() {
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]>("pending");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editItem, setEditItem] = useState<QueueItem | null>(null);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: statsData } = useQuery<{ success: boolean; data: QueueStats }>({
    queryKey: ["/api/queue/stats"],
    refetchInterval: 5000,
  });
  const stats = statsData?.data;

  const { data: itemsData, isLoading } = useQuery<{ success: boolean; data: QueueItem[] }>({
    queryKey: ["/api/queue", activeTab],
    queryFn: async () => {
      const res = await fetch(`/api/queue?status=${activeTab}`, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
  });
  const items = itemsData?.data ?? [];

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/queue", activeTab] });
    queryClient.invalidateQueries({ queryKey: ["/api/queue/stats"] });
  };

  const bulkApproveMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await apiRequest("POST", "/api/queue/bulk-approve", { ids });
      return res.json();
    },
    onSuccess: (data) => {
      invalidateAll();
      setSelected(new Set());
      toast({ title: "Approved", description: `${data?.data?.approved ?? 0} items.` });
    },
  });

  const bulkSkipMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await apiRequest("POST", "/api/queue/bulk-skip", { ids });
      return res.json();
    },
    onSuccess: (data) => {
      invalidateAll();
      setSelected(new Set());
      toast({ title: "Skipped", description: `${data?.data?.skipped ?? 0} items.` });
    },
  });

  const dispatchMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/queue/dispatch");
      return res.json();
    },
    onSuccess: (data) => {
      invalidateAll();
      const d = data?.data;
      toast({
        title: "Dispatch complete",
        description: `Sent ${d?.sent ?? 0}, failed ${d?.failed ?? 0}, rate-limited ${d?.rateLimited ?? 0}.`,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Dispatch failed", description: err.message, variant: "destructive" });
    },
  });

  const updateItemMutation = useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string;
      updates: { status?: string; editedDraft?: string };
    }) => {
      const res = await apiRequest("PATCH", `/api/queue/${id}`, updates);
      return res.json();
    },
    onSuccess: () => {
      invalidateAll();
      setEditItem(null);
    },
  });

  const selectedCount = selected.size;
  const selectedIds = useMemo(() => Array.from(selected), [selected]);

  function toggleAll() {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map((i) => i.id)));
  }
  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ListChecks className="h-6 w-6 text-orange-600" />
            Send Queue
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            Review, approve, edit, or skip AI-generated messages before they dispatch.
          </p>
        </div>
        <Button onClick={() => dispatchMutation.mutate()} disabled={dispatchMutation.isPending}>
          <Zap className="h-4 w-4 mr-2" />
          {dispatchMutation.isPending ? "Dispatching..." : "Dispatch Approved"}
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v as (typeof TABS)[number]); setSelected(new Set()); }}>
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t} value={t}>
              {t[0].toUpperCase() + t.slice(1)}
              {stats && stats[t] > 0 && (
                <Badge variant="secondary" className="ml-2">{stats[t]}</Badge>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        {TABS.map((t) => (
          <TabsContent key={t} value={t}>
            {activeTab === "pending" && items.length > 0 && (
              <div className="flex items-center gap-2 mb-3">
                <Checkbox
                  checked={selected.size === items.length && items.length > 0}
                  onCheckedChange={toggleAll}
                />
                <span className="text-sm text-gray-600">
                  {selectedCount > 0 ? `${selectedCount} selected` : "Select all"}
                </span>
                {selectedCount > 0 && (
                  <div className="flex items-center gap-2 ml-auto">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => bulkSkipMutation.mutate(selectedIds)}
                      disabled={bulkSkipMutation.isPending}
                    >
                      <X className="h-4 w-4 mr-1" /> Skip
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => bulkApproveMutation.mutate(selectedIds)}
                      disabled={bulkApproveMutation.isPending}
                    >
                      <Check className="h-4 w-4 mr-1" /> Approve
                    </Button>
                  </div>
                )}
              </div>
            )}

            {isLoading ? (
              <Card>
                <CardContent className="py-8 text-center text-gray-500">Loading…</CardContent>
              </Card>
            ) : items.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Send className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-600 font-medium">Queue is empty</p>
                  <p className="text-sm text-gray-500 mt-1">
                    No {activeTab} items to display.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {items.map((item) => (
                  <Card key={item.id}>
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        {activeTab === "pending" && (
                          <Checkbox
                            checked={selected.has(item.id)}
                            onCheckedChange={() => toggle(item.id)}
                          />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            <Badge variant="outline">{item.channel}</Badge>
                            <span className="text-xs text-gray-500">
                              {item.charCount ?? 0} chars
                            </span>
                            {item.overLimit && (
                              <Badge className="bg-red-100 text-red-700">
                                <AlertTriangle className="h-3 w-3 mr-1" /> Over limit
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-gray-800 whitespace-pre-wrap line-clamp-4">
                            {item.editedDraft ?? item.aiDraft ?? ""}
                          </p>
                        </div>
                        {activeTab === "pending" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditItem(item)}
                          >
                            <Edit3 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>

      <EditDialog
        item={editItem}
        onClose={() => setEditItem(null)}
        onSave={(draft) =>
          editItem && updateItemMutation.mutate({ id: editItem.id, updates: { editedDraft: draft } })
        }
      />
    </div>
  );
}

function EditDialog({
  item,
  onClose,
  onSave,
}: {
  item: QueueItem | null;
  onClose: () => void;
  onSave: (draft: string) => void;
}) {
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (item) setDraft(item.editedDraft ?? item.aiDraft ?? "");
  }, [item]);

  if (!item) return null;
  return (
    <Dialog open={!!item} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit Message</DialogTitle>
        </DialogHeader>
        <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={10} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onSave(draft)}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
