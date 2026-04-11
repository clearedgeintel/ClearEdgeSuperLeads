import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Inbox as InboxIcon, RefreshCw, UserPlus, MessageSquare } from "lucide-react";
import LeadModal from "./LeadModal";

interface InboxEvent {
  id: string;
  leadId: string;
  eventType: string;
  sentiment: string | null;
  eventData: unknown;
  occurredAt: string | null;
  lead: {
    id: string;
    businessName: string;
    fullName: string | null;
    linkedinUrl: string | null;
    title: string | null;
    company: string | null;
    email: string | null;
    status: string | null;
    leadSource: string | null;
  } | null;
}

const SENTIMENT_STYLES: Record<string, string> = {
  positive: "bg-green-100 text-green-700 border-green-200",
  negative: "bg-red-100 text-red-700 border-red-200",
  neutral: "bg-gray-100 text-gray-700 border-gray-200",
  out_of_office: "bg-yellow-100 text-yellow-700 border-yellow-200",
  unclassified: "bg-gray-100 text-gray-500 border-gray-200",
};

export default function Inbox() {
  const [selectedLead, setSelectedLead] = useState<InboxEvent["lead"] | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<{ success: boolean; data: InboxEvent[] }>({
    queryKey: ["/api/inbox/events"],
    refetchInterval: 30000,
  });
  const events: InboxEvent[] = data?.data ?? [];

  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/inbox/sync");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/events"] });
      const d = data?.data;
      toast({
        title: "Sync complete",
        description: `${d?.replies ?? 0} replies, ${d?.connectionsAccepted ?? 0} connections.`,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Sync failed", description: err.message, variant: "destructive" });
    },
  });

  function tryParseEventData(raw: unknown): { message?: string } {
    if (!raw || typeof raw !== "object") return {};
    return raw as { message?: string };
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <InboxIcon className="h-6 w-6 text-blue-600" />
            Inbox
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            New LinkedIn replies and accepted connection requests. Sync pulls from Unipile.
          </p>
        </div>
        <Button onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending}>
          <RefreshCw className={`h-4 w-4 mr-2 ${syncMutation.isPending ? "animate-spin" : ""}`} />
          {syncMutation.isPending ? "Syncing..." : "Sync Inbox"}
        </Button>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="py-8 text-center text-gray-500">Loading…</CardContent>
        </Card>
      ) : events.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <InboxIcon className="h-12 w-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-600 font-medium">Nothing new yet</p>
            <p className="text-sm text-gray-500 mt-1">
              Click Sync Inbox to pull the latest activity from Unipile.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {events.map((event) => {
            const data = tryParseEventData(event.eventData);
            const isReply = event.eventType === "reply_received";
            const leadName =
              event.lead?.fullName ??
              event.lead?.businessName ??
              "Unknown lead";
            return (
              <Card
                key={event.id}
                className="cursor-pointer hover:shadow"
                onClick={() => setSelectedLead(event.lead)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-1">
                      {isReply ? (
                        <MessageSquare className="h-5 w-5 text-blue-600" />
                      ) : (
                        <UserPlus className="h-5 w-5 text-green-600" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-gray-900">{leadName}</span>
                        {event.lead?.title && (
                          <span className="text-xs text-gray-500">· {event.lead.title}</span>
                        )}
                        {isReply && event.sentiment && (
                          <Badge
                            className={`text-xs border ${SENTIMENT_STYLES[event.sentiment] ?? SENTIMENT_STYLES.unclassified}`}
                          >
                            {event.sentiment.replace(/_/g, " ")}
                          </Badge>
                        )}
                        {!isReply && <Badge className="text-xs bg-green-100 text-green-700">connection accepted</Badge>}
                      </div>
                      {isReply && data.message && (
                        <p className="text-sm text-gray-700 line-clamp-2">{data.message}</p>
                      )}
                      <p className="text-xs text-gray-500 mt-1">
                        {event.occurredAt ? new Date(event.occurredAt).toLocaleString() : ""}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {selectedLead && (
        <LeadModal
          lead={selectedLead}
          open={!!selectedLead}
          onClose={() => setSelectedLead(null)}
          onOutreach={() => {
            /* phase 3 inbox: no outreach action from here */
          }}
        />
      )}
    </div>
  );
}
