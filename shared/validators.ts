// Shared Zod schemas for request validation. Keeping these in `shared/`
// means both the Express routes (via validateBody) and — eventually —
// the frontend forms can use the same source of truth. Phase 6 wires
// these onto the 5 highest-risk routes; a full sweep lives in the Phase 6
// follow-up (see ROADMAP.md §6.4).

import { z } from 'zod';

export const linkedinSearchSchema = z.object({
  query: z.string().max(200).optional(),
  title: z.string().max(200).optional(),
  company: z.string().max(200).optional(),
  industry: z.string().max(200).optional(),
  location: z.string().max(200).optional(),
  cursor: z.string().max(500).optional(),
});

export const linkedinSaveProfilesSchema = z.object({
  profiles: z
    .array(
      z.object({
        linkedinUrl: z.string().url().nullable(),
        fullName: z.string().max(200).nullable().optional(),
        headline: z.string().max(500).nullable().optional(),
        location: z.string().max(200).nullable().optional(),
        industry: z.string().max(200).nullable().optional(),
        connectionDegree: z.number().int().min(0).max(3).nullable().optional(),
        memberId: z.string().max(200).nullable().optional(),
        profilePicture: z.string().max(500).nullable().optional(),
        publicIdentifier: z.string().max(200).nullable().optional(),
      })
    )
    .min(1)
    .max(100),
});

export const createCampaignSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  outreachChannel: z.enum(['linkedin', 'email']).default('linkedin'),
  tone: z.enum(['consultative', 'direct', 'curiosity-led']).default('consultative'),
  dailySendLimit: z.number().int().min(1).max(50).default(20),
  maxTouches: z.number().int().min(1).max(10).default(5),
  requireApproval: z.boolean().default(true),
  emailTemplate: z.string().max(10_000).nullable().optional(),
});

export const createCampaignStepSchema = z.object({
  campaignId: z.string().min(1),
  stepOrder: z.number().int().min(0).max(20),
  stepType: z.enum(['connection_request', 'message', 'inmail', 'post_engage', 'email']),
  delayDays: z.number().int().min(0).max(365).default(0),
  promptTemplate: z.string().max(10_000).nullable().optional(),
  characterLimit: z.number().int().min(1).max(10_000).nullable().optional(),
});

export const generateMessageSchema = z.object({
  enrollmentId: z.string().min(1),
  stepId: z.string().min(1),
});
