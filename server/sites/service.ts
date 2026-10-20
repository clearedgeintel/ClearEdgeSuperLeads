// Wires the sites module to the app's database and API clients. Everything
// else in server/sites takes these as parameters so it can be tested alone.

import { and, eq, ilike } from 'drizzle-orm';
import { db } from '../db';
import { storage } from '../storage';
import { gbpProfiles } from '@shared/schema';
import { createSiteRepository } from './repository';
import { createGenerator } from './generator';
import { getProvider, isAnthropicConfigured } from './enrich';
import { LeadProvider, type LeadSource } from './enrich/lead';

export const siteRepository = createSiteRepository(db);

const leadSource: LeadSource = {
  getLead: (id) => storage.getLead(id),
  async findGbpProfile(businessName, workspaceId) {
    // Exact, case-insensitive match. Escape LIKE wildcards in the name.
    const pattern = businessName.replace(/[\\%_]/g, (c) => `\\${c}`);
    const [row] = await db
      .select()
      .from(gbpProfiles)
      .where(
        and(
          ilike(gbpProfiles.businessName, pattern),
          workspaceId ? eq(gbpProfiles.workspaceId, workspaceId) : undefined
        )
      )
      .limit(1);
    return row;
  },
};

const leadProvider = new LeadProvider(leadSource);

export const siteGenerator = createGenerator({
  repo: siteRepository,
  fromLead: (leadId, workspaceId) => leadProvider.fromLead(leadId, workspaceId),
  lookup: (nameHint, locHint, ctx) => getProvider().lookup(nameHint, locHint, ctx),
  anthropicConfigured: isAnthropicConfigured,
});
