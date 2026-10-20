// Instant Site integration — generates a hosted one-page demo site for a lead.
// Generation runs in-process (server/sites); this class keeps the interface
// that queueGenerationService and the generate-demo route already use. The
// slug/url are persisted back onto the lead for the {{demo_url}} token and the
// lead UI.

import { storage } from '../storage';
import type { Lead } from '@shared/schema';
import { siteGenerator } from '../sites/service';
import { publicSiteBaseUrl, publicSiteUrl } from '../sites/urls';

export class InstantSiteService {
  /**
   * Generation itself always works for a lead (copy falls back to a template
   * without ANTHROPIC_API_KEY). What it can't do without config is produce a
   * link that resolves, so this checks for PUBLIC_SITE_BASE_URL.
   */
  isConfigured(): boolean {
    return !!publicSiteBaseUrl();
  }

  /**
   * Return the lead's demo site, generating one if it has none (or always,
   * with `force`), and persist slug/url on the lead. Throws on failure (used by
   * the explicit "Generate demo site" button).
   */
  async generateForLead(
    leadId: string,
    opts: { force?: boolean } = {}
  ): Promise<{ slug: string; url: string }> {
    if (!this.isConfigured()) {
      throw new Error('Demo sites are not configured. Set PUBLIC_SITE_BASE_URL.');
    }
    const lead = await storage.getLead(leadId);
    if (!lead) throw new Error('Lead not found');

    const { site } = await siteGenerator.fromLead({
      leadId: lead.id,
      workspaceId: lead.workspaceId ?? null,
      force: opts.force,
    });
    const url = publicSiteUrl(site.slug);
    await storage.updateLead(lead.id, {
      demoSiteSlug: site.slug,
      demoSiteUrl: url,
    } as Partial<Lead>);
    return { slug: site.slug, url };
  }

  /**
   * Return the lead's demo URL, generating one if missing. Never throws — the
   * send path must not break if generation fails or isn't configured.
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
