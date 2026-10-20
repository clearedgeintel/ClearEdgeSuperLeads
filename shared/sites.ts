// Site domain types, shared by the admin app, the public site server and the
// client. Ported from Instant Site's shared/types.ts, plus the merge additions:
// 'live' status, photos, custom domains and owner notification email.

import { z } from 'zod';

export interface BusinessData {
  name: string;
  category: string; // e.g. "Roofing Contractor"
  city: string;
  state: string;
  phone: string | null; // null if unverified — surface a warning, never invent
  website: string | null; // their existing site, if any
  rating: number | null;
  reviewCount: number | null;
  tagline: string; // <=10 words, benefit-driven, paraphrased
  about: string; // 2-3 sentences, paraphrased
  services: { name: string; desc: string }[]; // 4-6, desc <=12 words
  serviceAreas: string[]; // 3-6 nearby cities
  hours: string; // short string or "Call for hours"
  yearsInBusiness: string | null;
  brandColor: string; // hex suited to the trade
  testimonials: { text: string; author: string }[]; // SAMPLES, clearly labeled
  mapsUrl: string;
}

export const THEMES_LIST = ['slate', 'clean', 'warm'] as const;
export type Theme = (typeof THEMES_LIST)[number];

export const SITE_STATUSES = ['draft', 'sent', 'live'] as const;
export type SiteStatus = (typeof SITE_STATUSES)[number];

export type SitePhotoRole = 'hero' | 'gallery';
export interface SitePhoto {
  url: string;
  alt: string;
  role: SitePhotoRole;
}

// API shape of a site (dates as ISO strings).
export interface Site {
  id: string;
  slug: string;
  theme: Theme;
  data: BusinessData;
  status: SiteStatus;
  workspaceId: string | null;
  leadId: string | null;
  createdBy: string | null;
  photos: SitePhoto[];
  customDomain: string | null;
  notifyEmail: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// Row in GET /api/sites: aggregates computed in SQL.
export interface SiteListItem extends Site {
  submissionCount: number;
  viewCount: number;
  lastViewedAt: string | null;
}

export interface SiteSubmission {
  id: string;
  siteId: string;
  leadId: string | null;
  workspaceId: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  message: string | null;
  createdAt: string;
}

// POST /api/sites/generate response
export interface GenerateResponse {
  id: string;
  slug: string;
  data: BusinessData;
  url: string | null; // null until PUBLIC_SITE_BASE_URL is set
  reused: boolean;
}

// Sentinel author for the labeled sample testimonials.
export const SAMPLE_TESTIMONIAL_AUTHOR = 'Sample review — replace with a real one';

// ── Validation ────────────────────────────────────────────────

export const sitePhotoSchema = z
  .object({
    url: z.string().url().max(2000),
    alt: z.string().max(300),
    role: z.enum(['hero', 'gallery']),
  })
  .strict();

const shortText = z.string().max(300);

export const businessDataSchema = z
  .object({
    name: z.string().min(1).max(200),
    category: shortText,
    city: shortText,
    state: shortText,
    phone: z.string().max(50).nullable(),
    website: z.string().max(500).nullable(),
    rating: z.number().min(0).max(5).nullable(),
    reviewCount: z.number().int().min(0).nullable(),
    tagline: shortText,
    about: z.string().max(3000),
    services: z
      .array(z.object({ name: z.string().max(200), desc: z.string().max(500) }).strict())
      .max(20),
    serviceAreas: z.array(z.string().max(200)).max(30),
    hours: shortText,
    yearsInBusiness: z.string().max(100).nullable(),
    brandColor: z.string().max(20),
    testimonials: z
      .array(z.object({ text: z.string().max(2000), author: z.string().max(200) }).strict())
      .max(20),
    mapsUrl: z.string().max(2000),
  })
  .strict();
