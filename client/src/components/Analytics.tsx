import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, Users, Mail, DollarSign, BarChart } from "lucide-react";

interface AnalyticsSummary {
  totalLeads: number;
  highPriorityLeads: number;
  contactedLeads: number;
  totalCampaigns: number;
  totalEmailsSent: number;
  totalOpened: number;
  totalReplied: number;
}

export default function Analytics() {
  const { data: summary, isLoading } = useQuery<AnalyticsSummary>({
    queryKey: ['/api/analytics/summary'],
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="p-8 text-center">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-gray-600">Loading analytics...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="p-8 text-center">
            <BarChart className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No data available</h3>
            <p className="text-gray-600">
              Start discovering leads and running campaigns to see analytics.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const conversionRate = summary.totalLeads > 0 ? 
    ((summary.contactedLeads / summary.totalLeads) * 100).toFixed(1) : '0';

  const openRate = summary.totalEmailsSent > 0 ? 
    ((summary.totalOpened / summary.totalEmailsSent) * 100).toFixed(1) : '0';

  const replyRate = summary.totalEmailsSent > 0 ? 
    ((summary.totalReplied / summary.totalEmailsSent) * 100).toFixed(1) : '0';

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <BarChart className="h-5 w-5" />
            <span>Performance Analytics</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div className="text-center">
              <div className="text-2xl font-bold text-primary">{summary.totalLeads}</div>
              <div className="text-sm text-gray-600">Total Leads</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">{summary.contactedLeads}</div>
              <div className="text-sm text-gray-600">Contacts Made</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-yellow-600">{conversionRate}%</div>
              <div className="text-sm text-gray-600">Conversion Rate</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600">{summary.totalEmailsSent}</div>
              <div className="text-sm text-gray-600">Emails Sent</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Detailed Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">High Priority Leads</p>
                <p className="text-2xl font-bold text-red-600">{summary.highPriorityLeads}</p>
              </div>
              <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center">
                <TrendingUp className="h-5 w-5 text-red-600" />
              </div>
            </div>
            <div className="mt-2">
              <p className="text-xs text-gray-500">
                {summary.totalLeads > 0 ? 
                  `${((summary.highPriorityLeads / summary.totalLeads) * 100).toFixed(1)}% of total` : 
                  'No leads yet'
                }
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Email Open Rate</p>
                <p className="text-2xl font-bold text-blue-600">{openRate}%</p>
              </div>
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                <Mail className="h-5 w-5 text-blue-600" />
              </div>
            </div>
            <div className="mt-2">
              <p className="text-xs text-gray-500">
                {summary.totalOpened} of {summary.totalEmailsSent} emails opened
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Reply Rate</p>
                <p className="text-2xl font-bold text-green-600">{replyRate}%</p>
              </div>
              <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                <Users className="h-5 w-5 text-green-600" />
              </div>
            </div>
            <div className="mt-2">
              <p className="text-xs text-gray-500">
                {summary.totalReplied} responses received
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Active Campaigns</p>
                <p className="text-2xl font-bold text-purple-600">{summary.totalCampaigns}</p>
              </div>
              <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                <BarChart className="h-5 w-5 text-purple-600" />
              </div>
            </div>
            <div className="mt-2">
              <p className="text-xs text-gray-500">
                Total outreach campaigns
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Performance Insights */}
      <Card>
        <CardHeader>
          <CardTitle>Performance Insights</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {summary.totalLeads === 0 ? (
              <div className="text-center py-8">
                <TrendingUp className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">Start Discovering Leads</h3>
                <p className="text-gray-600">
                  Begin by searching for businesses to see detailed performance analytics.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-start space-x-3">
                  <div className="w-2 h-2 bg-green-500 rounded-full mt-2" />
                  <div>
                    <h4 className="font-medium text-gray-900">Lead Discovery</h4>
                    <p className="text-sm text-gray-600">
                      You've discovered {summary.totalLeads} potential leads with {summary.highPriorityLeads} requiring immediate attention.
                    </p>
                  </div>
                </div>
                
                {summary.totalEmailsSent > 0 && (
                  <div className="flex items-start space-x-3">
                    <div className="w-2 h-2 bg-blue-500 rounded-full mt-2" />
                    <div>
                      <h4 className="font-medium text-gray-900">Email Performance</h4>
                      <p className="text-sm text-gray-600">
                        Your emails are performing {parseFloat(openRate) > 20 ? 'well' : 'below average'} with a {openRate}% open rate and {replyRate}% reply rate.
                      </p>
                    </div>
                  </div>
                )}
                
                <div className="flex items-start space-x-3">
                  <div className="w-2 h-2 bg-yellow-500 rounded-full mt-2" />
                  <div>
                    <h4 className="font-medium text-gray-900">Conversion Opportunities</h4>
                    <p className="text-sm text-gray-600">
                      Focus on converting your {summary.totalLeads - summary.contactedLeads} uncontacted leads to maximize your pipeline.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
