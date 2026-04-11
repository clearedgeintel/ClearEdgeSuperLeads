import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CreditCard, ExternalLink, Zap } from "lucide-react";

interface Plan {
  tier: string;
  name: string;
  priceUsdPerMonth: number;
  emailSendsPerMonth: number;
  linkedinSendsPerMonth: number;
  members: number | "unlimited";
  unipileAccounts: number;
}

interface WorkspaceUsage {
  plan: string;
  email: { used: number; limit: number; percent: number };
  linkedin: { used: number; limit: number; percent: number };
}

export default function BillingPanel() {
  const { toast } = useToast();

  const { data: plansData } = useQuery<{ success: boolean; data: Plan[] }>({
    queryKey: ["/api/billing/plans"],
  });
  const plans = plansData?.data ?? [];

  const { data: usageData } = useQuery<{ success: boolean; data: WorkspaceUsage }>({
    queryKey: ["/api/workspace/usage"],
  });
  const usage = usageData?.data;
  const currentTier = usage?.plan ?? "free";

  const checkoutMutation = useMutation({
    mutationFn: async (tier: string) => {
      const res = await apiRequest("POST", "/api/billing/checkout", { tier });
      return res.json();
    },
    onSuccess: (data) => {
      if (data?.data?.url) {
        window.location.href = data.data.url;
      }
    },
    onError: (err: Error) => {
      const msg = err.message.includes("billing_disabled")
        ? "Stripe is not configured on this server. Set STRIPE_SECRET_KEY + STRIPE_*_PRICE_ID env vars to enable checkout."
        : err.message;
      toast({ title: "Checkout failed", description: msg, variant: "destructive" });
    },
  });

  const portalMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("GET", "/api/billing/portal");
      return res.json();
    },
    onSuccess: (data) => {
      if (data?.data?.url) window.open(data.data.url, "_blank");
    },
    onError: (err: Error) => {
      toast({ title: "Portal unavailable", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-green-600" />
          Billing & Plan
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {usage && (
          <div className="border rounded-lg p-4 bg-gray-50 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-600">Current plan</div>
              <Badge className="bg-primary text-white">{currentTier.toUpperCase()}</Badge>
            </div>
            <UsageBar
              label="Email sends"
              used={usage.email.used}
              limit={usage.email.limit}
              percent={usage.email.percent}
            />
            <UsageBar
              label="LinkedIn sends"
              used={usage.linkedin.used}
              limit={usage.linkedin.limit}
              percent={usage.linkedin.percent}
            />
            {currentTier !== "free" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => portalMutation.mutate()}
                disabled={portalMutation.isPending}
              >
                <ExternalLink className="h-4 w-4 mr-1" />
                Manage subscription
              </Button>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {plans
            .filter((p) => p.tier !== "free")
            .map((plan) => {
              const isCurrent = plan.tier === currentTier;
              return (
                <div
                  key={plan.tier}
                  className={`border rounded-lg p-4 ${isCurrent ? "ring-2 ring-primary" : ""}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-semibold text-gray-900">{plan.name}</div>
                    <div className="text-xl font-bold text-gray-900">
                      ${plan.priceUsdPerMonth}
                      <span className="text-xs text-gray-500 font-normal">/mo</span>
                    </div>
                  </div>
                  <ul className="text-xs text-gray-600 space-y-1 mb-3">
                    <li>{plan.emailSendsPerMonth.toLocaleString()} email sends/mo</li>
                    <li>{plan.linkedinSendsPerMonth.toLocaleString()} LinkedIn sends/mo</li>
                    <li>{plan.members} member{plan.members === 1 ? "" : "s"}</li>
                    <li>{plan.unipileAccounts} Unipile account{plan.unipileAccounts === 1 ? "" : "s"}</li>
                  </ul>
                  {isCurrent ? (
                    <Badge className="bg-green-100 text-green-700">Current</Badge>
                  ) : (
                    <Button
                      size="sm"
                      className="w-full"
                      onClick={() => checkoutMutation.mutate(plan.tier)}
                      disabled={checkoutMutation.isPending}
                    >
                      <Zap className="h-4 w-4 mr-1" />
                      Upgrade
                    </Button>
                  )}
                </div>
              );
            })}
        </div>

        <p className="text-xs text-gray-500">
          Billing is powered by Stripe. If checkout returns "billing disabled", the server is
          missing <code>STRIPE_SECRET_KEY</code> + plan price IDs in env.
        </p>
      </CardContent>
    </Card>
  );
}

function UsageBar({
  label,
  used,
  limit,
  percent,
}: {
  label: string;
  used: number;
  limit: number;
  percent: number;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
        <span>{label}</span>
        <span className="font-medium text-gray-900">
          {used.toLocaleString()} / {limit.toLocaleString()}
        </span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2">
        <div
          className={`h-2 rounded-full ${
            percent >= 100
              ? "bg-red-500"
              : percent >= 80
                ? "bg-yellow-500"
                : "bg-green-500"
          }`}
          style={{ width: `${Math.min(100, percent)}%` }}
        />
      </div>
    </div>
  );
}
