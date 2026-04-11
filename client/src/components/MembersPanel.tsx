import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Users, Trash2 } from "lucide-react";

interface Member {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  role: string | null;
}

export default function MembersPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data } = useQuery<{ success: boolean; data: Member[] }>({
    queryKey: ["/api/workspace/members"],
  });
  const members = data?.data ?? [];

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
        <p className="text-xs text-gray-500 mt-3">
          Invite flow (email link) lands in a Phase 9 follow-up. For now, members are created
          automatically on their first Google login within the workspace.
        </p>
      </CardContent>
    </Card>
  );
}
