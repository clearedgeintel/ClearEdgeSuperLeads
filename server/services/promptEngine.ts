// Prompt engine — template interpolation + A/B version selection + RAG
// context injection + language localization. Upgraded in Phase 4 from
// the minimal Phase 3 stub. Ported from ClearEdge Leads lib/prompt-engine.js.
//
// The engine's surface is three functions:
//   - selectPromptVersion: weighted random selection of a prompt variant
//     for a (campaign, stepOrder) pair, with bias toward under-used
//     variants so A/B tests converge on fair exploration.
//   - recordReplyForVersion: update reply_count / positive_reply_count
//     on the version that produced a given send_queue item, so the
//     CampaignBuilder UI can show reply rates per variant.
//   - buildEnhancedPrompt: the full prompt-building pipeline — variable
//     interpolation + RAG context + calendar link + language instruction.

import { storage } from '../storage';
import { retrieveSimilar, formatRagContext } from './ragEngine';
import { detectLanguage, getLocalizationInstruction } from '../lib/languageDetect';
import type { Lead, PromptVersion } from '@shared/schema';

// ---------- template interpolation ----------
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

// ---------- A/B version selection ----------
export interface SelectedPromptVersion {
  prompt: string | null;
  versionId: string | null;
}

/**
 * Pick a prompt variant for a (campaign, stepOrder) pair. Variants that
 * have been used less get higher weight — this biases A/B rollouts toward
 * fair exploration early on instead of pure random, without becoming
 * deterministic. Falls back to the fallbackTemplate when no versions
 * exist for that step yet. Returns the chosen variant's id so the caller
 * can stamp it on the send_queue row and later credit replies to it.
 */
export async function selectPromptVersion(
  campaignId: string,
  stepOrder: number,
  fallbackTemplate: string | null
): Promise<SelectedPromptVersion> {
  const versions = await storage.getPromptVersions(campaignId, stepOrder);
  if (versions.length === 0) {
    return { prompt: fallbackTemplate, versionId: null };
  }

  const maxUsed = Math.max(...versions.map((v: PromptVersion) => v.timesUsed ?? 0), 1);
  const weights = versions.map((v: PromptVersion) => maxUsed - (v.timesUsed ?? 0) + 1);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let rand = Math.random() * totalWeight;

  let selected: PromptVersion = versions[0];
  for (let i = 0; i < versions.length; i++) {
    rand -= weights[i];
    if (rand <= 0) {
      selected = versions[i];
      break;
    }
  }

  await storage.incrementPromptVersionUsage(selected.id);
  return { prompt: selected.promptTemplate, versionId: selected.id };
}

/**
 * Credit a reply back to the prompt version that generated the original
 * message. The queue item stores `promptVersionId` at generation time, so
 * we look it up and increment the appropriate counters. No-op if the
 * queue item or lookup fails — reply tracking must never break inbox sync.
 */
export async function recordReplyForVersion(
  queueItemId: string,
  isPositive: boolean
): Promise<void> {
  try {
    const item = await storage.getSendQueueItem(queueItemId);
    if (!item?.promptVersionId) return;
    await storage.recordPromptVersionReply(item.promptVersionId, isPositive);
  } catch (err) {
    console.error('[promptEngine] recordReplyForVersion failed', err);
  }
}

// ---------- full prompt building ----------
export interface BuildEnhancedPromptOptions {
  template: string | null;
  lead: Lead;
  tone: string;
  workspaceId?: string | null;
  includeRag?: boolean;
}

/**
 * Build the final prompt sent to Claude. Composition order:
 *   1. Language instruction (prepended, if the lead isn't English)
 *   2. Interpolated template
 *   3. RAG context block (appended, optional)
 *   4. Calendar link instruction (appended, if configured in app_config)
 *
 * Any of the optional enhancements silently degrade to a no-op if the
 * underlying data source is unavailable — the caller gets back the
 * interpolated template at minimum.
 */
export async function buildEnhancedPrompt(
  opts: BuildEnhancedPromptOptions
): Promise<string> {
  const { template, lead, tone, workspaceId, includeRag = true } = opts;

  let prompt = interpolatePrompt(template, lead, tone);

  // 1. RAG context (positive-sentiment similar examples)
  if (includeRag) {
    try {
      const examples = await retrieveSimilar({
        industry: lead.industry,
        titlePattern: lead.title,
        workspaceId,
      });
      const ragContext = formatRagContext(examples);
      if (ragContext) prompt += ragContext;
    } catch (err) {
      console.warn('[promptEngine] RAG retrieval skipped', err);
    }
  }

  // 2. Calendar link (optional)
  try {
    const calendarLink = await storage.getAppConfig('calendly_link', workspaceId);
    if (calendarLink) {
      prompt += `\n\nIf appropriate, include this scheduling link near the end: ${calendarLink}`;
    }
  } catch {
    // No calendar link configured — continue.
  }

  // 3. Language instruction — prepended so Claude sees it first
  const language = lead.language ?? detectLanguage(lead);
  const langInstruction = getLocalizationInstruction(language);
  if (langInstruction) prompt = `${langInstruction}\n\n${prompt}`;

  return prompt;
}

// ---------- legacy helper kept for backward compat with Phase 3 call site ----------
/**
 * Phase 3 shim. `buildEnhancedPrompt` is the new full-featured version.
 * Kept so queueGenerationService's old call site doesn't break if it
 * sneaks in a sync-only invocation — delegates to interpolatePrompt.
 */
export function buildPrompt(opts: { template: string | null; lead: Lead; tone: string }): string {
  return interpolatePrompt(opts.template, opts.lead, opts.tone);
}
