import Anthropic from "@anthropic-ai/sdk";
import type { BusinessData } from "@shared/sites";
import type { GbpProfile, Lead } from "@shared/schema";
import { withRetry } from "../../lib/retry";
import { trackApiCall } from "../../lib/apiTracker";
import { isAnthropicConfigured } from "./index";
import { sitesModel } from "./model";
import { normalize, parseFirstJsonObject, type NormalizeDefaults } from "./shared";

// Enrichment from owned SuperLeads data. Reads the lead (+ a gbp_profiles row
// when one exists — that table isn't populated yet, so nothing depends on it)
// and builds a BusinessData WITHOUT a web-search call: the hard facts (phone,
// rating, reviews, website) come from already-verified data, and a single
// no-tools copy pass writes the narrative (tagline/about/services/areas).
// Falls back to templated copy when Anthropic isn't configured or fails.

/** Data access the provider needs; wired to Drizzle in ../service.ts. */
export interface LeadSource {
  getLead(id: string): Promise<Lead | undefined>;
  /** Case-insensitive name match within the workspace. */
  findGbpProfile(businessName: string, workspaceId: string | null): Promise<GbpProfile | undefined>;
}

export class LeadNotFoundError extends Error {
  constructor() {
    super("That lead was not found.");
    this.name = "LeadNotFoundError";
  }
}

export interface LeadEnrichment {
  data: BusinessData;
  workspaceId: string | null;
  leadId: string;
}

