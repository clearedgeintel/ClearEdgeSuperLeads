import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Mail, Download, AlertTriangle, Clock, Info, Star, RefreshCw, Globe, MapPin, Upload, Trash2, Sparkles, Ban } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface LeadModalProps {
  lead: any;
  open: boolean;
  onClose: () => void;
  onOutreach: (leadId: string) => void;
  onEnrich?: (leadId: string) => void;
  onPushToHubSpot?: (leadId: string) => void;
}

export default function LeadModal({ lead, open, onClose, onOutreach, onEnrich, onPushToHubSpot }: LeadModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const gdprDeleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest('DELETE', `/api/leads/${id}/gdpr`);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/leads'] });
      toast({
        title: 'GDPR deletion complete',
        description: `Removed lead + ${data?.data?.sendLog ?? 0} send_log, ${data?.data?.engagementEvents ?? 0} events, ${data?.data?.outreachEmails ?? 0} emails.`,
      });
      onClose();
    },
    onError: (err: Error) => {
      toast({ title: 'Delete failed', description: err.message, variant: 'destructive' });
    },
  });

  const verifyEmailMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest('POST', `/api/leads/${id}/verify-email`);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/leads'] });
      const status = data?.data?.status ?? 'unknown';
      if (status === 'skipped') {
        toast({
          title: 'Verification skipped',
          description: 'HUNTER_API_KEY is not configured on the server.',
        });
      } else {
        toast({
          title: `Email ${status}`,
          description: data?.data?.reason ?? '',
          variant: status === 'undeliverable' ? 'destructive' : 'default',
        });
      }
    },
    onError: (err: Error) => {
      toast({ title: 'Verify failed', description: err.message, variant: 'destructive' });
    },
  });

  const enrichFullMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest('POST', `/api/leads/${id}/enrich-full`);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/leads'] });
      const source = data?.data?.source ?? 'none';
      if (source === 'none') {
        toast({
          title: 'No enrichment data found',
          description: 'Apollo/Hunter found nothing, or no API key is configured on the server.',
        });
      } else {
        toast({ title: `Enriched via ${source}`, description: 'Lead detail updated.' });
      }
    },
    onError: (err: Error) => {
      toast({ title: 'Enrichment failed', description: err.message, variant: 'destructive' });
    },
  });

  const suppressMutation = useMutation({
    mutationFn: async (email: string) => {
      const res = await apiRequest('POST', '/api/suppression', { email, reason: 'manual' });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/suppression'] });
      toast({
        title: 'Added to suppression list',
        description: `${lead.email} will be excluded from all outreach in this workspace.`,
      });
    },
    onError: (err: Error) => {
      toast({ title: 'Suppression failed', description: err.message, variant: 'destructive' });
    },
  });

  const generateDemoMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest('POST', `/api/leads/${id}/generate-demo`);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/leads'] });
      toast({
        title: 'Demo site generated',
        description: 'A hosted demo site is ready for this lead.',
      });
      if (data?.url) window.open(data.url, '_blank', 'noopener');
    },
    onError: (err: Error) => {
      toast({ title: 'Demo generation failed', description: err.message, variant: 'destructive' });
    },
  });

  if (!lead) return null;

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'critical': return <AlertTriangle className="h-4 w-4 text-red-500" />;
      case 'moderate': return <Clock className="h-4 w-4 text-yellow-500" />;
      case 'minor': return <Info className="h-4 w-4 text-blue-500" />;
      default: return <Info className="h-4 w-4 text-gray-500" />;
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'border-red-200 bg-red-50';
      case 'moderate': return 'border-yellow-200 bg-yellow-50';
      case 'minor': return 'border-blue-200 bg-blue-50';
      default: return 'border-gray-200 bg-gray-50';
    }
  };

  // Left rail styling. Buttons are full-width and left-aligned so the rail
  // reads as a list of actions rather than a row of chips.
  const navBtn = 'w-full justify-start gap-2 h-9 px-2 font-normal';
  const navSection =
    'px-2 pt-4 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400';

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[90vh] p-0 overflow-hidden flex flex-col">
        <DialogHeader className="shrink-0 px-6 pt-6 pb-4 border-b border-gray-200">
          <DialogTitle className="flex items-center space-x-2 flex-wrap gap-y-1">
            <span>Lead Analysis - {lead.businessName}</span>
            {lead.leadSource === 'linkedin' ? (
              <Badge className="bg-sky-100 text-sky-800 text-xs">LinkedIn</Badge>
            ) : (
              <Badge className="bg-indigo-100 text-indigo-800 text-xs">Google</Badge>
            )}
            {lead.businessStatus === 'OPERATIONAL' && (
              <Badge className="bg-green-100 text-green-800 text-xs">Open</Badge>
            )}
            {lead.businessStatus === 'CLOSED_TEMPORARILY' && (
              <Badge className="bg-yellow-100 text-yellow-800 text-xs">Temp Closed</Badge>
            )}
            {lead.businessStatus === 'CLOSED_PERMANENTLY' && (
              <Badge className="bg-red-100 text-red-800 text-xs">Permanently Closed</Badge>
            )}
            {/* Phase 8 — Hunter.io email verification badge */}
            {lead.emailVerified === 'deliverable' && (
              <Badge className="bg-green-100 text-green-800 text-xs">Email verified</Badge>
            )}
            {lead.emailVerified === 'risky' && (
              <Badge className="bg-yellow-100 text-yellow-800 text-xs">Email risky</Badge>
            )}
            {lead.emailVerified === 'undeliverable' && (
              <Badge className="bg-red-100 text-red-800 text-xs">Email undeliverable</Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col md:flex-row flex-1 min-h-0">
          {/* Left action rail. Previously a single non-wrapping flex row under
              the content, which overflowed the dialog once a lead had enough
              applicable actions. */}
          <aside className="w-full md:w-60 shrink-0 overflow-y-auto border-b md:border-b-0 md:border-r border-gray-200 bg-gray-50/60 p-3">
            <p className={`${navSection} pt-1`}>Outreach</p>

            {lead.email && lead.status !== 'contacted' && (
              <Button
                size="sm"
                className={navBtn}
                onClick={() => onOutreach(lead.id)}
              >
                <Mail className="h-4 w-4" />
                Send outreach email
              </Button>
            )}
            {!lead.email && (
              <p className="px-2 py-1.5 text-xs leading-relaxed text-gray-500">
                No email found.{' '}
                {onEnrich && !lead.enrichedAt ? (
                  <button
                    onClick={() => onEnrich(lead.id)}
                    className="font-medium text-orange-600 hover:underline"
                  >
                    Try enriching this lead.
                  </button>
                ) : (
                  'Discovery did not turn up a contact.'
                )}
              </p>
            )}
            {lead.email && (
              <Button
                variant="ghost"
                size="sm"
                className={`${navBtn} text-amber-700 hover:bg-amber-50 hover:text-amber-800`}
                onClick={() => {
                  if (confirm(`Add ${lead.email} to the suppression list? They will be permanently excluded from all outreach in this workspace.`)) {
                    suppressMutation.mutate(lead.email);
                  }
                }}
                disabled={suppressMutation.isPending}
              >
                <Ban className="h-4 w-4" />
                Suppress
              </Button>
            )}

            <p className={navSection}>Enrichment</p>

            {lead.email && !lead.emailVerified && (
              <Button
                variant="ghost"
                size="sm"
                className={navBtn}
                onClick={() => verifyEmailMutation.mutate(lead.id)}
                disabled={verifyEmailMutation.isPending}
              >
                <RefreshCw className={`h-4 w-4 ${verifyEmailMutation.isPending ? 'animate-spin' : ''}`} />
                Verify email
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className={`${navBtn} text-orange-600 hover:bg-orange-50 hover:text-orange-700`}
              onClick={() => enrichFullMutation.mutate(lead.id)}
              disabled={enrichFullMutation.isPending}
            >
              <Sparkles className={`h-4 w-4 ${enrichFullMutation.isPending ? 'animate-pulse' : ''}`} />
              Enrich with Apollo
            </Button>
            {onEnrich && !lead.enrichedAt && (
              <Button
                variant="ghost"
                size="sm"
                className={`${navBtn} text-orange-600 hover:bg-orange-50 hover:text-orange-700`}
                onClick={() => onEnrich(lead.id)}
              >
                <RefreshCw className="h-4 w-4" />
                Enrich with Places API
              </Button>
            )}

            <p className={navSection}>Publish</p>

            {onPushToHubSpot && (
              lead.hubspotCompanyId ? (
                <div className="flex h-9 items-center gap-2 px-2 text-sm text-purple-700">
                  <Upload className="h-4 w-4" />
                  In HubSpot
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className={`${navBtn} text-purple-600 hover:bg-purple-50 hover:text-purple-700`}
                  onClick={() => onPushToHubSpot(lead.id)}
                >
                  <Upload className="h-4 w-4" />
                  Push to HubSpot
                </Button>
              )
            )}
            <Button
              variant="ghost"
              size="sm"
              className={`${navBtn} text-sky-600 hover:bg-sky-50 hover:text-sky-700`}
              onClick={() => generateDemoMutation.mutate(lead.id)}
              disabled={generateDemoMutation.isPending}
            >
              <Globe className={`h-4 w-4 ${generateDemoMutation.isPending ? 'animate-pulse' : ''}`} />
              {generateDemoMutation.isPending
                ? 'Generating…'
                : lead.demoSiteUrl
                  ? 'Regenerate demo'
                  : 'Generate demo site'}
            </Button>
            {lead.demoSiteUrl && (
              <a
                href={lead.demoSiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-9 items-center gap-2 rounded-md px-2 text-sm text-sky-700 hover:bg-sky-50"
              >
                <Globe className="h-4 w-4" />
                View demo site
              </a>
            )}

            <p className={navSection}>Data</p>

            <Button
              variant="ghost"
              size="sm"
              className={navBtn}
              onClick={() => {
                const data = JSON.stringify(lead, null, 2);
                const blob = new Blob([data], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `lead-${lead.businessName.replace(/\s+/g, '-').toLowerCase()}.json`;
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              <Download className="h-4 w-4" />
              Export JSON
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={`${navBtn} text-red-600 hover:bg-red-50 hover:text-red-700`}
              onClick={() => {
                const confirmMessage = `Permanently delete all data for ${lead.businessName}?\n\nThis wipes the lead plus every send_log, engagement_event, send_queue, outreach_email, and enrollment row that references it. This action is irreversible and logged to audit_log under action='gdpr_delete'.`;
                if (confirm(confirmMessage)) {
                  gdprDeleteMutation.mutate(lead.id);
                }
              }}
              disabled={gdprDeleteMutation.isPending}
            >
              <Trash2 className="h-4 w-4" />
              GDPR delete
            </Button>
          </aside>

          {/* Detail pane — scrolls independently of the rail */}
          <div className="flex-1 min-w-0 overflow-y-auto p-6 space-y-6">
          {/* Business Info + Rating */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="font-semibold text-gray-900 mb-3">Business Information</h3>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-600">Name:</span>
                  <span className="font-medium">{lead.businessName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Category:</span>
                  <span className="font-medium capitalize">{lead.category || 'Unknown'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Phone:</span>
                  <span className="font-medium">{lead.phone || 'Not provided'}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Email:</span>
                  <span className="font-medium">
                    {lead.email ? (
                      <span className="text-green-600">
                        {lead.email}
                        {lead.emailSource && (
                          <span className="text-xs text-gray-400 ml-1">({lead.emailSource})</span>
                        )}
                      </span>
                    ) : (
                      'Not found'
                    )}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600 flex items-center">
                    <MapPin className="h-3.5 w-3.5 mr-1" />Address:
                  </span>
                  <span className="font-medium text-right max-w-[200px]">{lead.address || 'Not provided'}</span>
                </div>
                {lead.website && (
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600 flex items-center">
                      <Globe className="h-3.5 w-3.5 mr-1" />Website:
                    </span>
                    <a
                      href={lead.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-blue-600 hover:text-blue-800 truncate max-w-[200px]"
                    >
                      {new URL(lead.website).hostname}
                    </a>
                  </div>
                )}
              </div>

              {/* Rating & Reviews */}
              {lead.rating && (
                <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center space-x-3">
                    <div className="flex items-center">
                      <Star className="h-5 w-5 text-yellow-500 fill-yellow-500" />
                      <span className="text-xl font-bold ml-1">{parseFloat(lead.rating).toFixed(1)}</span>
                    </div>
                    {lead.totalReviews != null && (
                      <span className="text-sm text-gray-500">{lead.totalReviews} reviews</span>
                    )}
                  </div>
                </div>
              )}

              {/* Business Hours */}
              {lead.businessHours && Array.isArray(lead.businessHours) && lead.businessHours.length > 0 && (
                <div className="mt-4">
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Business Hours</h4>
                  <div className="text-xs text-gray-600 space-y-0.5">
                    {lead.businessHours.map((line: string, i: number) => (
                      <div key={i}>{line}</div>
                    ))}
                  </div>
                </div>
              )}

              {/* Google Place ID */}
              {lead.googlePlaceId && (
                <div className="mt-3 text-xs text-gray-400">
                  Place ID: {lead.googlePlaceId}
                </div>
              )}
            </div>

            <div>
              <h3 className="font-semibold text-gray-900 mb-3">AI Analysis Score</h3>
              <div className="text-center">
                {lead.aiScore !== null ? (
                  <>
                    <div className={`text-4xl font-bold mb-2 ${
                      lead.aiScore < 40 ? 'text-red-600' :
                      lead.aiScore < 70 ? 'text-yellow-600' : 'text-green-600'
                    }`}>
                      {lead.aiScore}/100
                    </div>
                    <div className="text-sm text-gray-600 mb-4">
                      {lead.priority === 'high' ? 'High Priority for Cleanup' :
                       lead.priority === 'medium' ? 'Medium Priority for Cleanup' :
                       'Low Priority for Cleanup'}
                    </div>
                    <Progress value={lead.aiScore} className="w-full" />
                  </>
                ) : (
                  <div className="py-8">
                    <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-gray-600">AI analysis in progress...</p>
                  </div>
                )}
              </div>

              {/* Enrichment status. The action itself now lives in the left
                  rail, so this is a status line only. */}
              <div className="mt-4 text-center">
                {lead.enrichedAt ? (
                  <p className="text-xs text-gray-400">
                    Enriched on {new Date(lead.enrichedAt).toLocaleDateString()}
                  </p>
                ) : (
                  <p className="text-xs text-gray-400">Not yet enriched</p>
                )}
              </div>
            </div>
          </div>

          {/* AI Recommendations */}
          {lead.aiAnalysis?.issues && (
            <div>
              <h3 className="font-semibold text-gray-900 mb-3">AI Recommendations</h3>
              <div className="space-y-3">
                {lead.aiAnalysis.issues.map((issue: any, index: number) => (
                  <div
                    key={index}
                    className={`border rounded-lg p-4 ${getSeverityColor(issue.severity)}`}
                  >
                    <div className="flex items-start space-x-3">
                      {getSeverityIcon(issue.severity)}
                      <div className="flex-1">
                        <div className="font-medium text-gray-900 capitalize">
                          {issue.severity}: {issue.category}
                        </div>
                        <div className="text-sm text-gray-600 mt-1">
                          {issue.description}
                        </div>
                        {issue.recommendation && (
                          <div className="text-sm text-gray-700 mt-2 font-medium">
                            Recommendation: {issue.recommendation}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {lead.aiAnalysis.summary && (
                <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <h4 className="font-medium text-blue-900 mb-2">Summary</h4>
                  <p className="text-sm text-blue-800">{lead.aiAnalysis.summary}</p>
                </div>
              )}
            </div>
          )}

          {lead.status === 'contacted' && (
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
              <div className="flex items-center space-x-2">
                <Mail className="h-4 w-4 text-green-600" />
                <span className="text-sm font-medium text-green-800">
                  Outreach email sent
                  {lead.lastContactedAt && (
                    <span className="ml-1">
                      on {new Date(lead.lastContactedAt).toLocaleDateString()}
                    </span>
                  )}
                </span>
              </div>
            </div>
          )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
