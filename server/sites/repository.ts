// Data access for sites, site_submissions and site_views, on Drizzle.
// Replaces Instant Site's supabase-js lib/sites.ts, submissions.ts and views.ts.
//
// Admin methods (`*ForWorkspace`) always filter on workspace_id: a site in
// another workspace is indistinguishable from a missing one. Public methods
// resolve exactly one site (by slug or custom domain) and touch only that site.
//
// The database handle is injected so tests can run against PGlite; the app's
// instance lives in ./service.ts.

import { and, asc, count, desc, eq, gte, isNull, lt, lte, max, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from '@shared/schema';
import {
  notifications,
  sites,
  siteSubmissions,
  siteViews,
  users,
  type SiteRow,
  type SiteSubmissionRow,
} from '@shared/schema';
import {
  THEMES_LIST,
  SITE_STATUSES,
  type BusinessData,
  type Site,
  type SiteListItem,
  type SitePhoto,
  type SiteStatus,
  type SiteSubmission,
  type Theme,
} from '@shared/sites';
import { uniqueSlug } from './slug';

export type SitesDb = PgDatabase<PgQueryResultHKT, typeof schema>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Site ids are uuids; anything else can't match, so skip the query (and the 22P02). */
export function isUuid(id: string): boolean {
  return UUID_RE.test(id);
}

/** Thrown when a custom domain is already used by another site. */
export class CustomDomainTakenError extends Error {
  constructor(domain: string) {
    super(`The domain ${domain} is already used by another site.`);
    this.name = 'CustomDomainTakenError';
  }
}

function pgError(err: unknown): { code?: string; constraint?: string } {
  const e = err as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  return { code: e?.code ?? e?.cause?.code, constraint: e?.constraint ?? e?.cause?.constraint };
}

function iso(v: Date | string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

export function rowToSite(row: SiteRow): Site {
  return {
    id: row.id,
    slug: row.slug,
    theme: (THEMES_LIST as readonly string[]).includes(row.theme) ? (row.theme as Theme) : 'slate',
    status: (SITE_STATUSES as readonly string[]).includes(row.status)
      ? (row.status as SiteStatus)
      : 'draft',
    data: row.data,
    workspaceId: row.workspaceId ?? null,
    leadId: row.leadId ?? null,
    createdBy: row.createdBy ?? null,
    photos: Array.isArray(row.photos) ? row.photos : [],
    customDomain: row.customDomain ?? null,
    notifyEmail: row.notifyEmail ?? null,
    publishedAt: iso(row.publishedAt),
    createdAt: iso(row.createdAt)!,
    updatedAt: iso(row.updatedAt)!,
  };
}

function rowToSubmission(r: SiteSubmissionRow): SiteSubmission {
  return {
    id: r.id,
    siteId: r.siteId,
    leadId: r.leadId,
    workspaceId: r.workspaceId,
    name: r.name,
    email: r.email,
    phone: r.phone,
    message: r.message,
    createdAt: iso(r.createdAt)!,
  };
}

export interface CreateSiteInput {
  data: BusinessData;
  theme: Theme;
  status?: SiteStatus;
  workspaceId: string | null;
  leadId?: string | null;
  createdBy?: string | null;
}

export interface SitePatch {
  data?: BusinessData;
  theme?: Theme;
  photos?: SitePhoto[];
  notifyEmail?: string | null;
  customDomain?: string | null;
}

/** A submission whose owner email hasn't gone out, with the site it belongs to. */
export interface PendingNotification {
  submission: SiteSubmission;
  attempts: number;
  site: Site;
}

export function createSiteRepository(db: SitesDb) {
  const active = isNull(sites.deletedAt);
  const inWorkspace = (id: string, workspaceId: string) =>
    and(eq(sites.id, id), eq(sites.workspaceId, workspaceId), active);

  async function first(where: ReturnType<typeof and>): Promise<Site | null> {
    const [row] = await db.select().from(sites).where(where).orderBy(desc(sites.createdAt)).limit(1);
    return row ? rowToSite(row) : null;
  }

  async function isSlugTaken(slug: string): Promise<boolean> {
    const [row] = await db.select({ id: sites.id }).from(sites).where(eq(sites.slug, slug)).limit(1);
    return !!row;
  }

  return {
    isSlugTaken,

    // ── Admin (workspace-scoped) ───────────────────────────────

    /** Sites in a workspace, newest first, with submission/view aggregates from GROUP BY. */
    async listForWorkspace(workspaceId: string): Promise<SiteListItem[]> {
      const sub = db
        .select({ siteId: siteSubmissions.siteId, n: count().as('submission_count') })
        .from(siteSubmissions)
        .groupBy(siteSubmissions.siteId)
        .as('sub');
      const vw = db
        .select({
          siteId: siteViews.siteId,
          n: count().as('view_count'),
          last: max(siteViews.createdAt).as('last_viewed_at'),
        })
        .from(siteViews)
        .groupBy(siteViews.siteId)
        .as('vw');

      const rows = await db
        .select({
          site: sites,
          submissionCount: sql<number>`coalesce(${sub.n}, 0)`.mapWith(Number),
          viewCount: sql<number>`coalesce(${vw.n}, 0)`.mapWith(Number),
          lastViewedAt: vw.last,
        })
        .from(sites)
        .leftJoin(sub, eq(sub.siteId, sites.id))
        .leftJoin(vw, eq(vw.siteId, sites.id))
        .where(and(eq(sites.workspaceId, workspaceId), active))
        .orderBy(desc(sites.createdAt));

      return rows.map((r) => ({
        ...rowToSite(r.site),
        submissionCount: r.submissionCount,
        viewCount: r.viewCount,
        lastViewedAt: iso(r.lastViewedAt as Date | string | null),
      }));
    },

    async getForWorkspace(id: string, workspaceId: string): Promise<Site | null> {
      if (!isUuid(id)) return null;
      return first(inWorkspace(id, workspaceId));
    },

    /** Most recent active site for a lead in this workspace (idempotent generation). */
    async getByLeadForWorkspace(leadId: string, workspaceId: string | null): Promise<Site | null> {
      return first(
        and(
          eq(sites.leadId, leadId),
          workspaceId ? eq(sites.workspaceId, workspaceId) : isNull(sites.workspaceId),
          active
        )
      );
    },

    /** Most recent active site for a resolved Maps URL in this workspace (idempotent generation). */
    async getByMapsUrlForWorkspace(mapsUrl: string, workspaceId: string): Promise<Site | null> {
      if (!mapsUrl) return null;
      return first(and(eq(sites.mapsUrl, mapsUrl), eq(sites.workspaceId, workspaceId), active));
    },

    async create(input: CreateSiteInput): Promise<Site> {
      // The pre-check in uniqueSlug can race; the unique index is the real guard.
      for (let attempt = 0; ; attempt++) {
        const slug = await uniqueSlug(input.data.name, isSlugTaken);
        try {
          const [row] = await db
            .insert(sites)
            .values({
              slug,
              businessName: input.data.name,
              mapsUrl: input.data.mapsUrl || null,
              theme: input.theme,
              status: input.status ?? 'draft',
              data: input.data,
              workspaceId: input.workspaceId,
              leadId: input.leadId ?? null,
              createdBy: input.createdBy ?? null,
            })
            .returning();
          return rowToSite(row);
        } catch (err) {
          const { code, constraint } = pgError(err);
          if (code === '23505' && constraint === 'sites_slug_key' && attempt < 3) continue;
          throw err;
        }
      }
    },

    async updateForWorkspace(id: string, workspaceId: string, patch: SitePatch): Promise<Site | null> {
      if (!isUuid(id)) return null;
      const set: Partial<typeof sites.$inferInsert> = { updatedAt: new Date() };
      if (patch.data) {
        set.data = patch.data;
        set.businessName = patch.data.name;
        set.mapsUrl = patch.data.mapsUrl || null;
      }
      if (patch.theme) set.theme = patch.theme;
      if (patch.photos) set.photos = patch.photos;
      if (patch.notifyEmail !== undefined) set.notifyEmail = patch.notifyEmail;
      if (patch.customDomain !== undefined) set.customDomain = patch.customDomain;
      try {
        const [row] = await db.update(sites).set(set).where(inWorkspace(id, workspaceId)).returning();
        return row ? rowToSite(row) : null;
      } catch (err) {
        const { code, constraint } = pgError(err);
        if (code === '23505' && constraint === 'sites_custom_domain_key') {
          throw new CustomDomainTakenError(patch.customDomain ?? '');
        }
        throw err;
      }
    },

    async publishForWorkspace(id: string, workspaceId: string): Promise<Site | null> {
      if (!isUuid(id)) return null;
      const now = new Date();
      const [row] = await db
        .update(sites)
        .set({ status: 'live', publishedAt: now, updatedAt: now })
        .where(inWorkspace(id, workspaceId))
        .returning();
      return row ? rowToSite(row) : null;
    },

    /** Back to a demo. published_at is kept as a record of the last publish. */
    async unpublishForWorkspace(id: string, workspaceId: string): Promise<Site | null> {
      if (!isUuid(id)) return null;
      const [row] = await db
        .update(sites)
        .set({ status: 'draft', updatedAt: new Date() })
        .where(inWorkspace(id, workspaceId))
        .returning();
      return row ? rowToSite(row) : null;
    },

    async softDeleteForWorkspace(id: string, workspaceId: string): Promise<boolean> {
      if (!isUuid(id)) return false;
      const rows = await db
        .update(sites)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(inWorkspace(id, workspaceId))
        .returning({ id: sites.id });
      return rows.length > 0;
    },

    /** Permanently delete (cascades submissions/views). Also removes soft-deleted sites. */
    async hardDeleteForWorkspace(id: string, workspaceId: string): Promise<boolean> {
      if (!isUuid(id)) return false;
      const rows = await db
        .delete(sites)
        .where(and(eq(sites.id, id), eq(sites.workspaceId, workspaceId)))
        .returning({ id: sites.id });
      return rows.length > 0;
    },

    async listSubmissionsForWorkspace(siteId: string, workspaceId: string): Promise<SiteSubmission[] | null> {
      if (!isUuid(siteId)) return null;
      const [owned] = await db
        .select({ id: sites.id })
        .from(sites)
        .where(and(eq(sites.id, siteId), eq(sites.workspaceId, workspaceId)))
        .limit(1);
      if (!owned) return null;
      const rows = await db
        .select()
        .from(siteSubmissions)
        .where(eq(siteSubmissions.siteId, siteId))
        .orderBy(desc(siteSubmissions.createdAt));
      return rows.map(rowToSubmission);
    },

    // ── Public (one site at a time; used by the public server) ──

    async getBySlug(slug: string): Promise<Site | null> {
      return first(and(eq(sites.slug, slug), active));
    },

    async getLiveByCustomDomain(domain: string): Promise<Site | null> {
      return first(and(eq(sites.customDomain, domain), eq(sites.status, 'live'), active));
    },

    async createSubmission(
      site: Pick<Site, 'id' | 'leadId' | 'workspaceId'>,
      fields: { name: string | null; email: string | null; phone: string | null; message: string | null }
    ): Promise<SiteSubmission> {
      const [row] = await db
        .insert(siteSubmissions)
        .values({
          siteId: site.id,
          leadId: site.leadId,
          workspaceId: site.workspaceId,
          ...fields,
        })
        .returning();
      return rowToSubmission(row);
    },

    // ── Owner notifications ──────────────────────────────────

    async markSubmissionNotified(id: string): Promise<void> {
      await db.update(siteSubmissions).set({ notifiedAt: new Date() }).where(eq(siteSubmissions.id, id));
    },

    async recordNotifyFailure(id: string): Promise<void> {
      await db
        .update(siteSubmissions)
        .set({ notifyAttempts: sql`${siteSubmissions.notifyAttempts} + 1` })
        .where(eq(siteSubmissions.id, id));
    },

    /** Un-notified submissions created in [since, before) with attempts left, oldest first. */
    async listPendingNotifications(opts: {
      since: Date;
      before: Date;
      maxAttempts: number;
      limit: number;
    }): Promise<PendingNotification[]> {
      const rows = await db
        .select({ submission: siteSubmissions, site: sites })
        .from(siteSubmissions)
        .innerJoin(sites, eq(sites.id, siteSubmissions.siteId))
        .where(
          and(
            isNull(siteSubmissions.notifiedAt),
            lt(siteSubmissions.notifyAttempts, opts.maxAttempts),
            gte(siteSubmissions.createdAt, opts.since),
            lte(siteSubmissions.createdAt, opts.before),
            isNull(sites.deletedAt)
          )
        )
        .orderBy(asc(siteSubmissions.createdAt))
        .limit(opts.limit);
      return rows.map((r) => ({
        submission: rowToSubmission(r.submission),
        attempts: r.submission.notifyAttempts,
        site: rowToSite(r.site),
      }));
    },

    /** One in-app notification per member of the workspace (the bell is per-user). */
    async notifyWorkspaceMembers(
      workspaceId: string,
      n: { type: string; title: string; body: string | null; link: string | null }
    ): Promise<number> {
      const members = await db.select({ id: users.id }).from(users).where(eq(users.workspaceId, workspaceId));
      if (!members.length) return 0;
      await db.insert(notifications).values(
        members.map((m) => ({ id: nanoid(), workspaceId, userId: m.id, ...n }))
      );
      return members.length;
    },

    async recordView(siteId: string, meta: { referrer?: string | null; userAgent?: string | null } = {}) {
      await db.insert(siteViews).values({
        siteId,
        referrer: meta.referrer ? meta.referrer.slice(0, 1000) : null,
        userAgent: meta.userAgent ? meta.userAgent.slice(0, 1000) : null,
      });
    },
  };
}

export type SiteRepository = ReturnType<typeof createSiteRepository>;
