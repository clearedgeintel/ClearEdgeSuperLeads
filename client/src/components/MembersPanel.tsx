import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Users, Trash2, Mail, Send } from "lucide-react";

interface Member {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  role: string | null;
}

interface Invitation {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
  createdAt: string;
}

export default function MembersPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");

  const { data } = useQuery<{ success: boolean; data: Member[] }>({
    queryKey: ["/api/workspace/members"],
  });
  const members = data?.data ?? [];

  const { data: invitesData } = useQuery<{ success: boolean; data: Invitation[] }>({
    queryKey: ["/api/workspace/invitations"],
  });
  const invitations = invitesData?.data ?? [];

  const sendInvite = useMutation({
    mutationFn: async ({ email, role }: { email: string; role: string }) => {
      const res = await apiRequest("POST", "/api/workspace/invitations", { email, role });
      return res.json();
    },
    onSuccess: (resp: { data?: { emailSent?: boolean; inviteUrl?: string } }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/workspace/invitations"] });
      setInviteEmail("");
      setInviteRole("member");
      if (resp?.data?.emailSent) {
        toast({ title: "Invitation sent" });
      } else {
        toast({
          title: "Invitation created — email not sent",
          description: resp?.data?.inviteUrl
            ? `Email isn't configured. Share this link manually: ${resp.data.inviteUrl}`
            : "Email transport isn't configured.",
        });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Invite failed", description: err.message, variant: "destructive" });
    },
  });

  const revokeInvite = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/workspace/invitations/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workspace/invitations"] });
      toast({ title: "Invitation revoked" });
    },
    onError: (err: Error) => {
      toast({ title: "Revoke failed", description: err.message, variant: "destructive" });
    },
  });

  const updateRole = useMutation({
    mutationFn: async ({ id, role }: { id: string; role: string }) => {
      const res = await apiRequest("PATCH", `/api/workspace/members/${id}`, { role });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workspace/members"] });
      toast({ title: "Role updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  const removeMember = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/workspace/members/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workspace/members"] });
      toast({ title: "Member removed" });
    },
    onError: (err: Error) => {
      toast({ title: "Remove failed", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5 text-indigo-600" />
          Members
        </CardTitle>
      </CardHeader>
      <CardContent>
        {members.length === 0 ? (
          <p className="text-sm text-gray-500">No members yet.</p>
        ) : (
          <div className="space-y-2">
            {members.map((m) => (
              <div key={m.id} className="flex items-center justify-between border rounded-lg p-3">
                <div className="min-w-0">
                  <div className="font-medium text-gray-900 truncate">
                    {m.firstName || m.lastName ? `${m.firstName ?? ""} ${m.lastName ?? ""}`.trim() : m.email}
                  </div>
                  {m.email && <div className="text-xs text-gray-500 truncate">{m.email}</div>}
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={m.role === "admin" ? "bg-purple-100 text-purple-700" : "bg-gray-100 text-gray-700"}>
                    {m.role ?? "member"}
                  </Badge>
                  <Select
                    value={m.role ?? "member"}
                    onValueChange={(role) => updateRole.mutate({ id: m.id, role })}
                  >
                    <SelectTrigger className="w-28 h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="member">member</SelectItem>
                      <SelectItem value="admin">admin</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (confirm(`Remove ${m.email ?? m.id} from the workspace?`)) {
                        removeMember.mutate(m.id);
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        {/* Invite a teammate */}
        <div className="mt-5 border-t pt-4">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
            <Mail className="h-4 w-4 text-indigo-600" />
            Invite a teammate
          </div>
          <form
            className="flex flex-col sm:flex-row gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const email = inviteEmail.trim();
              if (!email || !email.includes("@")) {
                toast({ title: "Enter a valid email", variant: "destructive" });
                return;
              }
              sendInvite.mutate({ email, role: inviteRole });
            }}
          >
            <Input
              type="email"
              placeholder="teammate@company.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className="flex-1"
            />
            <Select value={inviteRole} onValueChange={setInviteRole}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">member</SelectItem>
                <SelectItem value="admin">admin</SelectItem>
              </SelectContent>
            </Select>
            <Button type="submit" disabled={sendInvite.isPending}>
              <Send className="h-4 w-4 mr-2" />
              {sendInvite.isPending ? "Sending…" : "Invite"}
            </Button>
          </form>
          <p className="text-xs text-gray-500 mt-2">
            The invitee gets an email with a sign-in link and joins this workspace after logging
            in with Google. Invites expire in 7 days.
          </p>
        </div>

        {/* Pending invitations */}
        {invitations.length > 0 && (
          <div className="mt-4">
            <div className="text-sm font-medium text-gray-700 mb-2">Pending invitations</div>
            <div className="space-y-2">
              {invitations.map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center justify-between border rounded-lg p-3 bg-gray-50"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-gray-900 truncate">{inv.email}</div>
                    <div className="text-xs text-gray-500">
                      invited as {inv.role} · expires {new Date(inv.expiresAt).toLocaleDateString()}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (confirm(`Revoke the invitation for ${inv.email}?`)) {
                        revokeInvite.mutate(inv.id);
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
