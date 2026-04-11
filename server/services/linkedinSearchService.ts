// LinkedIn search via Unipile — ported from ClearEdge Leads
// api/linkedin-search.js. Pure service layer: no Express request/response
// objects leak in; route handlers in server/routes.ts wrap these methods.
//
// The reference made direct Supabase queries; this port uses Drizzle via
// storage.ts. Rate limiting lives in linkedinLimiter.ts. Retry wraps the
// Unipile HTTP call via withRetry.

import { storage } from '../storage';
import { withRetry } from '../lib/retry';
import { isAllowed, record, remaining } from '../lib/linkedinLimiter';
import { trackApiCall } from '../lib/apiTracker';
import type { InsertLead, Lead } from '@shared/schema';

export interface LinkedInSearchParams {
  query?: string;
  title?: string;
  company?: string;
  industry?: string;
  location?: string;
  cursor?: string;
}

export interface NormalizedProfile {
  linkedinUrl: string | null;
  fullName: string | null;
  headline: string | null;
  location: string | null;
  industry: string | null;
  connectionDegree: number | null;
  memberId: string | null;
  profilePicture: string | null;
  publicIdentifier: string | null;
}

export interface LinkedInSearchResult {
  profiles: NormalizedProfile[];
  total: number;
  cursor: string | null;
}

export interface SaveProfilesResult {
  saved: number;
  skipped: number;
  errors: number;
}

export class LinkedInSearchLimitError extends Error {
  status = 429;
  remaining: number;
  constructor() {
    super('LinkedIn search hourly limit reached. Try again later.');
    this.remaining = remaining('search');
  }
}

interface UnipileRawProfile {
  id?: string;
  name?: string;
  headline?: string;
  location?: string;
  industry?: string;
  network_distance?: string;
  public_profile_url?: string;
  profile_url?: string;
  public_identifier?: string;
  profile_picture_url?: string;
}

interface UnipileSearchResponse {
  items?: UnipileRawProfile[];
  paging?: { total_count?: number };
  cursor?: string | null;
}

function getBaseUrl(): string {
  const raw =
    process.env.UNIPILE_BASE_URL || 'https://api30.unipile.com:16074/api/v1/accounts';
  return raw.replace(/\/api\/v1\/accounts\/?$/, '');
}

function degreeFromDistance(distance?: string): number | null {
  if (distance === 'DISTANCE_1') return 1;
  if (distance === 'DISTANCE_2') return 2;
  if (distance === 'DISTANCE_3') return 3;
  return null;
}

function normalizeProfile(p: UnipileRawProfile): NormalizedProfile {
  let linkedinUrl = p.public_profile_url ?? p.profile_url ?? null;
  if (!linkedinUrl && p.public_identifier) {
    linkedinUrl = `https://www.linkedin.com/in/${p.public_identifier}`;
  }
  return {
    linkedinUrl,
    fullName: p.name ?? null,
    headline: p.headline ?? null,
    location: p.location ?? null,
    industry: p.industry ?? null,
    connectionDegree: degreeFromDistance(p.network_distance),
    memberId: p.id ?? null,
    profilePicture: p.profile_picture_url ?? null,
    publicIdentifier: p.public_identifier ?? null,
  };
}

export class LinkedInSearchService {
  async search(
    params: LinkedInSearchParams,
    workspaceId?: string | null
  ): Promise<LinkedInSearchResult> {
    if (!isAllowed('search')) {
      throw new LinkedInSearchLimitError();
    }

    // Prefer workspace-scoped account ID from app_config, fall back to env.
    const configured = await storage.getAppConfig('unipile_account_id', workspaceId);
    const accountId =
      configured && configured !== 'YOUR_LINKEDIN_ACCOUNT_ID'
        ? configured
        : process.env.UNIPILE_ACCOUNT_ID;

    if (!accountId) {
      throw new Error('Unipile account ID not configured (app_config or UNIPILE_ACCOUNT_ID)');
    }

    const apiKey = process.env.UNIPILE_API_KEY;
    if (!apiKey) {
      throw new Error('UNIPILE_API_KEY not set');
    }

    const keywords = [params.query, params.title, params.company, params.industry, params.location]
      .filter(Boolean)
      .join(' ');

    const searchUrl = `${getBaseUrl()}/api/v1/linkedin/search?account_id=${encodeURIComponent(accountId)}`;

    const searchBody: Record<string, unknown> = {
      api: 'classic',
      category: 'people',
      keywords,
      limit: 100,
    };
    if (params.cursor) searchBody.cursor = params.cursor;

    const result = await withRetry<UnipileSearchResponse>(
      async () => {
        const response = await fetch(searchUrl, {
          method: 'POST',
          headers: {
            'X-API-KEY': apiKey,
            'Content-Type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify(searchBody),
        });
        if (!response.ok) {
          const text = await response.text();
          const err: Error & { status?: number } = new Error(
            `Unipile ${response.status}: ${text}`
          );
          err.status = response.status;
          throw err;
        }
        return (await response.json()) as UnipileSearchResponse;
      },
      { label: 'unipile:linkedin-search' }
    );

    record('search');

    const profiles = (result.items ?? []).map(normalizeProfile);
    const total = result.paging?.total_count ?? profiles.length;

    await trackApiCall({
      provider: 'unipile',
      endpoint: 'linkedin/search',
      workspaceId: workspaceId ?? undefined,
    });

    return { profiles, total, cursor: result.cursor ?? null };
  }

  async saveProfiles(
    profiles: NormalizedProfile[],
    userId: string,
    workspaceId?: string | null
  ): Promise<{ result: SaveProfilesResult; leads: Lead[] }> {
    const out: SaveProfilesResult = { saved: 0, skipped: 0, errors: 0 };
    const savedLeads: Lead[] = [];

    for (const p of profiles) {
      if (!p.linkedinUrl) {
        out.errors++;
        continue;
      }
      try {
        const lead: InsertLead = {
          leadSource: 'linkedin',
          workspaceId: workspaceId ?? null,
          linkedinUrl: p.linkedinUrl,
          fullName: p.fullName,
          title: p.headline,
          headline: p.headline,
          industry: p.industry,
          connectionDegree: p.connectionDegree,
          unipileMemberId: p.memberId,
          businessName: p.fullName ?? 'LinkedIn prospect',
          status: 'new',
          linkedinScore: 0,
          createdBy: userId,
        };
        const { inserted, lead: row } = await storage.upsertLeadByLinkedInUrl(lead);
        if (inserted) out.saved++;
        else out.skipped++;
        savedLeads.push(row);
      } catch (err) {
        console.error('[linkedinSearch] save error', err);
        out.errors++;
      }
    }

    return { result: out, leads: savedLeads };
  }
}

export const linkedInSearchService = new LinkedInSearchService();
