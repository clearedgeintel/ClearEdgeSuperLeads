import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Megaphone, Plus, Trash2, Play, Pause, X, FlaskConical } from "lucide-react";

interface Campaign {
  id: string;
  name: string;
  description: string | null;
  outreachChannel: string;
  status: string;
  tone: string;
  dailySendLimit: number;
  maxTouches: number;
  requireApproval: boolean;
  totalSent: number | null;
  totalReplied: number | null;
  createdAt: string | null;
}

interface CampaignStep {
  id: string;
  campaignId: string;
  stepOrder: number;
  stepType: string;
  delayDays: number;
  promptTemplate: string | null;
  characterLimit: number | null;
}

interface CampaignDetail extends Campaign {
  steps: CampaignStep[];
}

const STEP_TYPES = ["connection_request", "message", "inmail", "email"] as const;

export default function CampaignBuilder() {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [activeCampaignId, setActiveCampaignId] = useState<string | null>(null);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: listData } = useQuery<{ success: boolean; data: Campaign[] }>({
    queryKey: ["/api/campaigns"],
  });
  const campaigns: Campaign[] = listData?.data ?? [];

  const { data: detailData } = useQuery<{ success: boolean; data: CampaignDetail }>({
    queryKey: ["/api/campaigns", activeCampaignId],
    enabled: !!activeCampaignId,
    queryFn: async () => {
      const res = await fetch(`/api/campaigns/${activeCampaignId}`, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
  });
  const activeDetail = detailData?.data;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Megaphone className="h-6 w-6 text-purple-600" />
            Campaigns
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            Build multi-step LinkedIn sequences and email drip campaigns.
          </p>
        </div>
        <Button onClick={() => setWizardOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New Campaign
        </Button>
      </div>

      {campaigns.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Megaphone className="h-12 w-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-600 font-medium">No campaigns yet</p>
            <p className="text-sm text-gray-500 mt-1">
              Create your first campaign to start reaching out.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {campaigns.map((c) => (
            <CampaignCard
              key={c.id}
              campaign={c}
              isActive={activeCampaignId === c.id}
              onSelect={() => setActiveCampaignId(activeCampaignId === c.id ? null : c.id)}
            />
          ))}
        </div>
      )}

      {activeDetail && (
        <CampaignDetailPanel
          detail={activeDetail}
          onClose={() => setActiveCampaignId(null)}
          onRefresh={() => {
            queryClient.invalidateQueries({ queryKey: ["/api/campaigns", activeCampaignId] });
            queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
          }}
        />
      )}

      <CampaignWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onCreated={(id) => {
          setWizardOpen(false);
          setActiveCampaignId(id);
          queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
          toast({ title: "Campaign created", description: "Add steps to activate." });
        }}
      />
    </div>
  );
}

