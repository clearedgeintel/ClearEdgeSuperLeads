import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Mail, Download, AlertTriangle, Clock, Info, Star, RefreshCw, Globe, MapPin, Upload } from "lucide-react";

interface LeadModalProps {
  lead: any;
  open: boolean;
  onClose: () => void;
  onOutreach: (leadId: string) => void;
  onEnrich?: (leadId: string) => void;
  onPushToHubSpot?: (leadId: string) => void;
}

export default function LeadModal({ lead, open, onClose, onOutreach, onEnrich, onPushToHubSpot }: LeadModalProps) {
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

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <span>Lead Analysis - {lead.businessName}</span>
            {lead.businessStatus === 'OPERATIONAL' && (
              <Badge className="bg-green-100 text-green-800 text-xs">Open</Badge>
            )}
            {lead.businessStatus === 'CLOSED_TEMPORARILY' && (
              <Badge className="bg-yellow-100 text-yellow-800 text-xs">Temp Closed</Badge>
            )}
            {lead.businessStatus === 'CLOSED_PERMANENTLY' && (
              <Badge className="bg-red-100 text-red-800 text-xs">Permanently Closed</Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
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

              {/* Enrichment status */}
              <div className="mt-4 text-center">
                {lead.enrichedAt ? (
                  <p className="text-xs text-gray-400">
                    Enriched on {new Date(lead.enrichedAt).toLocaleDateString()}
                  </p>
                ) : (
                  onEnrich && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onEnrich(lead.id)}
                      className="text-orange-600 border-orange-200 hover:bg-orange-50"
                    >
                      <RefreshCw className="h-3.5 w-3.5 mr-1" />
                      Enrich with Places API
                    </Button>
                  )
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

          {/* Action Buttons */}
          <div className="flex space-x-4 pt-4 border-t border-gray-200">
            {onPushToHubSpot && (
              lead.hubspotCompanyId ? (
                <div className="flex items-center justify-center space-x-2 px-4 py-2 bg-purple-50 text-purple-700 rounded-md text-sm">
                  <Upload className="h-4 w-4" />
                  <span>In HubSpot</span>
                </div>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => onPushToHubSpot(lead.id)}
                  className="flex items-center justify-center space-x-2 text-purple-600 border-purple-200 hover:bg-purple-50"
                >
                  <Upload className="h-4 w-4" />
                  <span>Push to HubSpot</span>
                </Button>
              )
            )}
            {lead.email && lead.status !== 'contacted' && (
              <Button
                onClick={() => onOutreach(lead.id)}
                className="flex-1 flex items-center justify-center space-x-2"
              >
                <Mail className="h-4 w-4" />
                <span>Send Outreach Email</span>
              </Button>
            )}
            {!lead.email && (
              <div className="flex-1 p-3 bg-gray-50 border border-gray-200 rounded-lg text-center text-sm text-gray-500">
                No email found — {onEnrich && !lead.enrichedAt ? (
                  <button
                    onClick={() => onEnrich(lead.id)}
                    className="text-orange-600 hover:underline font-medium"
                  >
                    try enriching this lead
                  </button>
                ) : (
                  'email discovery did not find a contact'
                )}
              </div>
            )}
            <Button
              variant="outline"
              className="flex items-center justify-center space-x-2"
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
              <span>Export</span>
            </Button>
          </div>

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
      </DialogContent>
    </Dialog>
  );
}
