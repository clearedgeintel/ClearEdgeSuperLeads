// Default model for site enrichment (Instant Site's default). Override with ANTHROPIC_MODEL.
export const DEFAULT_SITES_MODEL = "claude-sonnet-4-6";

export function sitesModel(): string {
  return process.env.ANTHROPIC_MODEL || DEFAULT_SITES_MODEL;
}
