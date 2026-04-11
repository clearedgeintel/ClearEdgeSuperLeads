import {
  users,
  leads,
  gbpProfiles,
  campaigns,
  campaignSteps,
  campaignEnrollments,
  sendQueue,
  sendLog,
  engagementEvents,
  outreachEmails,
  workspaces,
  appConfig,
  type User,
  type UpsertUser,
  type Lead,
  type InsertLead,
  type GbpProfile,
  type InsertGbpProfile,
  type Campaign,
  type InsertCampaign,
  type CampaignStep,
  type InsertCampaignStep,
  type CampaignEnrollment,
  type InsertCampaignEnrollment,
  type SendQueueItem,
  type InsertSendQueueItem,
  type SendLogEntry,
  type EngagementEvent,
  type OutreachEmail,
  type InsertOutreachEmail,
  type Workspace,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc, asc, isNull, or, sql, gte, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";

export interface IStorage {
  // Workspace operations
  getWorkspace(id: string): Promise<Workspace | undefined>;
  createPersonalWorkspace(userId: string, email: string | null): Promise<Workspace>;

  // App config
  getAppConfig(key: string, workspaceId?: string | null): Promise<string | null>;

  // User operations
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  updateUserTokens(id: string, accessToken: string, refreshToken: string, expiresAt: Date): Promise<void>;

  // Lead operations
  createLead(lead: InsertLead): Promise<Lead>;
  upsertLeadByLinkedInUrl(
    lead: InsertLead
  ): Promise<{ lead: Lead; inserted: boolean }>;
  getLeads(
    userId: string,
    workspaceId?: string | null,
    filters?: { priority?: string; status?: string }
  ): Promise<Lead[]>;
  getLead(id: string): Promise<Lead | undefined>;
  updateLead(id: string, updates: Partial<Lead>): Promise<Lead>;
  updateLeadAiAnalysis(id: string, score: number, analysis: any): Promise<void>;

  // GBP Profile operations
  createGbpProfile(profile: InsertGbpProfile): Promise<GbpProfile>;
  getGbpProfiles(userId: string, workspaceId?: string | null): Promise<GbpProfile[]>;
  getGbpProfile(id: string): Promise<GbpProfile | undefined>;
  updateGbpProfile(id: string, updates: Partial<GbpProfile>): Promise<GbpProfile>;
  syncGbpProfile(locationId: string, profileData: any): Promise<void>;

  // Outreach operations
  createCampaign(campaign: InsertCampaign): Promise<Campaign>;
  getCampaigns(userId: string, workspaceId?: string | null): Promise<Campaign[]>;
  getCampaign(id: string): Promise<Campaign | undefined>;
  updateCampaign(id: string, updates: Partial<Campaign>): Promise<Campaign>;
  deleteCampaign(id: string): Promise<void>;

  // Campaign steps
  createCampaignStep(step: InsertCampaignStep): Promise<CampaignStep>;
  getCampaignSteps(campaignId: string): Promise<CampaignStep[]>;
  deleteCampaignStep(id: string): Promise<void>;

  // Campaign enrollments
  enrollLead(enrollment: InsertCampaignEnrollment): Promise<CampaignEnrollment>;
  getEnrollments(campaignId: string): Promise<CampaignEnrollment[]>;
  getEnrollment(id: string): Promise<CampaignEnrollment | undefined>;
  getActiveEnrollmentsForLead(leadId: string): Promise<CampaignEnrollment[]>;
  getAllActiveEnrollments(): Promise<CampaignEnrollment[]>;
  updateEnrollment(id: string, updates: Partial<CampaignEnrollment>): Promise<CampaignEnrollment>;

  // Campaign step lookups
  getCampaignStep(id: string): Promise<CampaignStep | undefined>;
  getCampaignStepByOrder(campaignId: string, stepOrder: number): Promise<CampaignStep | undefined>;

  // Send queue
  createSendQueueItem(item: InsertSendQueueItem): Promise<SendQueueItem>;
  getSendQueueItem(id: string): Promise<SendQueueItem | undefined>;
  getSendQueueByStatus(status: string, workspaceId?: string | null): Promise<SendQueueItem[]>;
  updateSendQueueItem(id: string, updates: Partial<SendQueueItem>): Promise<SendQueueItem>;
  findExistingQueueItem(enrollmentId: string, campaignStepId: string): Promise<SendQueueItem | undefined>;
  bulkUpdateQueueStatus(ids: string[], fromStatus: string, toStatus: string): Promise<number>;
  getQueueStats(workspaceId?: string | null): Promise<Record<string, number>>;

  // Send log
  createSendLog(entry: Omit<SendLogEntry, 'id'>): Promise<SendLogEntry>;
  countSuccessfulSends(campaignId: string, leadId: string): Promise<number>;
  countSendsForCampaignSince(campaignId: string, since: Date): Promise<number>;
  getLastSendForCampaignLead(campaignId: string, leadId: string): Promise<SendLogEntry | undefined>;

  // Engagement
  createEngagementEvent(event: Omit<EngagementEvent, 'id'>): Promise<EngagementEvent>;
  getEngagementEventsForLead(leadId: string): Promise<EngagementEvent[]>;
  hasEngagementEvent(leadId: string, eventType: string): Promise<boolean>;
  getRecentInboxEvents(workspaceId?: string | null, limit?: number): Promise<Array<EngagementEvent & { lead: Lead | null }>>;

  // Lead lookups for inbox sync
  getLeadsWithUnipileMemberId(workspaceId?: string | null): Promise<Lead[]>;
  getActiveEnrollmentForLead(leadId: string): Promise<CampaignEnrollment | undefined>;
  getLastSentQueueItemForLead(leadId: string): Promise<SendQueueItem | undefined>;

  // Email outreach
  createOutreachEmail(email: InsertOutreachEmail): Promise<OutreachEmail>;
  getOutreachEmails(campaignId?: string): Promise<OutreachEmail[]>;
  getOutreachEmailsByUser(userId: string, workspaceId?: string | null): Promise<OutreachEmail[]>;
  updateOutreachEmailStatus(id: string, status: string, timestamp?: Date): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  // Workspace operations
  async getWorkspace(id: string): Promise<Workspace | undefined> {
    const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, id));
    return workspace;
  }

  async createPersonalWorkspace(userId: string, email: string | null): Promise<Workspace> {
    const slug = (email?.split('@')[0] || userId).toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const [workspace] = await db
      .insert(workspaces)
      .values({
        id: nanoid(),
        name: email ? `${email}'s workspace` : 'Personal workspace',
        slug: `${slug}-${nanoid(6).toLowerCase()}`,
        plan: 'free',
      })
      .returning();
    return workspace;
  }

  // App config — workspace-scoped key/value store. Falls back to a
  // workspace-null row if the workspace-specific key isn't set.
  async getAppConfig(key: string, workspaceId?: string | null): Promise<string | null> {
    const rows = await db
      .select()
      .from(appConfig)
      .where(
        and(
          eq(appConfig.key, key),
          workspaceId
            ? or(eq(appConfig.workspaceId, workspaceId), isNull(appConfig.workspaceId))!
            : isNull(appConfig.workspaceId)
        )
      );

    if (rows.length === 0) return null;
    // Prefer workspace-specific row over the global fallback.
    const scoped = rows.find((r) => r.workspaceId === workspaceId);
    return (scoped ?? rows[0]).value;
  }

  // User operations
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();

    // Auto-create a personal workspace on first login. In Phase 9 this is
    // replaced by the invite/Stripe flow, but Phase 1 users land here.
    if (!user.workspaceId) {
      const workspace = await this.createPersonalWorkspace(user.id, user.email ?? null);
      const [updated] = await db
        .update(users)
        .set({ workspaceId: workspace.id, updatedAt: new Date() })
        .where(eq(users.id, user.id))
        .returning();
      return updated;
    }

    return user;
  }

  async updateUserTokens(id: string, accessToken: string, refreshToken: string, expiresAt: Date): Promise<void> {
    await db
      .update(users)
      .set({
        googleAccessToken: accessToken,
        googleRefreshToken: refreshToken,
        tokenExpiresAt: expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id));
  }

  // Lead operations
  async createLead(leadData: InsertLead): Promise<Lead> {
    const [lead] = await db
      .insert(leads)
      .values({
        id: nanoid(),
        ...leadData,
      })
      .returning();
    return lead;
  }

  // Upsert a LinkedIn lead on the linkedin_url natural key. Returns the row
  // and whether it was newly inserted (true) or already existed (false).
  // Note: leads.linkedin_url is NOT constrained unique in the schema yet
  // (Phase 9 adds per-workspace uniqueness), so we do find-then-insert.
  async upsertLeadByLinkedInUrl(
    leadData: InsertLead
  ): Promise<{ lead: Lead; inserted: boolean }> {
    if (!leadData.linkedinUrl) {
      throw new Error('upsertLeadByLinkedInUrl: linkedinUrl is required');
    }
    const [existing] = await db
      .select()
      .from(leads)
      .where(eq(leads.linkedinUrl, leadData.linkedinUrl));

    if (existing) {
      return { lead: existing, inserted: false };
    }

    const [inserted] = await db
      .insert(leads)
      .values({ id: nanoid(), ...leadData })
      .returning();
    return { lead: inserted, inserted: true };
  }

  async getLeads(
    userId: string,
    workspaceId?: string | null,
    filters?: { priority?: string; status?: string }
  ): Promise<Lead[]> {
    const conditions = [eq(leads.createdBy, userId)];

    if (workspaceId) {
      conditions.push(eq(leads.workspaceId, workspaceId));
    }
    if (filters?.priority) {
      conditions.push(eq(leads.priority, filters.priority));
    }
    if (filters?.status) {
      conditions.push(eq(leads.status, filters.status));
    }

    return await db.select().from(leads).where(and(...conditions));
  }

  async getLead(id: string): Promise<Lead | undefined> {
    const [lead] = await db.select().from(leads).where(eq(leads.id, id));
    return lead;
  }

  async updateLead(id: string, updates: Partial<Lead>): Promise<Lead> {
    const [lead] = await db
      .update(leads)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(leads.id, id))
      .returning();
    return lead;
  }

  async updateLeadAiAnalysis(id: string, score: number, analysis: any): Promise<void> {
    await db
      .update(leads)
      .set({
        aiScore: score,
        aiAnalysis: analysis,
        updatedAt: new Date(),
      })
      .where(eq(leads.id, id));
  }

  // GBP Profile operations
  async createGbpProfile(profileData: InsertGbpProfile): Promise<GbpProfile> {
    const [profile] = await db
      .insert(gbpProfiles)
      .values({
        id: nanoid(),
        ...profileData,
      })
      .returning();
    return profile;
  }

  async getGbpProfiles(userId: string, workspaceId?: string | null): Promise<GbpProfile[]> {
    const conditions = [eq(gbpProfiles.managedBy, userId)];
    if (workspaceId) conditions.push(eq(gbpProfiles.workspaceId, workspaceId));
    return await db.select().from(gbpProfiles).where(and(...conditions));
  }

  async getGbpProfile(id: string): Promise<GbpProfile | undefined> {
    const [profile] = await db.select().from(gbpProfiles).where(eq(gbpProfiles.id, id));
    return profile;
  }

  async updateGbpProfile(id: string, updates: Partial<GbpProfile>): Promise<GbpProfile> {
    const [profile] = await db
      .update(gbpProfiles)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(gbpProfiles.id, id))
      .returning();
    return profile;
  }

  async syncGbpProfile(locationId: string, profileData: any): Promise<void> {
    await db
      .update(gbpProfiles)
      .set({
        ...profileData,
        lastSynced: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(gbpProfiles.locationId, locationId));
  }

  // Outreach operations
  async createCampaign(campaignData: InsertCampaign): Promise<Campaign> {
    const [campaign] = await db
      .insert(campaigns)
      .values({
        id: nanoid(),
        ...campaignData,
      })
      .returning();
    return campaign;
  }

  async getCampaigns(userId: string, workspaceId?: string | null): Promise<Campaign[]> {
    const conditions = [eq(campaigns.createdBy, userId)];
    if (workspaceId) conditions.push(eq(campaigns.workspaceId, workspaceId));
    return await db.select().from(campaigns).where(and(...conditions));
  }

  async getCampaign(id: string): Promise<Campaign | undefined> {
    const [row] = await db.select().from(campaigns).where(eq(campaigns.id, id));
    return row;
  }

  async updateCampaign(id: string, updates: Partial<Campaign>): Promise<Campaign> {
    const [row] = await db
      .update(campaigns)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(campaigns.id, id))
      .returning();
    return row;
  }

  async deleteCampaign(id: string): Promise<void> {
    // Soft delete — preserves send_log and engagement_events referential integrity.
    await db
      .update(campaigns)
      .set({ isDeleted: true, updatedAt: new Date() })
      .where(eq(campaigns.id, id));
  }

  // Campaign steps — multi-step LinkedIn sequences
  async createCampaignStep(stepData: InsertCampaignStep): Promise<CampaignStep> {
    const [step] = await db
      .insert(campaignSteps)
      .values({ id: nanoid(), ...stepData })
      .returning();
    return step;
  }

  async getCampaignSteps(campaignId: string): Promise<CampaignStep[]> {
    return await db
      .select()
      .from(campaignSteps)
      .where(eq(campaignSteps.campaignId, campaignId))
      .orderBy(asc(campaignSteps.stepOrder));
  }

  async deleteCampaignStep(id: string): Promise<void> {
    await db.delete(campaignSteps).where(eq(campaignSteps.id, id));
  }

  // Campaign enrollments — a lead's progress through a campaign
  async enrollLead(enrollmentData: InsertCampaignEnrollment): Promise<CampaignEnrollment> {
    const [enrollment] = await db
      .insert(campaignEnrollments)
      .values({ id: nanoid(), ...enrollmentData })
      .returning();
    return enrollment;
  }

  async getEnrollments(campaignId: string): Promise<CampaignEnrollment[]> {
    return await db
      .select()
      .from(campaignEnrollments)
      .where(eq(campaignEnrollments.campaignId, campaignId));
  }

  async getActiveEnrollmentsForLead(leadId: string): Promise<CampaignEnrollment[]> {
    return await db
      .select()
      .from(campaignEnrollments)
      .where(
        and(eq(campaignEnrollments.leadId, leadId), eq(campaignEnrollments.status, 'active'))
      );
  }

  async updateEnrollment(
    id: string,
    updates: Partial<CampaignEnrollment>
  ): Promise<CampaignEnrollment> {
    const [row] = await db
      .update(campaignEnrollments)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(campaignEnrollments.id, id))
      .returning();
    return row;
  }

  async getEnrollment(id: string): Promise<CampaignEnrollment | undefined> {
    const [row] = await db
      .select()
      .from(campaignEnrollments)
      .where(eq(campaignEnrollments.id, id));
    return row;
  }

  async getAllActiveEnrollments(): Promise<CampaignEnrollment[]> {
    return await db
      .select()
      .from(campaignEnrollments)
      .where(eq(campaignEnrollments.status, 'active'));
  }

  // Campaign step lookups
  async getCampaignStep(id: string): Promise<CampaignStep | undefined> {
    const [row] = await db.select().from(campaignSteps).where(eq(campaignSteps.id, id));
    return row;
  }

  async getCampaignStepByOrder(
    campaignId: string,
    stepOrder: number
  ): Promise<CampaignStep | undefined> {
    const [row] = await db
      .select()
      .from(campaignSteps)
      .where(and(eq(campaignSteps.campaignId, campaignId), eq(campaignSteps.stepOrder, stepOrder)));
    return row;
  }

  // Send queue
  async createSendQueueItem(itemData: InsertSendQueueItem): Promise<SendQueueItem> {
    const [row] = await db
      .insert(sendQueue)
      .values({ id: nanoid(), ...itemData })
      .returning();
    return row;
  }

  async getSendQueueItem(id: string): Promise<SendQueueItem | undefined> {
    const [row] = await db.select().from(sendQueue).where(eq(sendQueue.id, id));
    return row;
  }

  async getSendQueueByStatus(
    status: string,
    workspaceId?: string | null
  ): Promise<SendQueueItem[]> {
    const conditions = [eq(sendQueue.status, status), isNull(sendQueue.deletedAt)];
    if (workspaceId) conditions.push(eq(sendQueue.workspaceId, workspaceId));
    return await db
      .select()
      .from(sendQueue)
      .where(and(...conditions))
      .orderBy(desc(sendQueue.createdAt));
  }

  async updateSendQueueItem(
    id: string,
    updates: Partial<SendQueueItem>
  ): Promise<SendQueueItem> {
    const [row] = await db
      .update(sendQueue)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(sendQueue.id, id))
      .returning();
    return row;
  }

  async findExistingQueueItem(
    enrollmentId: string,
    campaignStepId: string
  ): Promise<SendQueueItem | undefined> {
    const [row] = await db
      .select()
      .from(sendQueue)
      .where(
        and(
          eq(sendQueue.enrollmentId, enrollmentId),
          eq(sendQueue.campaignStepId, campaignStepId),
          isNull(sendQueue.deletedAt)
        )
      );
    return row;
  }

  async bulkUpdateQueueStatus(
    ids: string[],
    fromStatus: string,
    toStatus: string
  ): Promise<number> {
    if (ids.length === 0) return 0;
    const rows = await db
      .update(sendQueue)
      .set({
        status: toStatus,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(inArray(sendQueue.id, ids), eq(sendQueue.status, fromStatus)))
      .returning({ id: sendQueue.id });
    return rows.length;
  }

  async getQueueStats(workspaceId?: string | null): Promise<Record<string, number>> {
    const statuses = ['pending', 'approved', 'sent', 'skipped', 'failed'];
    const counts: Record<string, number> = {};
    for (const status of statuses) {
      const conditions = [eq(sendQueue.status, status), isNull(sendQueue.deletedAt)];
      if (workspaceId) conditions.push(eq(sendQueue.workspaceId, workspaceId));
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(sendQueue)
        .where(and(...conditions));
      counts[status] = row?.count ?? 0;
    }
    return counts;
  }

  // Send log
  async createSendLog(entryData: Omit<SendLogEntry, 'id'>): Promise<SendLogEntry> {
    const [row] = await db
      .insert(sendLog)
      .values({ id: nanoid(), ...entryData })
      .returning();
    return row;
  }

  async countSuccessfulSends(campaignId: string, leadId: string): Promise<number> {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(sendLog)
      .where(
        and(
          eq(sendLog.campaignId, campaignId),
          eq(sendLog.leadId, leadId),
          eq(sendLog.dispatchStatus, 'success')
        )
      );
    return row?.count ?? 0;
  }

  async countSendsForCampaignSince(campaignId: string, since: Date): Promise<number> {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(sendLog)
      .where(and(eq(sendLog.campaignId, campaignId), gte(sendLog.dispatchedAt, since)));
    return row?.count ?? 0;
  }

  async getLastSendForCampaignLead(
    campaignId: string,
    leadId: string
  ): Promise<SendLogEntry | undefined> {
    const [row] = await db
      .select()
      .from(sendLog)
      .where(and(eq(sendLog.campaignId, campaignId), eq(sendLog.leadId, leadId)))
      .orderBy(desc(sendLog.dispatchedAt))
      .limit(1);
    return row;
  }

  // Engagement events
  async createEngagementEvent(
    eventData: Omit<EngagementEvent, 'id'>
  ): Promise<EngagementEvent> {
    const [row] = await db
      .insert(engagementEvents)
      .values({ id: nanoid(), ...eventData })
      .returning();
    return row;
  }

  async getEngagementEventsForLead(leadId: string): Promise<EngagementEvent[]> {
    return await db
      .select()
      .from(engagementEvents)
      .where(eq(engagementEvents.leadId, leadId))
      .orderBy(desc(engagementEvents.occurredAt));
  }

  async hasEngagementEvent(leadId: string, eventType: string): Promise<boolean> {
    const [row] = await db
      .select({ id: engagementEvents.id })
      .from(engagementEvents)
      .where(
        and(eq(engagementEvents.leadId, leadId), eq(engagementEvents.eventType, eventType))
      )
      .limit(1);
    return Boolean(row);
  }

  async getRecentInboxEvents(
    workspaceId?: string | null,
    limit: number = 50
  ): Promise<Array<EngagementEvent & { lead: Lead | null }>> {
    // Return reply_received + connection_accepted events joined with lead info,
    // newest first. Workspace-scoped via the leads join.
    const conditions = [
      or(
        eq(engagementEvents.eventType, 'reply_received'),
        eq(engagementEvents.eventType, 'connection_accepted')
      )!,
    ];
    if (workspaceId) conditions.push(eq(engagementEvents.workspaceId, workspaceId));

    const rows = await db
      .select({
        event: engagementEvents,
        lead: leads,
      })
      .from(engagementEvents)
      .leftJoin(leads, eq(engagementEvents.leadId, leads.id))
      .where(and(...conditions))
      .orderBy(desc(engagementEvents.occurredAt))
      .limit(limit);

    return rows.map((r) => ({ ...r.event, lead: r.lead }));
  }

  async getLeadsWithUnipileMemberId(workspaceId?: string | null): Promise<Lead[]> {
    const conditions = [sql`${leads.unipileMemberId} IS NOT NULL`];
    if (workspaceId) conditions.push(eq(leads.workspaceId, workspaceId));
    return await db.select().from(leads).where(and(...conditions));
  }

  async getActiveEnrollmentForLead(leadId: string): Promise<CampaignEnrollment | undefined> {
    const [row] = await db
      .select()
      .from(campaignEnrollments)
      .where(
        and(eq(campaignEnrollments.leadId, leadId), eq(campaignEnrollments.status, 'active'))
      )
      .limit(1);
    return row;
  }

  async getLastSentQueueItemForLead(leadId: string): Promise<SendQueueItem | undefined> {
    const [row] = await db
      .select()
      .from(sendQueue)
      .where(and(eq(sendQueue.leadId, leadId), eq(sendQueue.status, 'sent')))
      .orderBy(desc(sendQueue.createdAt))
      .limit(1);
    return row;
  }

  async createOutreachEmail(emailData: InsertOutreachEmail): Promise<OutreachEmail> {
    const [email] = await db
      .insert(outreachEmails)
      .values({
        id: nanoid(),
        ...emailData,
      })
      .returning();
    return email;
  }

  async getOutreachEmails(campaignId?: string): Promise<OutreachEmail[]> {
    if (campaignId) {
      return await db.select().from(outreachEmails).where(eq(outreachEmails.campaignId, campaignId));
    }
    return await db.select().from(outreachEmails);
  }

  /**
   * Returns all outreach emails sent by a user, joined with lead info
   * (business name, website) so the UI doesn't need a second query.
   */
  async getOutreachEmailsByUser(userId: string, workspaceId?: string | null): Promise<any[]> {
    const conditions = [eq(outreachEmails.createdBy, userId)];
    if (workspaceId) conditions.push(eq(outreachEmails.workspaceId, workspaceId));

    const rows = await db
      .select({
        id: outreachEmails.id,
        leadId: outreachEmails.leadId,
        recipientEmail: outreachEmails.recipientEmail,
        subject: outreachEmails.subject,
        content: outreachEmails.content,
        status: outreachEmails.status,
        sentAt: outreachEmails.sentAt,
        openedAt: outreachEmails.openedAt,
        repliedAt: outreachEmails.repliedAt,
        emailProvider: outreachEmails.emailProvider,
        businessName: leads.businessName,
        website: leads.website,
      })
      .from(outreachEmails)
      .leftJoin(leads, eq(outreachEmails.leadId, leads.id))
      .where(and(...conditions))
      .orderBy(desc(outreachEmails.sentAt));

    return rows;
  }

  async updateOutreachEmailStatus(id: string, status: string, timestamp?: Date): Promise<void> {
    const updates: any = { status };
    
    if (status === 'sent' && timestamp) {
      updates.sentAt = timestamp;
    } else if (status === 'opened' && timestamp) {
      updates.openedAt = timestamp;
    } else if (status === 'replied' && timestamp) {
      updates.repliedAt = timestamp;
    }

    await db
      .update(outreachEmails)
      .set(updates)
      .where(eq(outreachEmails.id, id));
  }
}

export const storage = new DatabaseStorage();