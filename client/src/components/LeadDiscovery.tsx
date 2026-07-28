import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { isUnauthorizedError } from "@/lib/authUtils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, Users, AlertTriangle, Clock, Eye, Mail, Star, RefreshCw, Upload, Filter, ArrowDown, ArrowUp, X, FileUp, Copy, Sparkles } from "lucide-react";
import { prescoreLead } from "@shared/leadPrescore";
import LeadModal from "./LeadModal";
import OutreachPreviewModal from "./OutreachPreviewModal";
import LeadImportModal from "./LeadImportModal";

type SortKey = 'prescore' | 'aiScore' | 'rating' | 'totalReviews' | 'businessName' | 'discoveredAt';
type SortOrder = 'asc' | 'desc';
type YesNoAll = 'all' | 'yes' | 'no';

// Server caps a single analyze request at 50 leads.
const MAX_ANALYZE_BATCH = 50;

export default function LeadDiscovery() {
  const [searchQuery, setSearchQuery] = useState('');
  const [location, setLocation] = useState('');
  const [selectedLead, setSelectedLead] = useState<any>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [outreachLead, setOutreachLead] = useState<any>(null);
  const [isOutreachOpen, setIsOutreachOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);

  // Filter & sort state
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [emailFilter, setEmailFilter] = useState<YesNoAll>('all');
  const [hubspotFilter, setHubspotFilter] = useState<YesNoAll>('all');
  const [sortBy, setSortBy] = useState<SortKey>('prescore');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  // Leads checked for AI analysis. Analysis costs tokens per lead, so nothing
  // runs until the user picks and submits.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: leads = [], isLoading: leadsLoading } = useQuery<any[]>({
    queryKey: ['/api/leads'],
    staleTime: 0,
    // Auto-refresh only while an analysis job is actually in flight. A missing
    // aiScore is now the normal resting state (analysis is opt-in), so polling
    // on that would never stop.
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      const hasPending = data.some((l: any) => l.status === 'analyzing');
      return hasPending ? 3000 : false;
    },
  });

  // Derived: filtered + sorted leads
  const filteredLeads = useMemo(() => {
    let result = [...leads];

    // Text search across name, category, address, email
    if (searchText.trim()) {
      const q = searchText.toLowerCase();
      result = result.filter((l: any) =>
        l.businessName?.toLowerCase().includes(q) ||
        l.category?.toLowerCase().includes(q) ||
        l.address?.toLowerCase().includes(q) ||
        l.email?.toLowerCase().includes(q)
      );
    }

    if (statusFilter !== 'all') result = result.filter((l: any) => l.status === statusFilter);
    if (categoryFilter !== 'all') result = result.filter((l: any) => l.category === categoryFilter);
    if (priorityFilter !== 'all') result = result.filter((l: any) => l.priority === priorityFilter);
    if (emailFilter === 'yes') result = result.filter((l: any) => !!l.email);
    if (emailFilter === 'no') result = result.filter((l: any) => !l.email);
    if (hubspotFilter === 'yes') result = result.filter((l: any) => !!l.hubspotCompanyId);
    if (hubspotFilter === 'no') result = result.filter((l: any) => !l.hubspotCompanyId);

    // Sort, with nulls always at the bottom
    result.sort((a: any, b: any) => {
      const getVal = (lead: any) => {
        if (sortBy === 'prescore') return prescoreLead(lead).score;
        const v = lead[sortBy];
        if (v == null || v === '') return null;
        if (sortBy === 'rating') return parseFloat(v);
        if (sortBy === 'discoveredAt') return new Date(v).getTime();
        if (sortBy === 'businessName') return String(v).toLowerCase();
        return v;
      };
      const aVal = getVal(a);
      const bVal = getVal(b);
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      if (aVal === bVal) return 0;
      const cmp = aVal < bVal ? -1 : 1;
      return sortOrder === 'desc' ? -cmp : cmp;
    });

    return result;
  }, [leads, searchText, statusFilter, categoryFilter, priorityFilter, emailFilter, hubspotFilter, sortBy, sortOrder]);

  // Unique categories present in the current leads, sorted alphabetically
  const availableCategories = useMemo(() => {
    const set = new Set<string>();
    for (const l of leads as any[]) {
      if (l.category) set.add(l.category);
    }
    return Array.from(set).sort();
  }, [leads]);

  const hasActiveFilters =
    searchText.trim() !== '' ||
    statusFilter !== 'all' ||
    categoryFilter !== 'all' ||
    priorityFilter !== 'all' ||
    emailFilter !== 'all' ||
    hubspotFilter !== 'all';

  const clearFilters = () => {
    setSearchText('');
    setStatusFilter('all');
    setCategoryFilter('all');
    setPriorityFilter('all');
    setEmailFilter('all');
    setHubspotFilter('all');
  };

  // --- Selection for AI analysis ---

  // A lead mid-analysis can't be queued again; the server skips those anyway.
  const isSelectable = (lead: any) => lead.status !== 'analyzing';

  const selectableVisible = useMemo(
    () => filteredLeads.filter(isSelectable),
    [filteredLeads],
  );

  // Only count selections still visible under the current filters — a lead
  // filtered out of view shouldn't be silently analyzed.
  const visibleSelectedIds = useMemo(
    () => selectableVisible.filter((l: any) => selectedIds.has(l.id)).map((l: any) => l.id),
    [selectableVisible, selectedIds],
  );

  const allVisibleSelected =
    selectableVisible.length > 0 && visibleSelectedIds.length === selectableVisible.length;

  const toggleLead = (leadId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(leadId)) next.delete(leadId);
      else next.add(leadId);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const l of selectableVisible) next.delete((l as any).id);
      } else {
        for (const l of selectableVisible) next.add((l as any).id);
      }
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const analyzeMutation = useMutation({
    mutationFn: async (leadIds: string[]) => {
      const response = await apiRequest('POST', '/api/leads/analyze', { leadIds });
      return response.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/leads'] });
      clearSelection();
      const queued = data?.queued ?? 0;
      const skipped = data?.skipped?.length ?? 0;
      toast({
        title: 'Analysis Queued',
        description:
          `Running AI analysis on ${queued} lead${queued === 1 ? '' : 's'}.` +
          (skipped > 0 ? ` Skipped ${skipped} already in progress.` : ''),
      });
    },
    onError: (error: Error) => {
      toast({ title: 'Analysis Failed', description: error.message, variant: 'destructive' });
    },
  });

  const handleAnalyzeSelected = () => {
    if (visibleSelectedIds.length === 0) return;
    analyzeMutation.mutate(visibleSelectedIds.slice(0, MAX_ANALYZE_BATCH));
  };

  const bulkVerifyMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/leads/verify-emails');
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/leads'] });
      toast({
        title: 'Bulk verify complete',
        description: `Verified ${data?.data?.verified ?? 0} lead(s).`,
      });
    },
    onError: (err: Error) => {
      toast({ title: 'Bulk verify failed', description: err.message, variant: 'destructive' });
    },
  });

  // Current user — used to gate the admin-only "Find duplicates" action.
  const { data: authUser } = useQuery<{ role?: string }>({ queryKey: ['/api/auth/user'] });
  const isAdmin = authUser?.role === 'admin';

  const dedupeMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/leads/deduplicate');
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/leads'] });
      const d = data?.data ?? { scanned: 0, merged: 0 };
      toast({
        title: 'Deduplication complete',
        description: `Scanned ${d.scanned} lead(s), merged ${d.merged} duplicate(s).`,
      });
    },
    onError: (err: Error) => {
      toast({ title: 'Deduplication failed', description: err.message, variant: 'destructive' });
    },
  });

  const searchMutation = useMutation({
    mutationFn: async ({ query, location }: { query: string; location?: string }) => {
      const url = `/api/search-leads?query=${encodeURIComponent(query)}${location ? `&location=${encodeURIComponent(location)}` : ''}`;
      const response = await apiRequest('GET', url);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/leads'] });
      toast({
        title: "Search Complete",
        description: "New leads have been discovered. Enrichment is running in the background.",
      });
    },
    onError: (error) => {
      if (isUnauthorizedError(error)) {
        toast({
          title: "Unauthorized",
          description: "You are logged out. Logging in again...",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/api/auth/google";
        }, 500);
        return;
      }
      toast({
        title: "Search Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const enrichMutation = useMutation({
    mutationFn: async (leadId: string) => {
      const response = await apiRequest('POST', `/api/leads/${leadId}/enrich`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/leads'] });
      toast({
        title: "Lead Enriched",
        description: "Lead data has been updated with Places API and email discovery.",
      });
    },
    onError: (error) => {
      toast({
        title: "Enrichment Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const reanalyzeMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/leads/reanalyze-stuck');
      return response.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/leads'] });
      toast({
        title: data.requeued > 0 ? "Recovery Started" : "Nothing Stuck",
        description: data.requeued > 0
          ? `Re-queued ${data.requeued} stuck lead${data.requeued === 1 ? '' : 's'} for AI analysis.`
          : "No leads are stuck in analysis.",
      });
    },
    onError: (error) => {
      toast({
        title: "Re-analyze Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const hubspotMutation = useMutation({
    mutationFn: async (leadId: string) => {
      const response = await apiRequest('POST', `/api/leads/${leadId}/hubspot`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/leads'] });
      toast({
        title: "Pushed to HubSpot",
        description: "Lead has been created as a Company in HubSpot.",
      });
    },
    onError: (error) => {
      toast({
        title: "HubSpot Push Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSearch = () => {
    if (!searchQuery.trim()) {
      toast({
        title: "Search Query Required",
        description: "Please enter a search query.",
        variant: "destructive",
      });
      return;
    }

    searchMutation.mutate({ query: searchQuery, location: location || undefined });
  };

  const handleViewLead = (lead: any) => {
    setSelectedLead(lead);
    setIsModalOpen(true);
  };

  const handleStartOutreach = (leadId: string) => {
    const lead = leads.find((l: any) => l.id === leadId);
    if (!lead) return;
    setOutreachLead(lead);
    setIsOutreachOpen(true);
    // Close the lead detail modal if it's open
    setIsModalOpen(false);
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return 'bg-red-500';
      case 'medium': return 'bg-yellow-500';
      case 'low': return 'bg-green-500';
      default: return 'bg-gray-500';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'discovered': return 'bg-blue-100 text-blue-800';
      case 'analyzing': return 'bg-yellow-100 text-yellow-800';
      case 'analyzed': return 'bg-green-100 text-green-800';
      case 'contacted': return 'bg-purple-100 text-purple-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  // Summary stats reflect filtered view
  const totalLeads = filteredLeads.length;
  const highPriorityLeads = filteredLeads.filter((lead: any) => lead.priority === 'high').length;
  const mediumPriorityLeads = filteredLeads.filter((lead: any) => lead.priority === 'medium').length;
  const withEmail = filteredLeads.filter((lead: any) => lead.email).length;

  return (
    <div className="space-y-6">
      {/* Search Controls */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Search className="h-5 w-5" />
            <span>Lead Discovery</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex space-x-4">
            <Input
              placeholder="Search businesses (e.g., 'restaurants', 'plumbers')"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1"
              onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
            />
            <Input
              placeholder="Location (e.g., 'San Francisco')"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="w-48"
              onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
            />
            <Button
              onClick={handleSearch}
              disabled={searchMutation.isPending}
              className="flex items-center space-x-2"
            >
              {searchMutation.isPending ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              <span>Search Leads</span>
            </Button>
            <Button
              variant="outline"
              onClick={() => bulkVerifyMutation.mutate()}
              disabled={bulkVerifyMutation.isPending}
              className="flex items-center space-x-2"
              title="Run Hunter.io verification on every lead that hasn't been checked yet (up to 50 per call)"
            >
              <RefreshCw className={`h-4 w-4 ${bulkVerifyMutation.isPending ? 'animate-spin' : ''}`} />
              <span>Verify emails</span>
            </Button>
            <Button
              variant="outline"
              onClick={() => setIsImportOpen(true)}
              className="flex items-center space-x-2"
              title="Import leads from a CSV file"
            >
              <FileUp className="h-4 w-4" />
              <span>Import CSV</span>
            </Button>
            {isAdmin && (
              <Button
                variant="outline"
                onClick={() => {
                  if (confirm('Scan this workspace for duplicate leads (by email, LinkedIn URL, or business+website) and merge them? The oldest record in each group is kept. This cannot be undone.')) {
                    dedupeMutation.mutate();
                  }
                }}
                disabled={dedupeMutation.isPending}
                className="flex items-center space-x-2"
                title="Find and merge duplicate leads across the workspace (admin only)"
              >
                <Copy className={`h-4 w-4 ${dedupeMutation.isPending ? 'animate-pulse' : ''}`} />
                <span>Find duplicates</span>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Filter & Sort Toolbar */}
      {leads.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center text-sm font-medium text-gray-700">
                <Filter className="h-4 w-4 mr-1.5" />
                Filter
              </div>

              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search leads by name, category, address, email..."
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  className="pl-8"
                />
              </div>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="discovered">Discovered</SelectItem>
                  <SelectItem value="analyzing">Analyzing</SelectItem>
                  <SelectItem value="analyzed">Analyzed</SelectItem>
                  <SelectItem value="contacted">Contacted</SelectItem>
                </SelectContent>
              </Select>

              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {availableCategories.map((cat) => (
                    <SelectItem key={cat} value={cat} className="capitalize">
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Priority" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Priorities</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>

              <Select value={emailFilter} onValueChange={(v) => setEmailFilter(v as YesNoAll)}>
                <SelectTrigger className="w-[130px]">
                  <SelectValue placeholder="Email" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Email: All</SelectItem>
                  <SelectItem value="yes">Has Email</SelectItem>
                  <SelectItem value="no">No Email</SelectItem>
                </SelectContent>
              </Select>

              <Select value={hubspotFilter} onValueChange={(v) => setHubspotFilter(v as YesNoAll)}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="HubSpot" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">HubSpot: All</SelectItem>
                  <SelectItem value="yes">In HubSpot</SelectItem>
                  <SelectItem value="no">Not in HubSpot</SelectItem>
                </SelectContent>
              </Select>

              <div className="h-6 w-px bg-gray-200" />

              <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortKey)}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="prescore">Lead Quality</SelectItem>
                  <SelectItem value="aiScore">AI Score</SelectItem>
                  <SelectItem value="rating">Google Rating</SelectItem>
                  <SelectItem value="totalReviews">Review Count</SelectItem>
                  <SelectItem value="businessName">Business Name</SelectItem>
                  <SelectItem value="discoveredAt">Discovered</SelectItem>
                </SelectContent>
              </Select>

              <Button
                variant="outline"
                size="icon"
                onClick={() => setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')}
                title={sortOrder === 'desc' ? 'Descending' : 'Ascending'}
              >
                {sortOrder === 'desc' ? <ArrowDown className="h-4 w-4" /> : <ArrowUp className="h-4 w-4" />}
              </Button>

              {hasActiveFilters && (
                <Button variant="ghost" size="sm" onClick={clearFilters} className="text-gray-600">
                  <X className="h-4 w-4 mr-1" />
                  Clear
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Leads</p>
                <p className="text-2xl font-bold text-gray-900">{totalLeads}</p>
              </div>
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                <Users className="h-5 w-5 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">High Priority</p>
                <p className="text-2xl font-bold text-red-600">{highPriorityLeads}</p>
              </div>
              <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center">
                <AlertTriangle className="h-5 w-5 text-red-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Medium Priority</p>
                <p className="text-2xl font-bold text-yellow-600">{mediumPriorityLeads}</p>
              </div>
              <div className="w-10 h-10 bg-yellow-100 rounded-lg flex items-center justify-center">
                <Clock className="h-5 w-5 text-yellow-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">With Email</p>
                <p className="text-2xl font-bold text-green-600">{withEmail}</p>
              </div>
              <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                <Mail className="h-5 w-5 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Leads Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-baseline space-x-3">
              <CardTitle>Lead Results</CardTitle>
              {leads.length > 0 && (
                <span className="text-sm text-gray-500">
                  {hasActiveFilters
                    ? `Showing ${filteredLeads.length} of ${leads.length}`
                    : `${leads.length} ${leads.length === 1 ? 'lead' : 'leads'}`}
                </span>
              )}
            </div>
            {leads.some((l: any) => l.status === 'analyzing') && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => reanalyzeMutation.mutate()}
                disabled={reanalyzeMutation.isPending}
                title="Re-queue leads left in 'analyzing' by a server restart"
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${reanalyzeMutation.isPending ? 'animate-spin' : ''}`} />
                Recover stuck
              </Button>
            )}
          </div>

          {/* Selection action bar — the only path that spends AI tokens */}
          {visibleSelectedIds.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5">
              <span className="text-sm font-medium text-blue-900">
                {visibleSelectedIds.length} lead{visibleSelectedIds.length === 1 ? '' : 's'} selected
              </span>
              {visibleSelectedIds.length > MAX_ANALYZE_BATCH && (
                <span className="text-xs text-blue-700">
                  Only the first {MAX_ANALYZE_BATCH} will be analyzed.
                </span>
              )}
              <div className="ml-auto flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={clearSelection} className="text-blue-900">
                  Clear
                </Button>
                <Button
                  size="sm"
                  onClick={handleAnalyzeSelected}
                  disabled={analyzeMutation.isPending}
                  title="Run AI analysis on the selected leads. Uses tokens."
                >
                  <Sparkles className={`h-4 w-4 mr-2 ${analyzeMutation.isPending ? 'animate-pulse' : ''}`} />
                  Analyze {Math.min(visibleSelectedIds.length, MAX_ANALYZE_BATCH)} selected
                </Button>
              </div>
            </div>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {leadsLoading ? (
            <div className="p-8 text-center">
              <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p className="text-gray-600">Loading leads...</p>
            </div>
          ) : leads.length === 0 ? (
            <div className="p-8 text-center">
              <Search className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No leads found</h3>
              <p className="text-gray-600">Start by searching for businesses in your target area.</p>
            </div>
          ) : filteredLeads.length === 0 ? (
            <div className="p-8 text-center">
              <Filter className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No leads match your filters</h3>
              <p className="text-gray-600 mb-4">Try adjusting or clearing your filters.</p>
              <Button variant="outline" onClick={clearFilters}>
                <X className="h-4 w-4 mr-1" />
                Clear Filters
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 w-10">
                      <Checkbox
                        checked={allVisibleSelected}
                        onCheckedChange={toggleAllVisible}
                        disabled={selectableVisible.length === 0}
                        aria-label="Select all visible leads"
                      />
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Business</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Contact</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Rating</th>
                    <th
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                      title="Free heuristic score from Google Places data — no AI call. Use it to pick which leads are worth analyzing."
                    >
                      Quality
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">AI Score</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Priority</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredLeads.map((lead: any) => {
                    const prescore = prescoreLead(lead);
                    return (
                    <tr
                      key={lead.id}
                      className={`hover:bg-gray-50 ${selectedIds.has(lead.id) ? 'bg-blue-50/60' : ''}`}
                    >
                      <td className="px-4 py-4">
                        <Checkbox
                          checked={selectedIds.has(lead.id)}
                          onCheckedChange={() => toggleLead(lead.id)}
                          disabled={!isSelectable(lead)}
                          aria-label={`Select ${lead.businessName}`}
                        />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div>
                          <div className="text-sm font-medium text-gray-900">{lead.businessName}</div>
                          <div className="text-sm text-gray-500">
                            {lead.category && <span className="capitalize">{lead.category}</span>}
                            {lead.category && lead.address && ' · '}
                            {lead.address || (!lead.category && 'Address not available')}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">{lead.phone || 'No phone'}</div>
                        <div className="text-sm text-gray-500">
                          {lead.email ? (
                            <span className="text-green-600">{lead.email}</span>
                          ) : (
                            'No email'
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {lead.rating ? (
                          <div className="flex items-center text-sm">
                            <Star className="h-3.5 w-3.5 text-yellow-500 fill-yellow-500 mr-1" />
                            <span className="font-medium">{parseFloat(lead.rating).toFixed(1)}</span>
                            {lead.totalReviews != null && (
                              <span className="text-gray-400 ml-1">({lead.totalReviews})</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-sm text-gray-400">--</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {prescore.disqualified ? (
                          <span
                            className="text-xs text-gray-500 px-2 py-1 bg-gray-100 rounded"
                            title={prescore.reasons.join('\n')}
                          >
                            Closed
                          </span>
                        ) : (
                          <div className="flex items-center" title={prescore.reasons.join('\n')}>
                            <Progress value={prescore.score} className="w-16 mr-2" />
                            <span
                              className={`text-sm font-medium ${
                                prescore.score < 40
                                  ? 'text-gray-500'
                                  : prescore.score < 70
                                    ? 'text-yellow-600'
                                    : 'text-green-600'
                              }`}
                            >
                              {prescore.score}
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {lead.aiScore !== null ? (
                          <div className="flex items-center">
                            <Progress value={lead.aiScore} className="w-16 mr-2" />
                            <span className={`text-sm font-medium ${
                              lead.aiScore < 40 ? 'text-red-600' :
                              lead.aiScore < 70 ? 'text-yellow-600' : 'text-green-600'
                            }`}>
                              {lead.aiScore}/100
                            </span>
                          </div>
                        ) : lead.status === 'analyzing' ? (
                          <span className="text-sm text-gray-500">Analyzing...</span>
                        ) : (
                          <span className="text-sm text-gray-400">Not analyzed</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className={`w-2 h-2 rounded-full mr-2 ${getPriorityColor(lead.priority)}`} />
                          <span className="text-sm capitalize">{lead.priority}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <Badge className={`${getStatusColor(lead.status)} capitalize`}>
                          {lead.status}
                        </Badge>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <div className="flex space-x-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleViewLead(lead)}
                            className="text-blue-600 hover:text-blue-900"
                          >
                            <Eye className="h-4 w-4 mr-1" />
                            View
                          </Button>
                          {!lead.enrichedAt && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => enrichMutation.mutate(lead.id)}
                              disabled={enrichMutation.isPending}
                              className="text-orange-600 hover:text-orange-900"
                              title="Enrich with Places API + email discovery"
                            >
                              <RefreshCw className={`h-4 w-4 mr-1 ${enrichMutation.isPending ? 'animate-spin' : ''}`} />
                              Enrich
                            </Button>
                          )}
                          {lead.email && lead.status !== 'contacted' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleStartOutreach(lead.id)}
                              disabled={isOutreachOpen}
                              className="text-green-600 hover:text-green-900"
                            >
                              <Mail className="h-4 w-4 mr-1" />
                              Contact
                            </Button>
                          )}
                          {!lead.hubspotCompanyId ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => hubspotMutation.mutate(lead.id)}
                              disabled={hubspotMutation.isPending}
                              className="text-purple-600 hover:text-purple-900"
                              title="Push to HubSpot as Company"
                            >
                              <Upload className="h-4 w-4 mr-1" />
                              HubSpot
                            </Button>
                          ) : (
                            <span className="text-xs text-purple-600 px-2 py-1 bg-purple-50 rounded">
                              In HubSpot
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Lead Details Modal */}
      <LeadModal
        lead={selectedLead}
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onOutreach={handleStartOutreach}
        onEnrich={(leadId) => enrichMutation.mutate(leadId)}
        onPushToHubSpot={(leadId) => hubspotMutation.mutate(leadId)}
      />

      <OutreachPreviewModal
        lead={outreachLead}
        open={isOutreachOpen}
        onClose={() => setIsOutreachOpen(false)}
        onSent={() => queryClient.invalidateQueries({ queryKey: ['/api/leads'] })}
      />

      <LeadImportModal
        open={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onImported={() => queryClient.invalidateQueries({ queryKey: ['/api/leads'] })}
      />
    </div>
  );
}