function CampaignCard({
  campaign,
  isActive,
  onSelect,
}: {
  campaign: Campaign;
  isActive: boolean;
  onSelect: () => void;
}) {
  const statusColor: Record<string, string> = {
    draft: "bg-gray-100 text-gray-700",
    active: "bg-green-100 text-green-700",
    paused: "bg-yellow-100 text-yellow-700",
    completed: "bg-blue-100 text-blue-700",
  };
  return (
    <Card
      className={`cursor-pointer transition-shadow ${isActive ? "ring-2 ring-purple-500" : "hover:shadow"}`}
      onClick={onSelect}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-2">
          <div className="font-semibold text-gray-900">{campaign.name}</div>
          <Badge className={statusColor[campaign.status] ?? "bg-gray-100 text-gray-700"}>
            {campaign.status}
          </Badge>
        </div>
        {campaign.description && (
          <p className="text-sm text-gray-600 line-clamp-2">{campaign.description}</p>
        )}
        <div className="flex items-center gap-3 mt-3 text-xs text-gray-500">
          <span>{campaign.outreachChannel === "email" ? "Email" : "LinkedIn"}</span>
          <span>·</span>
          <span>{campaign.dailySendLimit}/day</span>
          <span>·</span>
          <span>Max {campaign.maxTouches} touches</span>
        </div>
        <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
          <span>Sent: {campaign.totalSent ?? 0}</span>
          <span>·</span>
          <span>Replies: {campaign.totalReplied ?? 0}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function CampaignDetailPanel({
  detail,
  onClose,
  onRefresh,
}: {
  detail: CampaignDetail;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const { toast } = useToast();

  const activateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/campaigns/${detail.id}`, {
        status: detail.status === "active" ? "paused" : "active",
      });
      return res.json();
    },
    onSuccess: () => {
      onRefresh();
      toast({ title: detail.status === "active" ? "Paused" : "Activated" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", `/api/campaigns/${detail.id}`);
      return res.json();
    },
    onSuccess: () => {
      onRefresh();
      onClose();
      toast({ title: "Campaign deleted" });
    },
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{detail.name}</CardTitle>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={detail.status === "active" ? "outline" : "default"}
              onClick={() => activateMutation.mutate()}
              disabled={activateMutation.isPending}
            >
              {detail.status === "active" ? (
                <>
                  <Pause className="h-4 w-4 mr-1" /> Pause
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-1" /> Activate
                </>
              )}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (confirm(`Delete ${detail.name}?`)) deleteMutation.mutate();
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="ghost" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <StepsEditor campaignId={detail.id} steps={detail.steps} onChange={onRefresh} />
        <PromptVersionsPanel campaignId={detail.id} steps={detail.steps} />
      </CardContent>
    </Card>
  );
}

function StepsEditor({
  campaignId,
  steps,
  onChange,
}: {
  campaignId: string;
  steps: CampaignStep[];
  onChange: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [stepType, setStepType] = useState<string>("connection_request");
  const [delayDays, setDelayDays] = useState(0);
  const [promptTemplate, setPromptTemplate] = useState("");
  const [characterLimit, setCharacterLimit] = useState<number>(300);

  const { toast } = useToast();
  const nextOrder = steps.length > 0 ? Math.max(...steps.map((s) => s.stepOrder)) + 1 : 0;

  const addMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/campaign-steps", {
        campaignId,
        stepOrder: nextOrder,
        stepType,
        delayDays,
        promptTemplate,
        characterLimit,
      });
      return res.json();
    },
    onSuccess: () => {
      setShowForm(false);
      setPromptTemplate("");
      setDelayDays(0);
      onChange();
      toast({ title: "Step added" });
    },
  });

  const deleteStepMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/campaign-steps/${id}`);
      return res.json();
    },
    onSuccess: () => onChange(),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900">Campaign Steps</h3>
        {!showForm && (
          <Button size="sm" variant="outline" onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4 mr-1" /> Add step
          </Button>
        )}
      </div>

      {steps.length === 0 && !showForm && (
        <p className="text-sm text-gray-500">No steps yet. Add one to define the sequence.</p>
      )}

      <div className="space-y-2">
        {steps.map((s) => (
          <div key={s.id} className="border rounded-lg p-3 bg-gray-50">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline">Step {s.stepOrder + 1}</Badge>
                  <Badge>{s.stepType}</Badge>
                  {s.delayDays > 0 && (
                    <span className="text-xs text-gray-500">+{s.delayDays}d delay</span>
                  )}
                </div>
                {s.promptTemplate && (
                  <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap">{s.promptTemplate}</p>
                )}
                {s.characterLimit && (
                  <p className="text-xs text-gray-500 mt-1">Limit: {s.characterLimit} chars</p>
                )}
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (confirm(`Delete step ${s.stepOrder + 1}?`)) deleteStepMutation.mutate(s.id);
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      {showForm && (
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Select value={stepType} onValueChange={setStepType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STEP_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="number"
              min={0}
              value={delayDays}
              onChange={(e) => setDelayDays(parseInt(e.target.value) || 0)}
              placeholder="Delay days"
            />
          </div>
          <Textarea
            placeholder="Prompt template — use {{full_name}}, {{title}}, {{company}}, {{industry}}, {{headline}}, {{tone}}"
            value={promptTemplate}
            onChange={(e) => setPromptTemplate(e.target.value)}
            rows={4}
          />
          <Input
            type="number"
            value={characterLimit}
            onChange={(e) => setCharacterLimit(parseInt(e.target.value) || 300)}
            placeholder="Character limit"
          />
          <div className="flex items-center gap-2 justify-end">
            <Button size="sm" variant="outline" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => addMutation.mutate()} disabled={addMutation.isPending}>
              Add
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function CampaignWizard({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [outreachChannel, setOutreachChannel] = useState("linkedin");
  const [tone, setTone] = useState("consultative");
  const [dailySendLimit, setDailySendLimit] = useState(20);
  const [maxTouches, setMaxTouches] = useState(5);

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/campaigns", {
        name,
        description,
        outreachChannel,
        tone,
        dailySendLimit,
        maxTouches,
        requireApproval: true,
      });
      return res.json();
    },
    onSuccess: (data) => {
      if (data?.success && data.data?.id) onCreated(data.data.id);
      setName("");
      setDescription("");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Campaign</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-gray-700">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Q2 Sales Outreach" />
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700">Description</label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-gray-700">Channel</label>
              <Select value={outreachChannel} onValueChange={setOutreachChannel}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="linkedin">LinkedIn</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Tone</label>
              <Select value={tone} onValueChange={setTone}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="consultative">Consultative</SelectItem>
                  <SelectItem value="direct">Direct</SelectItem>
                  <SelectItem value="curiosity-led">Curiosity-led</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-gray-700">Daily send limit</label>
              <Input
                type="number"
                min={1}
                max={50}
                value={dailySendLimit}
                onChange={(e) => setDailySendLimit(parseInt(e.target.value) || 20)}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Max touches</label>
              <Input
                type="number"
                min={1}
                max={10}
                value={maxTouches}
                onChange={(e) => setMaxTouches(parseInt(e.target.value) || 5)}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => createMutation.mutate()} disabled={!name || createMutation.isPending}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Prompt versions A/B panel (Phase 4) ----------

interface PromptVersionWithRates {
  id: string;
  campaignId: string;
  stepOrder: number;
  variant: string;
  promptTemplate: string;
  description: string | null;
  timesUsed: number | null;
  replyCount: number | null;
  positiveReplyCount: number | null;
  replyRate: number;
  positiveRate: number;
}

function PromptVersionsPanel({
  campaignId,
  steps,
}: {
  campaignId: string;
  steps: CampaignStep[];
}) {
  const [showForm, setShowForm] = useState(false);
  const [variant, setVariant] = useState("B");
  const [stepOrder, setStepOrder] = useState<number>(steps[0]?.stepOrder ?? 0);
  const [promptTemplate, setPromptTemplate] = useState("");
  const [description, setDescription] = useState("");

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data } = useQuery<{ success: boolean; data: PromptVersionWithRates[] }>({
    queryKey: ["/api/prompt-versions", campaignId],
    queryFn: async () => {
      const res = await fetch(`/api/prompt-versions?campaignId=${campaignId}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
  });
  const versions = data?.data ?? [];

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/prompt-versions", {
        campaignId,
        stepOrder,
        variant,
        promptTemplate,
        description,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/prompt-versions", campaignId] });
      setShowForm(false);
      setPromptTemplate("");
      setDescription("");
      setVariant("B");
      toast({ title: "Variant added" });
    },
    onError: (err: Error) => {
      toast({ title: "Create failed", description: err.message, variant: "destructive" });
    },
  });

  const variantsByStep = useMemo(() => {
    const map = new Map<number, PromptVersionWithRates[]>();
    for (const v of versions) {
      const bucket = map.get(v.stepOrder) ?? [];
      bucket.push(v);
      map.set(v.stepOrder, bucket);
    }
    return map;
  }, [versions]);

  return (
    <div className="space-y-3 pt-4 border-t">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-amber-600" />
          A/B Prompt Variants
        </h3>
        {!showForm && steps.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4 mr-1" /> New variant
          </Button>
        )}
      </div>

      {versions.length === 0 && !showForm && (
        <p className="text-sm text-gray-500">
          No A/B variants yet. The queue generator will use the step's default prompt template.
          Add a variant to split-test alternate copy.
        </p>
      )}

      {steps.map((step) => {
        const bucket = variantsByStep.get(step.stepOrder) ?? [];
        if (bucket.length === 0) return null;
        return (
          <div key={step.id} className="border rounded-lg p-3">
            <div className="text-xs font-medium text-gray-500 mb-2">
              Step {step.stepOrder + 1} · {step.stepType}
            </div>
            <div className="space-y-2">
              {bucket.map((v) => (
                <div key={v.id} className="flex items-start gap-3">
                  <Badge className="bg-amber-100 text-amber-800 text-xs">Variant {v.variant}</Badge>
                  <div className="flex-1 min-w-0">
                    {v.description && (
                      <div className="text-xs text-gray-500 mb-1">{v.description}</div>
                    )}
                    <p className="text-sm text-gray-700 line-clamp-2">{v.promptTemplate}</p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                      <span>Sent {v.timesUsed ?? 0}</span>
                      <span>·</span>
                      <span>Reply rate {v.replyRate.toFixed(1)}%</span>
                      <span>·</span>
                      <span>Positive {v.positiveRate.toFixed(1)}%</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {showForm && (
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600">Step</label>
              <Select
                value={String(stepOrder)}
                onValueChange={(v) => setStepOrder(parseInt(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {steps.map((s) => (
                    <SelectItem key={s.id} value={String(s.stepOrder)}>
                      Step {s.stepOrder + 1} · {s.stepType}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Variant label</label>
              <Input
                value={variant}
                onChange={(e) => setVariant(e.target.value)}
                placeholder="A, B, control, etc."
              />
            </div>
          </div>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Short description (e.g. 'question-first opener')"
          />
          <Textarea
            value={promptTemplate}
            onChange={(e) => setPromptTemplate(e.target.value)}
            rows={5}
            placeholder="Variant prompt template — same {{full_name}} / {{title}} / {{company}} / {{industry}} / {{headline}} / {{tone}} variables as the step template"
          />
          <div className="flex items-center gap-2 justify-end">
            <Button size="sm" variant="outline" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => createMutation.mutate()}
              disabled={!variant || !promptTemplate || createMutation.isPending}
            >
              Add variant
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
