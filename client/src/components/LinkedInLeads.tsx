import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Search, Linkedin, Save, UserPlus } from "lucide-react";

interface SearchProfile {
  linkedinUrl: string | null;
  fullName: string | null;
  headline: string | null;
  location: string | null;
  industry: string | null;
  connectionDegree: number | null;
  memberId: string | null;
  profilePicture: string | null;
  publicIdentifier: string | null;
}

export default function LinkedInLeads() {
  const [query, setQuery] = useState("");
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [industry, setIndustry] = useState("");
  const [location, setLocation] = useState("");
  const [profiles, setProfiles] = useState<SearchProfile[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [total, setTotal] = useState<number | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const searchMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/linkedin/search", {
        query,
        title,
        company,
        industry,
        location,
      });
      return res.json();
    },
    onSuccess: (data) => {
      if (data?.success) {
        setProfiles(data.profiles ?? []);
        setTotal(data.total ?? null);
        setSelected(new Set());
        setRemaining(null);
      }
    },
    onError: async (err: Error) => {
      // 429 rate limit surfaces `remaining` in the error body
      const match = err.message.match(/^429:\s*(.+)$/);
      if (match) {
        try {
          const body = JSON.parse(match[1]);
          if (typeof body.remaining === "number") setRemaining(body.remaining);
        } catch {
          /* non-JSON body */
        }
      }
      toast({
        title: "Search failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const picked = profiles.filter((p) => p.linkedinUrl && selected.has(p.linkedinUrl));
      const res = await apiRequest("POST", "/api/linkedin/search/save", {
        profiles: picked,
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      toast({
        title: "Saved",
        description: `${data?.data?.saved ?? 0} saved, ${data?.data?.skipped ?? 0} already existed, ${data?.data?.errors ?? 0} errors.`,
      });
      setSelected(new Set());
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  function toggle(url: string | null) {
    if (!url) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === profiles.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(profiles.map((p) => p.linkedinUrl).filter((u): u is string => !!u)));
    }
  }

  const selectedCount = selected.size;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Linkedin className="h-6 w-6 text-sky-600" />
          LinkedIn Leads
        </h1>
        <p className="text-sm text-gray-600 mt-1">
          Search LinkedIn via Unipile, save prospects as leads, and enroll them into multi-step campaigns.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Search Prospects</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input
              placeholder="Keywords (e.g. sales operations)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Input
              placeholder="Job title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <Input
              placeholder="Company"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
            />
            <Input
              placeholder="Industry"
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
            />
            <Input
              placeholder="Location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="md:col-span-2"
            />
          </div>
          <div className="flex items-center justify-between mt-4">
            <div className="text-sm text-gray-500">
              {total !== null && <span>{total} results found.</span>}
              {remaining !== null && (
                <span className="text-red-600 ml-2">Rate limited. {remaining} searches remaining this hour.</span>
              )}
            </div>
            <Button
              onClick={() => searchMutation.mutate()}
              disabled={searchMutation.isPending}
            >
              <Search className="h-4 w-4 mr-2" />
              {searchMutation.isPending ? "Searching..." : "Search"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {profiles.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Results ({profiles.length})</CardTitle>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={toggleAll}
                >
                  {selected.size === profiles.length ? "Clear" : "Select all"}
                </Button>
                <Button
                  size="sm"
                  disabled={selectedCount === 0 || saveMutation.isPending}
                  onClick={() => saveMutation.mutate()}
                >
                  <Save className="h-4 w-4 mr-2" />
                  Save {selectedCount > 0 ? `(${selectedCount})` : ""}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {profiles.map((p) => (
                <div
                  key={p.linkedinUrl ?? p.memberId ?? Math.random()}
                  className="flex items-start gap-3 p-3 border rounded-lg hover:bg-gray-50"
                >
                  <Checkbox
                    checked={p.linkedinUrl ? selected.has(p.linkedinUrl) : false}
                    onCheckedChange={() => toggle(p.linkedinUrl)}
                    disabled={!p.linkedinUrl}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="font-medium text-gray-900">{p.fullName ?? "Unknown"}</div>
                      {p.connectionDegree !== null && (
                        <Badge variant="outline" className="text-xs">
                          {p.connectionDegree}° connection
                        </Badge>
                      )}
                    </div>
                    {p.headline && <div className="text-sm text-gray-600 truncate">{p.headline}</div>}
                    <div className="text-xs text-gray-500 mt-1">
                      {[p.location, p.industry].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  {p.linkedinUrl && (
                    <a
                      href={p.linkedinUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sky-600 text-sm hover:underline whitespace-nowrap"
                    >
                      View profile
                    </a>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {profiles.length === 0 && !searchMutation.isPending && (
        <Card>
          <CardContent className="py-12 text-center">
            <UserPlus className="h-12 w-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-600 font-medium">No results yet</p>
            <p className="text-sm text-gray-500 mt-1">
              Fill in the search fields above to find LinkedIn prospects via Unipile.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
