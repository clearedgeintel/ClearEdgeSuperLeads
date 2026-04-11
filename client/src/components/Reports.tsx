import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BarChart3, Download, DollarSign, Trophy, TableIcon } from "lucide-react";

interface CampaignAnalytics {
  id: string;
  name: string;
  status: string | null;
  outreachChannel: string;
  enrolled: number;
  contacted: number;
  connected: number;
  replied: number;
  positiveReplies: number;
  meetingsBooked: number;
  messagesSent: number;
  replyRate: string;
  positiveRate: string;
}

interface PromptLeaderboardEntry {
  id: string;
  campaignName: string;
  variant: string;
  stepOrder: number;
  timesUsed: number;
  replyCount: number;
  positiveReplyCount: number;
  replyRate: string;
  positiveRate: string;
  promptPreview: string;
}

interface ApiCostSummary {
  periodDays: number;
  totalCalls: number;
  byProvider: Record<string, { calls: number; inputTokens?: number; outputTokens?: number }>;
  estimatedClaudeCostUsd: string;
}

export default function Reports() {
  const { data: campaignsData } = useQuery<{ success: boolean; data: CampaignAnalytics[] }>({
    queryKey: ["/api/analytics/campaigns"],
  });
  const campaigns: CampaignAnalytics[] = campaignsData?.data ?? [];

  const { data: leaderboardData } = useQuery<{ success: boolean; data: PromptLeaderboardEntry[] }>({
    queryKey: ["/api/analytics/prompt-leaderboard"],
  });
  const leaderboard: PromptLeaderboardEntry[] = leaderboardData?.data ?? [];

  const { data: costsData } = useQuery<{ success: boolean; data: ApiCostSummary }>({
    queryKey: ["/api/analytics/api-costs"],
  });
  const costs = costsData?.data;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-indigo-600" />
            Reports
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            Campaign comparison, A/B prompt leaderboard, and AI cost dashboard.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <a href="/api/export/leads.csv" download>
              <Download className="h-4 w-4 mr-2" /> Leads CSV
            </a>
          </Button>
          <Button variant="outline" asChild>
            <a href="/api/export/campaigns.csv" download>
              <Download className="h-4 w-4 mr-2" /> Campaigns CSV
            </a>
          </Button>
        </div>
      </div>

      {/* Campaign comparison */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TableIcon className="h-5 w-5 text-gray-600" />
            Campaign Comparison
          </CardTitle>
        </CardHeader>
        <CardContent>
          {campaigns.length === 0 ? (
            <p className="text-sm text-gray-500 py-6 text-center">
              No campaigns yet. Build one in the Campaigns tab to see per-campaign metrics here.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-gray-500 uppercase">
                    <th className="py-2 pr-4">Campaign</th>
                    <th className="py-2 pr-4">Channel</th>
                    <th className="py-2 pr-4 text-right">Enrolled</th>
                    <th className="py-2 pr-4 text-right">Sent</th>
                    <th className="py-2 pr-4 text-right">Replies</th>
                    <th className="py-2 pr-4 text-right">Reply%</th>
                    <th className="py-2 pr-4 text-right">Positive%</th>
                    <th className="py-2 pr-4 text-right">Meetings</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((c) => (
                    <tr key={c.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="py-2 pr-4">
                        <div className="font-medium text-gray-900">{c.name}</div>
                        <div className="text-xs text-gray-500">{c.status ?? "—"}</div>
                      </td>
                      <td className="py-2 pr-4">
                        <Badge variant="outline">{c.outreachChannel}</Badge>
                      </td>
                      <td className="py-2 pr-4 text-right">{c.enrolled}</td>
                      <td className="py-2 pr-4 text-right">{c.messagesSent}</td>
                      <td className="py-2 pr-4 text-right">{c.replied}</td>
                      <td className="py-2 pr-4 text-right font-medium">{c.replyRate}%</td>
                      <td className="py-2 pr-4 text-right text-green-700 font-medium">{c.positiveRate}%</td>
                      <td className="py-2 pr-4 text-right">{c.meetingsBooked}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* A/B prompt leaderboard */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-amber-600" />
            A/B Prompt Leaderboard
          </CardTitle>
        </CardHeader>
        <CardContent>
          {leaderboard.length === 0 ? (
            <p className="text-sm text-gray-500 py-6 text-center">
              No prompt variants have been used yet. Create variants in the Campaigns tab and send some messages to rank them here.
            </p>
          ) : (
            <div className="space-y-3">
              {leaderboard.map((v, i) => (
                <div key={v.id} className="flex items-start gap-3 border rounded-lg p-3">
                  <div className="w-8 h-8 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center font-bold text-sm">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-gray-900">{v.campaignName}</span>
                      <Badge variant="outline">Step {v.stepOrder + 1}</Badge>
                      <Badge className="bg-amber-100 text-amber-800">Variant {v.variant}</Badge>
                    </div>
                    <p className="text-sm text-gray-600 line-clamp-2">{v.promptPreview}</p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                      <span>Sent {v.timesUsed}</span>
                      <span>Reply rate {v.replyRate}%</span>
                      <span className="text-green-700">Positive {v.positiveRate}%</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* API cost dashboard */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-green-600" />
            AI Cost Dashboard ({costs?.periodDays ?? 30}d)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!costs ? (
            <p className="text-sm text-gray-500 py-6 text-center">Loading…</p>
          ) : costs.totalCalls === 0 ? (
            <p className="text-sm text-gray-500 py-6 text-center">
              No tracked API calls yet. Generate some messages to populate the cost dashboard.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard label="Total calls" value={costs.totalCalls.toString()} />
                <StatCard
                  label="Estimated Claude spend"
                  value={`$${costs.estimatedClaudeCostUsd}`}
                />
                <StatCard
                  label="Claude input tokens"
                  value={(costs.byProvider.claude?.inputTokens ?? 0).toLocaleString()}
                />
                <StatCard
                  label="Claude output tokens"
                  value={(costs.byProvider.claude?.outputTokens ?? 0).toLocaleString()}
                />
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-2">Calls by provider</div>
                <div className="flex items-center gap-2 flex-wrap">
                  {Object.entries(costs.byProvider).map(([provider, data]) => (
                    <Badge key={provider} variant="outline" className="text-xs">
                      {provider}: {data.calls}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="border rounded-lg p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-xl font-bold text-gray-900 mt-1">{value}</div>
    </div>
  );
}
