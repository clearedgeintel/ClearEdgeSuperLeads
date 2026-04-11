// Minimal prompt engine for Phase 3. Just template interpolation — A/B
// version selection, RAG retrieval, and language detection all come in
// Phase 4's AI Engine Consolidation pass.
//
// Template variable convention matches ClearEdge Leads lib/prompt-engine.js
// so existing campaign_steps.prompt_template values port cleanly: {{full_name}},
// {{title}}, {{company}}, {{industry}}, {{headline}}, {{tone}}, {{company_size}},
// {{enrichment}}.

import type { Lead } from '@shared/schema';

export function interpolatePrompt(
  template: string | null,
  lead: Lead,
  tone: string
): string {
  const t = template ?? '';
  return t
    .replace(/\{\{full_name\}\}/g, lead.fullName ?? lead.businessName ?? 'the recipient')
    .replace(/\{\{title\}\}/g, lead.title ?? 'their role')
    .replace(/\{\{company\}\}/g, lead.company ?? lead.businessName ?? 'their company')
    .replace(/\{\{industry\}\}/g, lead.industry ?? 'their industry')
    .replace(/\{\{headline\}\}/g, lead.headline ?? '')
    .replace(/\{\{tone\}\}/g, tone)
    .replace(/\{\{company_size\}\}/g, lead.companySize ?? '')
    .replace(/\{\{enrichment\}\}/g, formatEnrichment(lead.enrichmentData));
}

function formatEnrichment(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const d = data as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof d.description === 'string') parts.push(`Company: ${d.description}`);
  if (Array.isArray(d.technologies)) parts.push(`Tech stack: ${d.technologies.join(', ')}`);
  if (typeof d.funding === 'string') parts.push(`Funding: ${d.funding}`);
  if (typeof d.employee_count === 'number') parts.push(`Employees: ${d.employee_count}`);
  return parts.join('. ');
}

export interface BuildPromptOptions {
  template: string | null;
  lead: Lead;
  tone: string;
}

/**
 * Build the final prompt text sent to Claude. Phase 3 is just template
 * interpolation; Phase 4 adds RAG context, calendar link, and language
 * instruction here without changing the call site.
 */
export function buildPrompt(opts: BuildPromptOptions): string {
  return interpolatePrompt(opts.template, opts.lead, opts.tone);
}
