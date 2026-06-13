// Instant Site integration — generates a hosted one-page demo site for a lead
// by calling the ClearEdge Instant Site service (POST /api/generate { leadId }).
// Both apps share this Postgres DB, so Instant Site reads the lead by id and
// writes a `sites` row scoped to the lead/workspace; we persist the returned
// slug/url back onto the lead for the {{demo_url}} token and the lead UI.

import { storage } from '../storage';
import type { Lead } from '@shared/schema';

interface GenerateResponse {
  id: string;
  slug: string;
  url: string;
  data?: unknown;
}

export class InstantSiteService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = (process.env.INSTANT_SITE_BASE_URL || '').replace(/\/+$/, '');
  }

  isConfigured(): boolean {
    return !!this.baseUrl;
  }

  /**
   * Generate a fresh demo site for a lead and persist slug/url on the lead.
   * Throws on failure (used by the explicit "Generate demo site" button).
   */
  async generateForLead(leadId: string): Promise<{ slug: string; url: string }> {
    if (!this.isConfigured()) {
      throw new Error('Instant Site is not configured. Set INSTANT_SITE_BASE_URL.');
    }
    const res = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadId }),
    });
    if (!res.ok) {
      let message = `Instant Site request failed (${res.status})`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body?.error) message = body.error;
      } catch {
        /* keep default */
      }
      throw new Error(message);
    }
    const body = (await res.json()) as GenerateResponse;
    await storage.updateLead(leadId, {
      demoSiteSlug: body.slug,
      demoSiteUrl: body.url,
    } as Partial<Lead>);
    return { slug: body.slug, url: body.url };
  }

  /**
   * Return the lead's demo URL, generating one if missing. Never throws — the
   * send path must not break if Instant Site is down or unconfigured.
   */
  async ensureDemoForLead(lead: Lead): Promise<string | null> {
    if (lead.demoSiteUrl) return lead.demoSiteUrl;
    if (!this.isConfigured()) return null;
    try {
      const { url } = await this.generateForLead(lead.id);
      return url;
    } catch (err) {
      console.error('[instantSite] ensureDemoForLead failed', lead.id, err);
      return null;
    }
  }
}

export const instantSiteService = new InstantSiteService();
