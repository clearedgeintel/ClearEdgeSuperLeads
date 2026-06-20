// Enrichment service — fallback chain: Apollo.io → Hunter.io → existing
// emailDiscovery.ts website scraping. All three steps are optional —
// the service uses whichever API keys are configured and skips the rest.
// Results are stored in leads.enrichment_data (jsonb) + enrichment
// timestamps. Each call tracks its cost via apiTracker.
//
// Apollo step uses the RapidAPI "Apollo.io (no cookies required)" proxy,
// which mirrors Apollo's real /api/v1 routes. We hit the people-search
// endpoint to find a decision-maker at the lead's company domain and
// populate firstName/lastName/title (and email when Apollo returns an
// unlocked one). Configure with APOLLO_RAPIDAPI_KEY (+ optional
// APOLLO_RAPIDAPI_HOST). Auth is via RapidAPI x-rapidapi-* headers.

import { storage } from '../storage';
import { withRetry } from '../lib/retry';
import { trackApiCall } from '../lib/apiTracker';
import { verifyEmailWithHunter } from './emailVerification';
import type { Lead } from '@shared/schema';

export interface ApolloContact {
  firstName?: string;
  lastName?: string;
  title?: string;
  email?: string;
  linkedinUrl?: string;
}

/** A single person record from the RapidAPI Apollo search_people response. */
interface ApolloPerson {
  id?: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  title?: string;
  headline?: string;
  linkedin_url?: string;
  email?: string;
  organization?: { id?: string; name?: string };
}

interface ApolloSearchResponse {
  data?: { people?: ApolloPerson[] };
}

/** A single organization record from the search_organization response. */
interface ApolloOrganization {
  id?: string;
  name?: string;
  primary_domain?: string;
  website_url?: string;
}

interface ApolloOrgSearchResponse {
  data?: { organizations?: ApolloOrganization[] };
}

export interface EnrichmentResult {
  source: 'apollo' | 'hunter' | 'website' | 'none';
  data: Record<string, unknown>;
  emailsFound?: string[];
  /** Decision-maker contact returned by the Apollo people search. */
  contact?: ApolloContact;
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

