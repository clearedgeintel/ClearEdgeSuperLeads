import {
  users,
  leads,
  gbpProfiles,
  campaigns,
  outreachEmails,
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
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc } from "drizzle-orm";
import { nanoid } from "nanoid";

export interface IStorage {
  // User operations
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  updateUserTokens(id: string, accessToken: string, refreshToken: string, expiresAt: Date): Promise<void>;

  // Lead operations
  createLead(lead: InsertLead): Promise<Lead>;
  getLeads(userId: string, filters?: { priority?: string; status?: string }): Promise<Lead[]>;
  getLead(id: string): Promise<Lead | undefined>;
  updateLead(id: string, updates: Partial<Lead>): Promise<Lead>;
  updateLeadAiAnalysis(id: string, score: number, analysis: any): Promise<void>;

  // GBP Profile operations
  createGbpProfile(profile: InsertGbpProfile): Promise<GbpProfile>;
  getGbpProfiles(userId: string): Promise<GbpProfile[]>;
  getGbpProfile(id: string): Promise<GbpProfile | undefined>;
  updateGbpProfile(id: string, updates: Partial<GbpProfile>): Promise<GbpProfile>;
  syncGbpProfile(locationId: string, profileData: any): Promise<void>;

  // Outreach operations
  createCampaign(campaign: InsertCampaign): Promise<Campaign>;
  getCampaigns(userId: string): Promise<Campaign[]>;
  createOutreachEmail(email: InsertOutreachEmail): Promise<OutreachEmail>;
  getOutreachEmails(campaignId?: string): Promise<OutreachEmail[]>;
  updateOutreachEmailStatus(id: string, status: string, timestamp?: Date): Promise<void>;
}

export class DatabaseStorage implements IStorage {
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

  async getLeads(userId: string, filters?: { priority?: string; status?: string }): Promise<Lead[]> {
    let conditions = [eq(leads.createdBy, userId)];
    
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

  async getGbpProfiles(userId: string): Promise<GbpProfile[]> {
    return await db.select().from(gbpProfiles).where(eq(gbpProfiles.managedBy, userId));
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

  async getCampaigns(userId: string): Promise<Campaign[]> {
    return await db.select().from(campaigns).where(eq(campaigns.createdBy, userId));
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
  async getOutreachEmailsByUser(userId: string): Promise<any[]> {
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
      .where(eq(outreachEmails.createdBy, userId))
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