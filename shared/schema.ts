import { pgTable, text, varchar, timestamp, jsonb, index, integer, boolean, decimal } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Session storage table for authentication
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// User storage table
export const users = pgTable("users", {
  id: varchar("id").primaryKey().notNull(),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  googleAccessToken: text("google_access_token"),
  googleRefreshToken: text("google_refresh_token"),
  tokenExpiresAt: timestamp("token_expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Business leads from Google search
export const leads = pgTable("leads", {
  id: varchar("id").primaryKey().notNull(),
  businessName: varchar("business_name").notNull(),
  address: text("address"),
  phone: varchar("phone"),
  email: varchar("email"),
  emailSource: varchar("email_source"), // 'snippet', 'website', 'pattern'
  website: varchar("website"),
  category: varchar("category"),
  googlePlaceId: varchar("google_place_id"),
  rating: decimal("rating", { precision: 3, scale: 2 }),
  totalReviews: integer("total_reviews"),
  businessHours: jsonb("business_hours"), // weekday descriptions from Places API
  placeTypes: jsonb("place_types"), // Google Places types array
  businessStatus: varchar("business_status"), // OPERATIONAL, CLOSED, etc.
  aiScore: integer("ai_score"), // 0-100 scoring
  aiAnalysis: jsonb("ai_analysis"), // Store AI recommendations
  priority: varchar("priority").default("medium"), // high, medium, low
  status: varchar("status").default("discovered"), // discovered, analyzing, contacted, converted
  searchQuery: text("search_query"), // Original search that found this lead
  discoveredAt: timestamp("discovered_at").defaultNow(),
  lastContactedAt: timestamp("last_contacted_at"),
  enrichedAt: timestamp("enriched_at"), // When Places API / email discovery ran
  hubspotCompanyId: varchar("hubspot_company_id"), // HubSpot Company ID after push
  hubspotPushedAt: timestamp("hubspot_pushed_at"),
  createdBy: varchar("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Google Business Profiles managed by consultants
export const gbpProfiles = pgTable("gbp_profiles", {
  id: varchar("id").primaryKey().notNull(),
  locationId: varchar("location_id").notNull().unique(), // Google Business Profile location ID
  businessName: varchar("business_name").notNull(),
  address: text("address"),
  phone: varchar("phone"),
  website: varchar("website"),
  category: varchar("category"),
  description: text("description"),
  hours: jsonb("hours"), // Store business hours as JSON
  photos: jsonb("photos"), // Store photo URLs as JSON array
  reviews: jsonb("reviews"), // Store recent reviews data
  rating: decimal("rating", { precision: 3, scale: 2 }),
  totalReviews: integer("total_reviews").default(0),
  isActive: boolean("is_active").default(true),
  lastSynced: timestamp("last_synced"),
  managedBy: varchar("managed_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Outreach campaigns and emails
export const outreachCampaigns = pgTable("outreach_campaigns", {
  id: varchar("id").primaryKey().notNull(),
  name: varchar("name").notNull(),
  description: text("description"),
  emailTemplate: text("email_template"),
  status: varchar("status").default("active"), // active, paused, completed
  totalSent: integer("total_sent").default(0),
  totalOpened: integer("total_opened").default(0),
  totalReplied: integer("total_replied").default(0),
  totalMeetings: integer("total_meetings").default(0),
  createdBy: varchar("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Individual outreach emails
export const outreachEmails = pgTable("outreach_emails", {
  id: varchar("id").primaryKey().notNull(),
  campaignId: varchar("campaign_id").references(() => outreachCampaigns.id),
  leadId: varchar("lead_id").notNull().references(() => leads.id),
  recipientEmail: varchar("recipient_email").notNull(),
  subject: text("subject").notNull(),
  content: text("content").notNull(),
  status: varchar("status").default("sent"), // sent, opened, replied, bounced
  sentAt: timestamp("sent_at").defaultNow(),
  openedAt: timestamp("opened_at"),
  repliedAt: timestamp("replied_at"),
  emailProvider: varchar("email_provider").default("gmail"),
  createdBy: varchar("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Insert schemas
export const insertUserSchema = createInsertSchema(users).omit({
  createdAt: true,
  updatedAt: true,
});

export const insertLeadSchema = createInsertSchema(leads).omit({
  id: true,
  discoveredAt: true,
  createdAt: true,
  updatedAt: true,
});

export const insertGbpProfileSchema = createInsertSchema(gbpProfiles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertOutreachCampaignSchema = createInsertSchema(outreachCampaigns).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertOutreachEmailSchema = createInsertSchema(outreachEmails).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Types
export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;
export type InsertLead = z.infer<typeof insertLeadSchema>;
export type Lead = typeof leads.$inferSelect;
export type InsertGbpProfile = z.infer<typeof insertGbpProfileSchema>;
export type GbpProfile = typeof gbpProfiles.$inferSelect;
export type InsertOutreachCampaign = z.infer<typeof insertOutreachCampaignSchema>;
export type OutreachCampaign = typeof outreachCampaigns.$inferSelect;
export type InsertOutreachEmail = z.infer<typeof insertOutreachEmailSchema>;
export type OutreachEmail = typeof outreachEmails.$inferSelect;
