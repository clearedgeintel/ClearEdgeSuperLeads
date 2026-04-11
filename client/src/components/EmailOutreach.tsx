import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Mail, Eye, ExternalLink, Inbox, Send } from "lucide-react";

interface SentEmail {
  id: string;
  leadId: string;
  recipientEmail: string;
  subject: string;
  content: string;
  status: string;
  sentAt: string | null;
  openedAt: string | null;
  repliedAt: string | null;
  emailProvider: string;
  businessName: string | null;
  website: string | null;
}

export default function EmailOutreach() {
  const [selectedEmail, setSelectedEmail] = useState<SentEmail | null>(null);

  const { data: emails = [], isLoading } = useQuery<SentEmail[]>({
    queryKey: ['/api/outreach/sent'],
  });

  const getStatusBadge = (email: SentEmail) => {
    if (email.repliedAt) return <Badge className="bg-green-100 text-green-800">Replied</Badge>;
    if (email.openedAt) return <Badge className="bg-blue-100 text-blue-800">Opened</Badge>;
    if (email.status === 'sent') return <Badge className="bg-gray-100 text-gray-800">Sent</Badge>;
    return <Badge className="bg-gray-100 text-gray-800">{email.status}</Badge>;
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  // Stats
  const total = emails.length;
  const opened = emails.filter(e => e.openedAt).length;
  const replied = emails.filter(e => e.repliedAt).length;
  const openRate = total > 0 ? Math.round((opened / total) * 100) : 0;
  const replyRate = total > 0 ? Math.round((replied / total) * 100) : 0;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Loading sent emails...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Sent</p>
                <p className="text-2xl font-bold text-gray-900">{total}</p>
              </div>
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                <Send className="h-5 w-5 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Opened</p>
                <p className="text-2xl font-bold text-blue-600">{opened}</p>
                <p className="text-xs text-gray-400">{openRate}% open rate</p>
              </div>
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                <Eye className="h-5 w-5 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Replied</p>
                <p className="text-2xl font-bold text-green-600">{replied}</p>
                <p className="text-xs text-gray-400">{replyRate}% reply rate</p>
              </div>
              <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                <Inbox className="h-5 w-5 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Provider</p>
                <p className="text-lg font-bold text-gray-900 capitalize">
                  {emails[0]?.emailProvider || 'Gmail'}
                </p>
              </div>
              <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                <Mail className="h-5 w-5 text-purple-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Sent emails list */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Mail className="h-5 w-5" />
            <span>Sent Emails</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {emails.length === 0 ? (
            <div className="p-8 text-center">
              <Mail className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No emails sent yet</h3>
              <p className="text-gray-600">Click "Contact" on a lead in Lead Discovery to send your first outreach email.</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {emails.map((email) => (
                <button
                  key={email.id}
                  onClick={() => setSelectedEmail(email)}
                  className="w-full px-6 py-4 hover:bg-gray-50 transition-colors text-left"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-gray-900 truncate">
                          {email.businessName || 'Unknown business'}
                        </span>
                        {getStatusBadge(email)}
                      </div>
                      <div className="text-sm text-gray-600 truncate">
                        {email.recipientEmail}
                      </div>
                      <div className="text-sm text-gray-900 font-medium mt-1 truncate">
                        {email.subject}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-xs text-gray-500">{formatDate(email.sentAt)}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Email detail modal */}
      <Dialog open={!!selectedEmail} onOpenChange={() => setSelectedEmail(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {selectedEmail && (
            <>
              <DialogHeader>
                <DialogTitle>{selectedEmail.subject}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm bg-gray-50 p-3 rounded">
                  <div>
                    <span className="text-gray-500">Business:</span>
                    <div className="font-medium">{selectedEmail.businessName || 'Unknown'}</div>
                  </div>
                  <div>
                    <span className="text-gray-500">Recipient:</span>
                    <div className="font-medium">{selectedEmail.recipientEmail}</div>
                  </div>
                  <div>
                    <span className="text-gray-500">Sent:</span>
                    <div className="font-medium">
                      {selectedEmail.sentAt ? new Date(selectedEmail.sentAt).toLocaleString() : '—'}
                    </div>
                  </div>
                  <div>
                    <span className="text-gray-500">Status:</span>
                    <div>{getStatusBadge(selectedEmail)}</div>
                  </div>
                  {selectedEmail.openedAt && (
                    <div>
                      <span className="text-gray-500">Opened:</span>
                      <div className="font-medium">{new Date(selectedEmail.openedAt).toLocaleString()}</div>
                    </div>
                  )}
                  {selectedEmail.repliedAt && (
                    <div>
                      <span className="text-gray-500">Replied:</span>
                      <div className="font-medium">{new Date(selectedEmail.repliedAt).toLocaleString()}</div>
                    </div>
                  )}
                </div>

                {selectedEmail.website && (
                  <a
                    href={selectedEmail.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center text-sm text-blue-600 hover:text-blue-800"
                  >
                    Visit website <ExternalLink className="h-3 w-3 ml-1" />
                  </a>
                )}

                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Email Body</h4>
                  <div className="p-4 bg-white border border-gray-200 rounded whitespace-pre-wrap text-sm font-sans">
                    {selectedEmail.content}
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
