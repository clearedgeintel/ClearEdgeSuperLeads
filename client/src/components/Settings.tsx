import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { SettingsIcon, Save, DollarSign, Zap } from "lucide-react";
import SuppressionList from "./SuppressionList";
import AuditLog from "./AuditLog";
import WebhookEndpoints from "./WebhookEndpoints";
import MembersPanel from "./MembersPanel";
import BillingPanel from "./BillingPanel";

interface SettingsResponse {
  values: Record<string, string>;
  usage: {
    totalCalls: number;
    estimatedClaudeCostUsd: string;
    byProvider: Record<string, { calls: number; inputTokens?: number; outputTokens?: number }>;
  };
  workspace: { id: string; name: string; plan: string | null } | null;
}

const FIELD_LABELS: Record<string, { label: string; placeholder: string; type?: string }> = {
  unipile_account_id: {
    label: "Unipile account ID",
    placeholder: "Your LinkedIn account ID from Unipile",
  },
  unipile_base_url: {
    label: "Unipile base URL",
    placeholder: "https://api1.unipile.com:13465",
  },
  calendly_link: {
    label: "Calendly / scheduling link",
    placeholder: "https://calendly.com/your-handle/intro",
  },
  sendgrid_from_email: {
    label: "SendGrid from address",
    placeholder: "outreach@yourdomain.com",
  },
  slack_webhook_url: {
    label: "Slack webhook URL (for daily digest + alerts)",
    placeholder: "https://hooks.slack.com/services/…",
  },
  linkedin_search_limit_hourly: {
    label: "LinkedIn search limit (per hour)",
    placeholder: "15",
    type: "number",
  },
  linkedin_dispatch_limit_hourly: {
    label: "LinkedIn dispatch limit (per hour)",
    placeholder: "25",
    type: "number",
  },
  email_dispatch_limit_hourly: {
    label: "Email dispatch limit (per hour)",
    placeholder: "30",
    type: "number",
  },
};

