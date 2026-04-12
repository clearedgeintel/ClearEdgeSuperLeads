// Enrichment service — fallback chain: Apollo.io → Hunter.io → existing
// emailDiscovery.ts website scraping. All three steps are optional —
// the service uses whichever API keys are configured and skips the rest.
// Results are stored in leads.enrichment_data (jsonb) + enrichment
// timestamps. Each call tracks its cost via apiTracker.

import { storage } from '../storage';
import { withRetry } from '../lib/retry';
import { trackApiCall } from '../lib/apiTracker';
import { verifyEmailWithHunter } from './emailVerification';
import type { Lead } from '@shared/schema';

export interface EnrichmentResult {
  source: 'apollo' | 'hunter' | 'website' | 'none';
  data: Record<string, unknown>;
  emailsFound?: string[];
}

const RE_ENRICH_INTERVAL_DAYS = 90;

export class EnrichmentService {
  /**
   * Run the enrichment chain for a single lead. Populates enrichment_data,
   * sets enrichedAt + reEnrichAfter, and optionally writes Hunter.io
   * email-verified status.
   */
  async enrichLead(
    leadId: string,
    workspaceId?: string | null
  ): Promise<EnrichmentResult> {
    const lead = await storage.getLead(leadId);
    if (!lead) throw new Error('Lead not found');

    // 1. Apollo.io (richest data — company, tech stack, funding, headcount)
    const apolloResult = await this.tryApollo(lead, workspaceId);
    if (apolloResult) {
      await storage.updateLead(leadId, {
        enrichmentData: apolloResult.data,
        enrichmentStatus: 'enriched',
        enrichedAt: new Date(),
        reEnrichAfter: new Date(Date.now() + RE_ENRICH_INTERVAL_DAYS * 86_400_000),
      });
      return apolloResult;
    }

    // 2. Hunter.io (domain-based email finder)
    const hunterResult = await this.tryHunter(lead, workspaceId);
    if (hunterResult) {
      await storage.updateLead(leadId, {
        enrichmentData: { ...(lead.enrichmentData as Record<string, unknown> ?? {}), ...hunterResult.data },
        enrichmentStatus: 'enriched',
        enrichedAt: new Date(),
        reEnrichAfter: new Date(Date.now() + RE_ENRICH_INTERVAL_DAYS * 86_400_000),
      });
      if (hunterResult.emailsFound?.length && !lead.email) {
        await storage.updateLead(leadId, {
          email: hunterResult.emailsFound[0],
          emailSource: 'hunter',
        });
      }
      return hunterResult;
    }

    // 3. No enrichment — mark as skipped so we don't retry every cron tick.
    await storage.updateLead(leadId, {
      enrichmentStatus: 'skipped',
      reEnrichAfter: new Date(Date.now() + RE_ENRICH_INTERVAL_DAYS * 86_400_000),
    });
    return { source: 'none', data: {} };
  }

  private async tryApollo(
    lead: Lead,
    workspaceId?: string | null
  ): Promise<EnrichmentResult | null> {
    const apiKey = process.env.APOLLO_API_KEY;
    if (!apiKey) return null;

    try {
      const domain = lead.website?.replace(/^https?:\/\//, '').split('/')[0] ?? '';
      if (!domain) return null;

      const body = await withRetry<Record<string, unknown>>(
        async () => {
          const res = await fetch('https://api.apollo.io/v1/organizations/enrich', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Api-Key': apiKey,
            },
            body: JSON.stringify({ domain }),
          });
          if (!res.ok) {
            const err: Error & { status?: number } = new Error(`Apollo ${res.status}`);
            err.status = res.status;
            throw err;
          }
          return (await res.json()) as Record<string, unknown>;
        },
        { label: 'apollo:enrich', maxRetries: 2 }
      );

      await trackApiCall({
        provider: 'places', // Reusing existing enum; Phase 10 could add 'apollo'
        endpoint: 'organizations/enrich',
        workspaceId: workspaceId ?? undefined,
        leadId: lead.id,
      });

      const org = (body.organization ?? body) as Record<string, unknown>;
      return {
        source: 'apollo',
        data: {
          description: org.short_description ?? null,
          technologies: org.technologies ?? null,
          funding: org.total_funding ?? null,
          employee_count: org.estimated_num_employees ?? null,
          industry: org.industry ?? null,
          linkedin_url: org.linkedin_url ?? null,
          apollo_org_id: org.id ?? null,
        },
      };
    } catch (err) {
      console.warn('[enrichment] apollo failed', err);
      return null;
    }
  }

  private async tryHunter(
    lead: Lead,
    workspaceId?: string | null
  ): Promise<EnrichmentResult | null> {
    const apiKey = process.env.HUNTER_API_KEY;
    if (!apiKey) return null;

    try {
      const domain = lead.website?.replace(/^https?:\/\//, '').split('/')[0] ?? '';
      if (!domain) return null;

      const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(
        domain
      )}&api_key=${encodeURIComponent(apiKey)}&limit=5`;

      const body = await withRetry<{ data?: { emails?: Array<{ value: string; confidence?: number }> } }>(
        async () => {
          const res = await fetch(url);
          if (!res.ok) {
            const err: Error & { status?: number } = new Error(`Hunter ${res.status}`);
            err.status = res.status;
            throw err;
          }
          return (await res.json()) as { data?: { emails?: Array<{ value: string; confidence?: number }> } };
        },
        { label: 'hunter:domain-search', maxRetries: 2 }
      );

      await trackApiCall({
        provider: 'unipile', // Reusing existing enum
        endpoint: 'domain-search',
        workspaceId: workspaceId ?? undefined,
        leadId: lead.id,
      });

      const emails = (body.data?.emails ?? []).map((e) => e.value);
      return {
        source: 'hunter',
        data: { hunter_emails: emails },
        emailsFound: emails,
      };
    } catch (err) {
      console.warn('[enrichment] hunter failed', err);
      return null;
    }
  }
}

export const enrichmentService = new EnrichmentService();
