import {
  users,
  leads,
  gbpProfiles,
  campaigns,
  outreachEmails,
  workspaces,
  type User,
  type UpsertUser,
  type Lead,
  type InsertLead,
  type GbpProfile,
  type InsertGbpProfile,
  type Campaign,
  type InsertCampaign,
  type OutreachEmail,
  type InsertOutreachEmail,
  type Workspace,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc } from "drizzle-orm";
import { nanoid } from "nanoid";

export interface IStorage {
  // Workspace operations
  getWorkspace(id: string): Promise<Workspace | undefined>;
  createPersonalWorkspace(userId: string, email: string | null): Promise<Workspace>;

  // User operations
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  updateUserTokens(id: string, accessToken: string, refreshToken: string, expiresAt: Date): Promise<void>;

  // Lead operations
  createLead(lead: InsertLead): Promise<Lead>;
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