    // 1. Apollo.io (decision-maker contact: name, title, and email when unlocked)
    const apolloResult = await this.tryApollo(lead, workspaceId);
    if (apolloResult) {
      const contact = apolloResult.contact ?? {};
      const fullName = [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim();
      const updates: Record<string, unknown> = {
        enrichmentData: {
          ...((lead.enrichmentData as Record<string, unknown>) ?? {}),
          ...apolloResult.data,
        },
        enrichmentStatus: 'enriched',
        enrichedAt: new Date(),
        reEnrichAfter: new Date(Date.now() + RE_ENRICH_INTERVAL_DAYS * 86_400_000),
      };
      // Only fill contact fields we don't already have — never clobber
      // a name/title/email the lead arrived with.
      if (fullName && !lead.fullName) updates.fullName = fullName;
      if (contact.title && !lead.title) updates.title = contact.title;
      if (contact.linkedinUrl && !lead.linkedinUrl) updates.linkedinUrl = contact.linkedinUrl;
      if (contact.email && !lead.email) {
        updates.email = contact.email;
        updates.emailSource = 'apollo';
      }
      await storage.updateLead(leadId, updates);
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

  // Decision-maker titles we prioritise when searching a company's people.
  private static readonly DECISION_MAKER_TITLES = [
    'owner',
    'founder',
    'co-founder',
    'ceo',
    'president',
    'managing director',
    'partner',
    'general manager',
  ];

  private async tryApollo(
    lead: Lead,
    workspaceId?: string | null
  ): Promise<EnrichmentResult | null> {
    const apiKey = process.env.APOLLO_RAPIDAPI_KEY;
    if (!apiKey) return null;

    const host =
      process.env.APOLLO_RAPIDAPI_HOST ?? 'apollo-io-no-cookies-required.p.rapidapi.com';

    try {
      const domain = this.cleanDomain(lead.website);
      if (!domain || !lead.businessName) return null;

      // This proxy's /search_people ignores domain/keyword filters and only
      // honours organization_ids. So it's a two-step flow:
      //   1. /search_organization by name → match the org whose primary_domain
      //      equals the lead's domain → grab its Apollo org id.
      //   2. /search_people?organization_ids=<id> → people at that org.
      // Step 1 also guards against same-named companies: we only proceed when
      // a returned org's domain actually matches, so we never attach a
      // contact from the wrong company.
      const orgId = await this.findApolloOrgId(
        lead.businessName,
        domain,
        apiKey,
        host,
        lead.id,
        workspaceId
      );
      if (!orgId) return null;

      // Search results do NOT include unlocked emails (only
      // extrapolated_email_confidence / email_not_unlocked@…), so we take
      // name/title/linkedin here and leave the address to Hunter/website.
      const peopleQuery = new URLSearchParams({ page: '1', organization_ids: orgId });
      const body = await this.fetchApollo<ApolloSearchResponse>(
        `https://${host}/search_people?${peopleQuery.toString()}`,
        apiKey,
        host,
        'apollo:search_people'
      );

      await trackApiCall({
        provider: 'apollo',
        endpoint: 'search_people',
        workspaceId: workspaceId ?? undefined,
        leadId: lead.id,
      });

      const people = body.data?.people ?? [];
      const person = this.pickDecisionMaker(people);
      if (!person) return null;

      const email = this.unlockedEmail(person.email);
      const contact: ApolloContact = {
        firstName: person.first_name || undefined,
        lastName: person.last_name || undefined,
        title: person.title || undefined,
        email,
        linkedinUrl: person.linkedin_url || undefined,
      };

      return {
        source: 'apollo',
        contact,
        emailsFound: email ? [email] : undefined,
        data: {
          apollo_person_id: person.id ?? null,
          apollo_org_id: orgId,
          full_name: person.name ?? null,
          first_name: contact.firstName ?? null,
          last_name: contact.lastName ?? null,
          title: contact.title ?? null,
          email: email ?? null,
          linkedin_url: person.linkedin_url ?? null,
          headline: person.headline ?? null,
          organization_name: person.organization?.name ?? null,
        },
      };
    } catch (err) {
      console.warn('[enrichment] apollo failed', err);
      return null;
    }
  }

  /**
   * Resolve a lead's company to an Apollo organization id by searching on
   * business name and matching the result whose primary_domain equals the
   * lead's website domain. Returns null when no domain-matched org is found
   * (we'd rather skip than enrich with a wrong-company contact).
   */
  private async findApolloOrgId(
    businessName: string,
    domain: string,
    apiKey: string,
    host: string,
    leadId: string,
    workspaceId?: string | null
  ): Promise<string | null> {
    const query = new URLSearchParams({ page: '1', q_organization_name: businessName });
    const body = await this.fetchApollo<ApolloOrgSearchResponse>(
      `https://${host}/search_organization?${query.toString()}`,
      apiKey,
      host,
      'apollo:search_organization'
    );

    await trackApiCall({
      provider: 'apollo',
      endpoint: 'search_organization',
      workspaceId: workspaceId ?? undefined,
      leadId,
    });

    const match = (body.data?.organizations ?? []).find(
      (o) => this.cleanDomain(o.primary_domain ?? o.website_url) === domain
    );
    return match?.id ?? null;
  }

  /**
   * Pick the best contact from an org's people. Titles are matched in
   * priority order (owner > founder > … > general manager) so a true
   * decision-maker wins over a loose match like "Talent Partner". Falls
   * back to the first person when none of the titles match.
   */
  private pickDecisionMaker(people: ApolloPerson[]): ApolloPerson | undefined {
    for (const keyword of EnrichmentService.DECISION_MAKER_TITLES) {
      const hit = people.find((p) => (p.title ?? '').toLowerCase().includes(keyword));
      if (hit) return hit;
    }
    return people[0];
  }

  /** Strip protocol/path/www and lowercase a URL or domain. */
  private cleanDomain(url: string | null | undefined): string {
    if (!url) return '';
    return url
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0]
      .toLowerCase()
      .trim();
  }

  /**
   * GET a RapidAPI Apollo endpoint. maxRetries: 0 because this plan's 429 is
   * a hard monthly quota, not transient throttling — retrying just wastes
   * time before the chain falls through to Hunter.
   */
  private async fetchApollo<T>(
    url: string,
    apiKey: string,
    host: string,
    label: string
  ): Promise<T> {
    return withRetry<T>(
      async () => {
        const res = await fetch(url, {
          headers: { 'x-rapidapi-key': apiKey, 'x-rapidapi-host': host },
        });
        if (!res.ok) {
          const err: Error & { status?: number } = new Error(`Apollo ${res.status}`);
          err.status = res.status;
          throw err;
        }
        return (await res.json()) as T;
      },
      { label, maxRetries: 0 }
    );
  }

  /**
   * Apollo masks emails in search results as `email_not_unlocked@domain`
   * (or omits them). Return the email only when it looks like a real,
   * deliverable address.
   */
  private unlockedEmail(raw: unknown): string | undefined {
    if (typeof raw !== 'string') return undefined;
    const email = raw.trim().toLowerCase();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return undefined;
    if (email.includes('not_unlocked') || email.includes('email_not_unlocked')) {
      return undefined;
    }
    return email;
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
