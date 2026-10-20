// Site generation, in-process. Ported from Instant Site's routes/generate.ts.
// Idempotency rules are unchanged: a lead reuses its existing site, and cold
// input reuses the site for the same resolved Maps URL, unless `force` is set.
// Both lookups are scoped to the caller's workspace.
//
// Dependencies are injected (wired in ./service.ts) so this module imports no
// database or network code and can be tested directly.

import type { Site } from "@shared/sites";
import type { SiteRepository } from "./repository";
import type { EnrichmentProvider } from "./enrich";
import type { LeadEnrichment } from "./enrich/lead";
import { resolveMapsInput } from "./maps";
import { defaultThemeForCategory } from "./template/themes";

/** Bad input (unresolvable link, unknown lead, research failed): 422. */
export class GenerateInputError extends Error {
  readonly status = 422;
}

/** A required provider isn't configured: 503. */
export class GenerateUnavailableError extends Error {
  readonly status = 503;
}

export interface GeneratorDeps {
  repo: Pick<SiteRepository, "getByLeadForWorkspace" | "getByMapsUrlForWorkspace" | "create">;
  fromLead(leadId: string, workspaceId: string | null): Promise<LeadEnrichment>;
  lookup: EnrichmentProvider["lookup"];
  anthropicConfigured(): boolean;
  resolveInput?: typeof resolveMapsInput;
}

export interface GenerateResult {
  site: Site;
  reused: boolean;
}

export function createGenerator(deps: GeneratorDeps) {
  const resolveInput = deps.resolveInput ?? resolveMapsInput;

  return {
    /** Generate from an owned lead (no web search; no Anthropic key required). */
    async fromLead(opts: {
      leadId: string;
      workspaceId: string | null;
      createdBy?: string | null;
      force?: boolean;
    }): Promise<GenerateResult> {
      if (!opts.force) {
        const existing = await deps.repo.getByLeadForWorkspace(opts.leadId, opts.workspaceId);
        if (existing) return { site: existing, reused: true };
      }
      let enrichment: LeadEnrichment;
      try {
        enrichment = await deps.fromLead(opts.leadId, opts.workspaceId);
      } catch (err) {
        // Matched by name: importing LeadNotFoundError would pull in the API clients.
        if (err instanceof Error && err.name === "LeadNotFoundError") {
          throw new GenerateInputError(err.message);
        }
        throw err;
      }
      const site = await deps.repo.create({
        data: enrichment.data,
        theme: defaultThemeForCategory(enrichment.data.category),
        status: "draft",
        workspaceId: enrichment.workspaceId,
        leadId: enrichment.leadId,
        createdBy: opts.createdBy ?? null,
      });
      return { site, reused: false };
    },

    /** Generate from a Maps link or "Name, City ST" (web-search research). */
    async fromInput(opts: {
      input: string;
      locHint?: string;
      workspaceId: string;
      createdBy?: string | null;
      force?: boolean;
    }): Promise<GenerateResult> {
      if (opts.input.trim().length < 2) {
        throw new GenerateInputError("Paste a Google Maps link, or a business name and city.");
      }
      if (!deps.anthropicConfigured()) {
        throw new GenerateUnavailableError("Research is not configured (ANTHROPIC_API_KEY).");
      }

      let resolved: Awaited<ReturnType<typeof resolveMapsInput>>;
      try {
        resolved = await resolveInput(opts.input, { locHint: opts.locHint });
      } catch (err) {
        throw new GenerateInputError(err instanceof Error ? err.message : "Could not read that input.");
      }

      if (!opts.force && resolved.mapsUrl) {
        const existing = await deps.repo.getByMapsUrlForWorkspace(resolved.mapsUrl, opts.workspaceId);
        if (existing) return { site: existing, reused: true };
      }

      let data;
      try {
        data = await deps.lookup(resolved.nameHint, resolved.locHint, { workspaceId: opts.workspaceId });
      } catch (err) {
        throw new GenerateInputError(
          err instanceof Error && err.message ? err.message : "Could not generate a site from that input."
        );
      }
      data.mapsUrl = resolved.mapsUrl || data.mapsUrl || "";

      const site = await deps.repo.create({
        data,
        theme: defaultThemeForCategory(data.category),
        status: "draft",
        workspaceId: opts.workspaceId,
        createdBy: opts.createdBy ?? null,
      });
      return { site, reused: false };
    },
  };
}

export type SiteGenerator = ReturnType<typeof createGenerator>;
