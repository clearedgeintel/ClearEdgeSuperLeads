import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Mail, Loader2, RefreshCw } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface OutreachPreviewModalProps {
  lead: any;
  open: boolean;
  onClose: () => void;
  onSent: () => void;
}

export default function OutreachPreviewModal({ lead, open, onClose, onSent }: OutreachPreviewModalProps) {
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const { toast } = useToast();

  // Generate preview when modal opens
  useEffect(() => {
    if (open && lead) {
      generatePreview();
    } else {
      setSubject('');
      setContent('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lead?.id]);

  const generatePreview = async () => {
    if (!lead) return;
    setIsGenerating(true);
    try {
      const response = await apiRequest('POST', `/api/outreach/${lead.id}/preview`);
      const data = await response.json();
      setSubject(data.subject);
      setContent(data.content);
    } catch (error: any) {
      toast({
        title: "Preview Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const sendMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', `/api/outreach/${lead.id}`, {
        subject,
        content,
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Email Sent",
        description: `Outreach email sent to ${lead.email}`,
      });
      onSent();
      onClose();
    },
    onError: (error: any) => {
      toast({
        title: "Send Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  if (!lead) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <Mail className="h-5 w-5" />
            <span>Outreach Preview - {lead.businessName}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="text-sm text-gray-600 bg-gray-50 p-3 rounded">
            <span className="font-medium">To:</span> {lead.email}
          </div>

          {isGenerating ? (
            <div className="py-12 text-center">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3 text-primary" />
              <p className="text-gray-600">Generating email with Claude...</p>
            </div>
          ) : (
            <>
              <div>
                <Label htmlFor="preview-subject">Subject</Label>
                <Input
                  id="preview-subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="mt-1"
                />
              </div>

              <div>
                <Label htmlFor="preview-content">Email Body</Label>
                <Textarea
                  id="preview-content"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={14}
                  className="mt-1 font-sans text-sm"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Edit freely before sending. Markdown-style **bold** and *italic* will be converted to HTML.
                </p>
              </div>
            </>
          )}

          <div className="flex space-x-3 pt-4 border-t border-gray-200">
            <Button
              onClick={() => sendMutation.mutate()}
              disabled={isGenerating || sendMutation.isPending || !subject || !content}
              className="flex-1"
            >
              {sendMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Mail className="h-4 w-4 mr-2" />
              )}
              Send Email
            </Button>
            <Button
              variant="outline"
              onClick={generatePreview}
              disabled={isGenerating || sendMutation.isPending}
              title="Regenerate with Claude"
            >
              <RefreshCw className={`h-4 w-4 ${isGenerating ? 'animate-spin' : ''}`} />
            </Button>
            <Button
              variant="outline"
              onClick={onClose}
              disabled={sendMutation.isPending}
            >
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
