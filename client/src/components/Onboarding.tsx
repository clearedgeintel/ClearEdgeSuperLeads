import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, ArrowRight, SkipForward, Mail, Linkedin, Megaphone, Users } from "lucide-react";

interface OnboardingStep {
  id: number;
  title: string;
  description: string;
  icon: React.ReactNode;
  action: string;
  actionLabel: string;
}

const STEPS: OnboardingStep[] = [
  {
    id: 1,
    title: "Connect email",
    description:
      "Set your SendGrid API key and from-address in Settings so outbound emails use a verified sending domain instead of Gmail SMTP.",
    icon: <Mail className="h-5 w-5 text-blue-600" />,
    action: "settings",
    actionLabel: "Go to Settings",
  },
  {
    id: 2,
    title: "Connect LinkedIn",
    description:
      "Enter your Unipile account ID in Settings so the LinkedIn search, dispatch, and inbox sync services can reach your LinkedIn account.",
    icon: <Linkedin className="h-5 w-5 text-sky-600" />,
    action: "settings",
    actionLabel: "Go to Settings",
  },
  {
    id: 3,
    title: "Create first campaign",
    description:
      "Build a multi-step LinkedIn or email sequence. Define your tone, daily send limit, and prompt templates for each step.",
    icon: <Megaphone className="h-5 w-5 text-purple-600" />,
    action: "campaigns",
    actionLabel: "Go to Campaigns",
  },
  {
    id: 4,
    title: "Find your first leads",
    description:
      "Search Google for local businesses or LinkedIn for prospects. Save results as leads, then enroll them into your campaign.",
    icon: <Users className="h-5 w-5 text-green-600" />,
    action: "leadDiscovery",
    actionLabel: "Go to Lead Discovery",
  },
];

export default function Onboarding({
  onNavigate,
  onDismiss,
}: {
  onNavigate: (tab: string) => void;
  onDismiss: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: settingsData } = useQuery<{
    success: boolean;
    data: { values: Record<string, string> };
  }>({
    queryKey: ["/api/settings"],
  });
  const config = settingsData?.data?.values ?? {};

  // Derive completed steps from actual config state so the checklist
  // reflects reality rather than manual "done" clicks.
  const completedSteps = new Set<number>();
  if (config.sendgrid_from_email || process.env.SENDGRID_API_KEY) completedSteps.add(1);
  if (config.unipile_account_id && config.unipile_account_id !== "YOUR_LINKEDIN_ACCOUNT_ID")
    completedSteps.add(2);
  // Steps 3 and 4 would need campaign/lead count queries — for now they're
  // manually toggled via the "Mark done" button (stored in app_config).
  if (config.onboarding_step_3 === "done") completedSteps.add(3);
  if (config.onboarding_step_4 === "done") completedSteps.add(4);

  const markDoneMutation = useMutation({
    mutationFn: async (step: number) => {
      const res = await apiRequest("PATCH", "/api/settings", {
        [`onboarding_step_${step}` as string]: "done",
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
    },
  });

  const allDone = completedSteps.size === STEPS.length;

  return (
    <Card className="border-2 border-primary/20">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Getting Started</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline">
              {completedSteps.size}/{STEPS.length} complete
            </Badge>
            <Button variant="ghost" size="sm" onClick={onDismiss}>
              <SkipForward className="h-4 w-4 mr-1" />
              Skip
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {STEPS.map((step) => {
            const done = completedSteps.has(step.id);
            return (
              <div
                key={step.id}
                className={`flex items-start gap-3 p-3 rounded-lg border ${
                  done ? "bg-green-50 border-green-200" : "bg-white border-gray-200"
                }`}
              >
                <div className="mt-0.5">
                  {done ? (
                    <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
                      <Check className="h-4 w-4 text-white" />
                    </div>
                  ) : (
                    <div className="w-6 h-6 border-2 border-gray-300 rounded-full flex items-center justify-center text-xs font-bold text-gray-400">
                      {step.id}
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {step.icon}
                    <span className="font-medium text-gray-900">{step.title}</span>
                  </div>
                  <p className="text-sm text-gray-600 mt-1">{step.description}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {!done && step.id >= 3 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => markDoneMutation.mutate(step.id)}
                    >
                      Mark done
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => onNavigate(step.action)}>
                    {step.actionLabel}
                    <ArrowRight className="h-3 w-3 ml-1" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
        {allDone && (
          <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg text-center">
            <p className="text-green-800 font-medium">Setup complete! You're ready to go.</p>
            <Button size="sm" className="mt-2" onClick={onDismiss}>
              Dismiss
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
