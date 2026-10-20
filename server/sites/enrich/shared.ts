import type { BusinessData } from "@shared/sites";
import { SAMPLE_TESTIMONIAL_AUTHOR } from "@shared/sites";

// Shared helpers for enrichment providers: JSON extraction, field coercion, the
// labeled sample testimonials, and a safe normalizer that never trusts model shape.

// Clearly-labeled sample testimonials shipped in v1/v2 (spec §10). Real reviews
// from gbp_profiles are a P1 roadmap item.
export const SAMPLE_TESTIMONIALS: { text: string; author: string }[] = [
  {
    text: "Showed up on time, did exactly what they promised, and left the place spotless. Would hire again.",
    author: SAMPLE_TESTIMONIAL_AUTHOR,
  },
  {
    text: "Fair, upfront pricing and great communication from the first call to the final walkthrough.",
    author: SAMPLE_TESTIMONIAL_AUTHOR,
  },
];

/** Extract the first balanced {...} JSON object from a string and parse it. */
export function parseFirstJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}

export function asNullableNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

export function asNullableString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export interface NormalizeDefaults {
  name?: string;
  category?: string;
  city?: string;
  state?: string;
  phone?: string | null;
  website?: string | null;
  rating?: number | null;
  reviewCount?: number | null;
  hours?: string;
  yearsInBusiness?: string | null;
  brandColor?: string;
  serviceAreas?: string[];
}

/**
 * Coerce a raw object (from a model or a DB row) into a safe BusinessData.
 * `defaults` supplies verified facts that win over model output for hard fields
 * (phone/rating/etc.) — used by LeadProvider so owned data is never overwritten.
 */
export function normalize(
  raw: Record<string, unknown>,
  defaults: NormalizeDefaults = {}
): BusinessData {
  const services = Array.isArray(raw.services)
    ? raw.services
        .map((s) => {
          const o = (s ?? {}) as Record<string, unknown>;
          return { name: asString(o.name), desc: asString(o.desc) };
        })
        .filter((s) => s.name)
        .slice(0, 6)
    : [];

  const modelAreas = Array.isArray(raw.serviceAreas)
    ? raw.serviceAreas.map((a) => asString(a)).filter(Boolean).slice(0, 6)
    : [];

  return {
    name: asString(raw.name, defaults.name ?? ""),
    category: asString(raw.category, defaults.category ?? "Local Business"),
    city: asString(raw.city, defaults.city ?? ""),
    state: asString(raw.state, defaults.state ?? ""),
    phone: defaults.phone !== undefined ? defaults.phone : asNullableString(raw.phone),
    website: defaults.website !== undefined ? defaults.website : asNullableString(raw.website),
    rating: defaults.rating !== undefined ? defaults.rating : asNullableNumber(raw.rating),
    reviewCount:
      defaults.reviewCount !== undefined ? defaults.reviewCount : asNullableNumber(raw.reviewCount),
    tagline: asString(raw.tagline, "Quality work you can count on"),
    about: asString(raw.about),
    services,
    serviceAreas: modelAreas.length ? modelAreas : defaults.serviceAreas ?? [],
    hours: asString(raw.hours, defaults.hours ?? "Call for hours"),
    yearsInBusiness:
      defaults.yearsInBusiness !== undefined
        ? defaults.yearsInBusiness
        : asNullableString(raw.yearsInBusiness),
    brandColor: asString(raw.brandColor, defaults.brandColor ?? "#2563eb"),
    testimonials: SAMPLE_TESTIMONIALS.map((t) => ({ ...t })),
    mapsUrl: "", // set by the caller from the resolved input / lead
  };
}