export default function Settings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data } = useQuery<{ success: boolean; data: SettingsResponse }>({
    queryKey: ["/api/settings"],
  });
  const settings = data?.data;

  const [values, setValues] = useState<Record<string, string>>({});
  const [complianceMode, setComplianceMode] = useState(true);

  useEffect(() => {
    if (settings?.values) {
      setValues(settings.values);
      setComplianceMode(settings.values.linkedin_compliance_mode !== "false");
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = {
        ...values,
        linkedin_compliance_mode: complianceMode ? "true" : "false",
      };
      const res = await apiRequest("PATCH", "/api/settings", body);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({
        title: "Saved",
        description: `Updated ${data?.data?.updated?.length ?? 0} field(s).`,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <SettingsIcon className="h-6 w-6 text-gray-600" />
          Settings
        </h1>
        <p className="text-sm text-gray-600 mt-1">
          Workspace-scoped configuration. Secrets (API keys) live in server env vars — these
          are operator-tunable values that change per workspace.
        </p>
      </div>

      {/* Workspace */}
      {settings?.workspace && (
        <Card>
          <CardHeader>
            <CardTitle>Workspace</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-xs text-gray-500">Name</div>
                <div className="font-medium text-gray-900">{settings.workspace.name}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Plan</div>
                <div className="font-medium text-gray-900">{settings.workspace.plan ?? "free"}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Integrations */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-amber-600" />
            Integrations
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {[
            "unipile_account_id",
            "unipile_base_url",
            "calendly_link",
            "sendgrid_from_email",
            "slack_webhook_url",
          ].map((key) => (
            <SettingField
              key={key}
              k={key}
              value={values[key] ?? ""}
              onChange={(v) => setValues({ ...values, [key]: v })}
            />
          ))}
        </CardContent>
      </Card>

      {/* Rate limits + compliance */}
      <Card>
        <CardHeader>
          <CardTitle>Rate Limits & Compliance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              "linkedin_search_limit_hourly",
              "linkedin_dispatch_limit_hourly",
              "email_dispatch_limit_hourly",
            ].map((key) => (
              <SettingField
                key={key}
                k={key}
                value={values[key] ?? ""}
                onChange={(v) => setValues({ ...values, [key]: v })}
              />
            ))}
          </div>
          <div className="flex items-center justify-between pt-4 border-t">
            <div>
              <div className="font-medium text-gray-900">LinkedIn compliance mode</div>
              <p className="text-xs text-gray-500 mt-1">
                Enforces human-like delays between actions and caps daily sends. Recommended on for
                all LinkedIn outreach.
              </p>
            </div>
            <Switch checked={complianceMode} onCheckedChange={setComplianceMode} />
          </div>
        </CardContent>
      </Card>

      {/* Phase 9 — Billing + plan tier + usage bars */}
      <BillingPanel />

      {/* Phase 9 — Members list + role management */}
      <MembersPanel />

      {/* Suppression list (Phase 7 — CAN-SPAM/GDPR compliance) */}
      <SuppressionList />

      {/* Outbound webhooks (Phase 12) */}
      <WebhookEndpoints />

      {/* Audit log (Phase 12) */}
      <AuditLog />

      {/* Phase 8 — Email warm-up guidance */}
      <Card>
        <CardHeader>
          <CardTitle>Email Warm-Up Checklist</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-600 mb-3">
            New sending domains need a warm-up period or they'll land in spam folders. Follow
            this ramp to build a clean sender reputation:
          </p>
          <ul className="space-y-2 text-sm">
            <li className="flex items-start gap-2">
              <span className="text-gray-500 mt-0.5">•</span>
              <span><strong>Week 1:</strong> 20 emails/day max. Respond to every reply. Keep bounce rate under 2%.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-gray-500 mt-0.5">•</span>
              <span><strong>Week 2:</strong> 50/day. Add SPF + DKIM + DMARC DNS records if you haven't.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-gray-500 mt-0.5">•</span>
              <span><strong>Week 3:</strong> 100/day. Monitor SendGrid reputation dashboard.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-gray-500 mt-0.5">•</span>
              <span><strong>Week 4+:</strong> 300/day steady state. Expand cautiously if reputation stays healthy.</span>
            </li>
          </ul>
          <p className="text-xs text-gray-500 mt-3">
            The service enforces your workspace's <code>daily_email_limit</code> — attempts above
            the cap return a <code>429</code> with <code>code=daily_limit</code>. Adjust the cap
            via the workspace record as you warm up.
          </p>
        </CardContent>
      </Card>

      {/* API usage */}
      {settings?.usage && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-green-600" />
              AI Usage (this month)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              <Stat label="Total API calls" value={settings.usage.totalCalls.toString()} />
              <Stat
                label="Estimated Claude spend"
                value={`$${settings.usage.estimatedClaudeCostUsd}`}
              />
              <Stat
                label="Claude input tokens"
                value={(
                  settings.usage.byProvider.claude?.inputTokens ?? 0
                ).toLocaleString()}
              />
              <Stat
                label="Claude output tokens"
                value={(
                  settings.usage.byProvider.claude?.outputTokens ?? 0
                ).toLocaleString()}
              />
              <Stat
                label="Unipile calls"
                value={(settings.usage.byProvider.unipile?.calls ?? 0).toString()}
              />
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-end">
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          <Save className="h-4 w-4 mr-2" />
          {saveMutation.isPending ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </div>
  );
}

function SettingField({
  k,
  value,
  onChange,
}: {
  k: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const meta = FIELD_LABELS[k] ?? { label: k, placeholder: "" };
  return (
    <div>
      <label className="text-sm font-medium text-gray-700">{meta.label}</label>
      <Input
        type={meta.type ?? "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={meta.placeholder}
        className="mt-1"
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border rounded-lg p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-xl font-bold text-gray-900 mt-1">{value}</div>
    </div>
  );
}