function num(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export class LeadProvider {
  private client: Anthropic | null = null;

  constructor(private source: LeadSource) {}

  /**
   * Build site data for a lead. `workspaceId` is the caller's workspace: a lead
   * in any other workspace is reported as not found.
   */
  async fromLead(leadId: string, workspaceId: string | null): Promise<LeadEnrichment> {
    const lead = await this.source.getLead(leadId);
    if (!lead || lead.isDeleted || (lead.workspaceId ?? null) !== workspaceId) {
      throw new LeadNotFoundError();
    }

    const gbp = lead.businessName
      ? ((await this.source.findGbpProfile(lead.businessName, lead.workspaceId ?? null)) ?? null)
      : null;

    const { city, state } = parseCityState(lead.address);
    const category = prettifyCategory(lead.category || gbp?.category || "Local Business");
    const defaults: NormalizeDefaults = {
      name: lead.businessName || "",
      category,
      city,
      state,
      phone: lead.phone ?? gbp?.phone ?? null,
      website: lead.website ?? gbp?.website ?? null,
      rating: num(lead.rating) ?? num(gbp?.rating) ?? null,
      reviewCount: lead.totalReviews ?? gbp?.totalReviews ?? null,
      brandColor: brandColorForCategory(category),
      serviceAreas: city ? [city] : [],
    };

    const raw = isAnthropicConfigured()
      ? await this.writeCopy(defaults, gbp?.description ?? null, {
          workspaceId: lead.workspaceId ?? null,
          leadId: lead.id,
        })
      : null;

    const data = normalize(raw ?? templatedCopy(defaults), defaults);
    data.mapsUrl = mapsUrlFromPlaceId(lead.googlePlaceId);

    return { data, workspaceId: lead.workspaceId ?? null, leadId: lead.id };
  }

  /** No-tools copy pass: write marketing narrative grounded in verified facts. */
  private async writeCopy(
    defaults: NormalizeDefaults,
    gbpDescription: string | null,
    ctx: { workspaceId: string | null; leadId: string }
  ): Promise<Record<string, unknown> | null> {
    if (!this.client) this.client = new Anthropic();
    const client = this.client;
    const model = sitesModel();

    const facts = {
      name: defaults.name,
      category: defaults.category,
      city: defaults.city,
      state: defaults.state,
      rating: defaults.rating,
      reviewCount: defaults.reviewCount,
      existingDescription: gbpDescription || undefined,
    };

    const system = `You write marketing copy for a one-page demo website from VERIFIED facts that are
provided to you. Do NOT invent phone numbers, ratings, or review counts. Return ONLY one JSON object
(no prose, no markdown fences) with exactly these keys:
{
  "tagline": string,        // <= 10 words, benefit-driven, paraphrased
  "about": string,          // 2-3 sentences, paraphrased — copy no text verbatim
  "services": [ { "name": string, "desc": string } ], // 4-6 items, desc <= 12 words, typical for the category
  "serviceAreas": string[]  // 3-6 areas in or near the city
}
Paraphrase everything; copy no text verbatim from the provided description. Output JSON only.`;

    try {
      const response = await withRetry(
        () =>
          client.messages.create({
            model,
            max_tokens: 1500,
            system,
            messages: [{ role: "user", content: `Facts (JSON):\n${JSON.stringify(facts, null, 2)}` }],
          }),
        { label: "sites.enrich.leadCopy" }
      );
      await trackApiCall({
        provider: "claude",
        endpoint: "sites.enrich.leadCopy",
        model,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        workspaceId: ctx.workspaceId ?? undefined,
        leadId: ctx.leadId,
      });
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      return parseFirstJsonObject(text);
    } catch {
      return null; // fall back to templated copy
    }
  }
}

/** Parse "street, City, ST ZIP" freetext into city/state (best effort). */
export function parseCityState(address: string | null): { city: string; state: string } {
  if (!address) return { city: "", state: "" };
  let parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  // Drop a trailing country token (e.g. "USA", "US", "United States").
  if (parts.length && /^(usa|us|u\.s\.a?\.?|united states)$/i.test(parts[parts.length - 1])) {
    parts = parts.slice(0, -1);
  }
  if (parts.length === 0) return { city: "", state: "" };
  const last = parts[parts.length - 1]; // "TX 78701" or "TX"
  const stateMatch = last.match(/\b([A-Z]{2})\b/);
  const state = stateMatch ? stateMatch[1] : "";
  const city = parts.length >= 2 ? parts[parts.length - 2] : "";
  return { city, state };
}

const TRADE_COLORS: { pattern: RegExp; color: string }[] = [
  { pattern: /roof/, color: "#b91c1c" },
  { pattern: /hvac|air|heating|cooling/, color: "#0ea5e9" },
  { pattern: /plumb/, color: "#1d4ed8" },
  { pattern: /electric/, color: "#f59e0b" },
  { pattern: /landscap|lawn|tree/, color: "#16a34a" },
  { pattern: /paint/, color: "#7c3aed" },
  { pattern: /clean|janitor|maid/, color: "#0891b2" },
  { pattern: /property|realty|real estate|realtor|management/, color: "#0f766e" },
];

// Google place types (e.g. "plumber", "roofing_contractor") → presentable labels.
const CATEGORY_LABELS: Record<string, string> = {
  plumber: "Plumbing Contractor",
  electrician: "Electrician",
  roofing_contractor: "Roofing Contractor",
  hvac_contractor: "HVAC Contractor",
  general_contractor: "General Contractor",
  painter: "Painting Contractor",
  landscaper: "Landscaping",
  locksmith: "Locksmith",
  moving_company: "Moving Company",
  pest_control_service: "Pest Control",
  real_estate_agency: "Real Estate",
  property_management_company: "Property Management",
};

export function prettifyCategory(category: string): string {
  const key = (category || "").trim().toLowerCase().replace(/\s+/g, "_");
  if (CATEGORY_LABELS[key]) return CATEGORY_LABELS[key];
  // Title-case a raw slug/type as a fallback.
  return (category || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim() || "Local Business";
}

export function brandColorForCategory(category: string): string {
  const c = (category || "").toLowerCase();
  for (const { pattern, color } of TRADE_COLORS) if (pattern.test(c)) return color;
  return "#2563eb";
}

function mapsUrlFromPlaceId(placeId: string | null): string {
  return placeId
    ? `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`
    : "";
}

/** Templated fallback narrative when no copy model is available. */
function templatedCopy(d: NormalizeDefaults): Record<string, unknown> {
  const where = d.city ? ` in ${d.city}${d.state ? ", " + d.state : ""}` : "";
  return {
    tagline: `Trusted ${d.category}${d.city ? " in " + d.city : ""}`,
    about: `${d.name || "We"} provides dependable ${(d.category || "service").toLowerCase()}${where}. We focus on quality work, clear communication, and standing behind every job.`,
    services: [
      { name: "Free Estimates", desc: "Honest, upfront quotes with no surprises" },
      { name: "Repairs", desc: "Fast, reliable fixes done right" },
      { name: "Installations", desc: "Professional installs built to last" },
      { name: "Maintenance", desc: "Keep things running year-round" },
    ],
    serviceAreas: d.serviceAreas && d.serviceAreas.length ? d.serviceAreas : d.city ? [d.city] : [],
  };
}
