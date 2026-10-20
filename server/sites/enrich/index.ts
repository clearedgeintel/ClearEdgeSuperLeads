import type { BusinessData } from "@shared/sites";
import { WebSearchProvider } from "./webSearch";

export { DEFAULT_SITES_MODEL, sitesModel } from "./model";

/** Attribution for API usage tracking. */
export interface EnrichContext {
  workspaceId?: string | null;
  leadId?: string | null;
}

// Pluggable enrichment so a Google Places provider can drop in without
// touching callers.
export interface EnrichmentProvider {
  lookup(nameHint: string, locHint?: string, ctx?: EnrichContext): Promise<BusinessData>;
}

/** Selects the provider from env (`ENRICHMENT_PROVIDER`, default `websearch`). */
export function getProvider(): EnrichmentProvider {
  const choice = (process.env.ENRICHMENT_PROVIDER || "websearch").toLowerCase();
  switch (choice) {
    case "places":
      throw new Error("The 'places' enrichment provider is not implemented yet.");
    case "websearch":
    default:
      return new WebSearchProvider();
  }
}

export function isAnthropicConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}
