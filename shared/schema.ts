import {
  pgTable,
  text,
  varchar,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  integer,
  boolean,
  decimal,
} from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod';

// ============================================================
// workspaces — top-level tenant (stubbed in Phase 1, activated Phase 9)
// ============================================================
export const workspaces = pgTable('workspaces', {
  id: varchar('id').primaryKey().notNull(),
  name: varchar('name').notNull(),
  slug: varchar('slug').unique(),
  plan: varchar('plan').default('free'), // free | solo | team | agency
  stripeCustomerId: varchar('stripe_customer_id'),
  stripeSubscriptionId: varchar('stripe_subscription_id'),
  monthlyEmailSendsUsed: integer('monthly_email_sends_used').default(0),
  monthlyLinkedinSendsUsed: integer('monthly_linkedin_sends_used').default(0),
  dailyEmailLimit: integer('daily_email_limit').default(20),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// ============================================================
// sessions — express-session storage (unchanged from GBP)
// ============================================================
export const sessions = pgTable(
  'sessions',
  {
    sid: varchar('sid').primaryKey(),
    sess: jsonb('sess').notNull(),
    expire: timestamp('expire').notNull(),
  },
  (table) => [index('IDX_session_expire').on(table.expire)]
);

// ============================================================
// users — GBP base + workspace_id + role
// ============================================================
export const users = pgTable('users', {
  id: varchar('id').primaryKey().notNull(),
  workspaceId: varchar('workspace_id').references(() => workspaces.id),
  role: varchar('role').default('admin'), // admin | member
  email: varchar('email').unique(),
  firstName: varchar('first_name'),
  lastName: varchar('last_name'),
  profileImageUrl: varchar('profile_image_url'),
  googleAccessToken: text('google_access_token'),
  googleRefreshToken: text('google_refresh_token'),
  tokenExpiresAt: timestamp('token_expires_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// ============================================================
// leads — unified Google + LinkedIn leads with lead_source discriminator
// ============================================================
export const leads = pgTable(
  'leads',
  {
    id: varchar('id').primaryKey().notNull(),
    workspaceId: varchar('workspace_id').references(() => workspaces.id),
    leadSource: varchar('lead_source').notNull().default('google'), // google | linkedin

    // Shared fields
    businessName: varchar('business_name').notNull(),
    address: text('address'),
    phone: varchar('phone'),
    email: varchar('email'),
    emailSource: varchar('email_source'), // 'snippet' | 'website' | 'pattern' | 'apollo' | 'hunter'
    website: varchar('website'),
    category: varchar('category'),
    notes: text('notes'),
    priority: varchar('priority').default('medium'), // high | medium | low
    status: varchar('status').default('new'), // new | discovered | analyzing | contacted | connected | replied | meeting_booked | converted | disqualified | bounced
    isDeleted: boolean('is_deleted').default(false),
    deletedAt: timestamp('deleted_at'),
    hubspotCompanyId: varchar('hubspot_company_id'),
    hubspotPushedAt: timestamp('hubspot_pushed_at'),
    createdBy: varchar('created_by').references(() => users.id),
    discoveredAt: timestamp('discovered_at').defaultNow(),
    lastContactedAt: timestamp('last_contacted_at'),
    enrichedAt: timestamp('enriched_at'),
    reEnrichAfter: timestamp('re_enrich_after'),

    // Google-specific (nullable for LinkedIn leads)
    googlePlaceId: varchar('google_place_id'),
    rating: decimal('rating', { precision: 3, scale: 2 }),
    totalReviews: integer('total_reviews'),
    businessHours: jsonb('business_hours'),
    placeTypes: jsonb('place_types'),
    businessStatus: varchar('business_status'),
    aiScore: integer('ai_score'),
    aiAnalysis: jsonb('ai_analysis'),
    searchQuery: text('search_query'),
    emailVerified: varchar('email_verified'), // deliverable | risky | undeliverable
    emailVerifiedAt: timestamp('email_verified_at'),

    // LinkedIn-specific (nullable for Google leads)
    linkedinUrl: varchar('linkedin_url'),
    fullName: varchar('full_name'),
    title: varchar('title'),
    company: varchar('company'),
    industry: varchar('industry'),
    companySize: varchar('company_size'),
    headline: text('headline'),
    connectionDegree: integer('connection_degree'),
    enrichmentData: jsonb('enrichment_data'),
    enrichmentStatus: varchar('enrichment_status').default('pending'), // pending | enriched | failed | skipped
    unipileMemberId: varchar('unipile_member_id'),
    linkedinScore: integer('linkedin_score').default(0),
    language: varchar('language').default('en'),

    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    index('idx_leads_workspace').on(table.workspaceId),
    index('idx_leads_source').on(table.leadSource),
    index('idx_leads_status').on(table.status),
    index('idx_leads_linkedin_url').on(table.linkedinUrl),
    index('idx_leads_email').on(table.email),
  ]
);

// ============================================================
// gbp_profiles — GBP managed profiles (kept from GBP + workspace_id)
// ============================================================
export const gbpProfiles = pgTable('gbp_profiles', {
  id: varchar('id').primaryKey().notNull(),
  workspaceId: varchar('workspace_id').references(() => workspaces.id),
  locationId: varchar('location_id').notNull().unique(),
  businessName: varchar('business_name').notNull(),
  address: text('address'),
  phone: varchar('phone'),
  website: varchar('website'),
  category: varchar('category'),
  description: text('description'),
  hours: jsonb('hours'),
  photos: jsonb('photos'),
  reviews: jsonb('reviews'),
  rating: decimal('rating', { precision: 3, scale: 2 }),
  totalReviews: integer('total_reviews').default(0),
  isActive: boolean('is_active').default(true),
  lastSynced: timestamp('last_synced'),
  managedBy: varchar('managed_by')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// ============================================================
// campaigns — unified email + LinkedIn campaigns
//   (merged from GBP outreach_campaigns + ClearEdge Leads campaigns)
// ============================================================
export const campaigns = pgTable(
  'campaigns',
  {
    id: varchar('id').primaryKey().notNull(),
    workspaceId: varchar('workspace_id').references(() => workspaces.id),
    name: varchar('name').notNull(),
    description: text('description'),
    outreachChannel: varchar('outreach_channel').notNull().default('email'), // email | linkedin
    status: varchar('status').default('draft'), // draft | active | paused | completed
    tone: varchar('tone').default('consultative'), // consultative | direct | curiosity-led
    emailTemplate: text('email_template'), // used when outreach_channel = email
    dailySendLimit: integer('daily_send_limit').default(20),
    maxTouches: integer('max_touches').default(5),
    requireApproval: boolean('require_approval').default(true),
    autoPauseThreshold: integer('auto_pause_threshold'),
    lastOptimizationAt: timestamp('last_optimization_at'),
    totalSent: integer('total_sent').default(0),
    totalOpened: integer('total_opened').default(0),
    totalReplied: integer('total_replied').default(0),
    totalMeetings: integer('total_meetings').default(0),
    isDeleted: boolean('is_deleted').default(false),
    createdBy: varchar('created_by').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    index('idx_campaigns_workspace').on(table.workspaceId),
    index('idx_campaigns_status').on(table.status),
  ]
);

// ============================================================
// campaign_steps — multi-step LinkedIn sequences (also usable for email drip)
// ============================================================
export const campaignSteps = pgTable(
  'campaign_steps',
  {
    id: varchar('id').primaryKey().notNull(),
    campaignId: varchar('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    stepOrder: integer('step_order').notNull(),
    stepType: varchar('step_type').notNull(), // connection_request | message | inmail | post_engage | email
    delayDays: integer('delay_days').notNull().default(0),
    promptTemplate: text('prompt_template'),
    characterLimit: integer('character_limit'),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => [index('idx_campaign_steps_campaign').on(table.campaignId)]
);

// ============================================================
// campaign_enrollments — a lead's progress through a campaign
// ============================================================
export const campaignEnrollments = pgTable(
  'campaign_enrollments',
  {
    id: varchar('id').primaryKey().notNull(),
    campaignId: varchar('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    leadId: varchar('lead_id')
      .notNull()
      .references(() => leads.id),
    currentStepOrder: integer('current_step_order').notNull().default(0),
    status: varchar('status').notNull().default('active'), // active | paused | completed | disqualified
    oooUntil: timestamp('ooo_until'),
    enrolledAt: timestamp('enrolled_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    index('idx_enrollments_campaign').on(table.campaignId),
    index('idx_enrollments_lead').on(table.leadId),
    index('idx_enrollments_status').on(table.status),
    uniqueIndex('uniq_enrollment_campaign_lead').on(table.campaignId, table.leadId),
  ]
);

// ============================================================
// prompt_versions — A/B prompt testing (Phase 4)
// ============================================================
export const promptVersions = pgTable(
  'prompt_versions',
  {
    id: varchar('id').primaryKey().notNull(),
    campaignId: varchar('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    stepOrder: integer('step_order').notNull(),
    variant: varchar('variant').notNull().default('A'),
    promptTemplate: text('prompt_template').notNull(),
    description: text('description'),
    timesUsed: integer('times_used').notNull().default(0),
    replyCount: integer('reply_count').notNull().default(0),
    positiveReplyCount: integer('positive_reply_count').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => [index('idx_prompt_versions_campaign').on(table.campaignId, table.stepOrder)]
);

// ============================================================
// send_queue — AI drafts awaiting approval / dispatch (both channels)
// ============================================================
export const sendQueue = pgTable(
  'send_queue',
  {
    id: varchar('id').primaryKey().notNull(),
    workspaceId: varchar('workspace_id').references(() => workspaces.id),
    enrollmentId: varchar('enrollment_id').references(() => campaignEnrollments.id),
    leadId: varchar('lead_id')
      .notNull()
      .references(() => leads.id),
    campaignStepId: varchar('campaign_step_id').references(() => campaignSteps.id),
    promptVersionId: varchar('prompt_version_id').references(() => promptVersions.id),
    channel: varchar('channel').notNull().default('linkedin'), // email | linkedin
    aiDraft: text('ai_draft'),
    editedDraft: text('edited_draft'),
    emailRecipient: varchar('email_recipient'), // for channel = email
    emailSubject: text('email_subject'), // for channel = email
    status: varchar('status').notNull().default('pending'), // pending | approved | sent | skipped | failed
    charCount: integer('char_count'),
    overLimit: boolean('over_limit').notNull().default(false),
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').defaultNow(),
    reviewedAt: timestamp('reviewed_at'),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    index('idx_send_queue_workspace').on(table.workspaceId),
    index('idx_send_queue_status').on(table.status),
    index('idx_send_queue_lead').on(table.leadId),
  ]
);

// ============================================================
// send_log — record of every dispatched message (both channels)
// ============================================================
export const sendLog = pgTable(
  'send_log',
  {
    id: varchar('id').primaryKey().notNull(),
    workspaceId: varchar('workspace_id').references(() => workspaces.id),
    queueItemId: varchar('queue_item_id').references(() => sendQueue.id),
    leadId: varchar('lead_id')
      .notNull()
      .references(() => leads.id),
    campaignId: varchar('campaign_id').references(() => campaigns.id),
    channel: varchar('channel').notNull().default('linkedin'),
    messageText: text('message_text'),
    stepType: varchar('step_type'),
    dispatchedAt: timestamp('dispatched_at').defaultNow(),
    unipileMessageId: varchar('unipile_message_id'),
    dispatchStatus: varchar('dispatch_status'), // success | failed
  },
  (table) => [
    index('idx_send_log_lead').on(table.leadId),
    index('idx_send_log_campaign').on(table.campaignId),
    index('idx_send_log_dispatched').on(table.dispatchedAt),
  ]
);

// ============================================================
// engagement_events — replies, reactions, connection acceptances, bookings
// ============================================================
export const engagementEvents = pgTable(
  'engagement_events',
  {
    id: varchar('id').primaryKey().notNull(),
    workspaceId: varchar('workspace_id').references(() => workspaces.id),
    leadId: varchar('lead_id')
      .notNull()
      .references(() => leads.id),
    eventType: varchar('event_type').notNull(), // connection_accepted | reply_received | post_liked | post_commented | meeting_booked | out_of_office
    sentiment: varchar('sentiment'), // positive | negative | neutral | out_of_office | unclassified
    eventData: jsonb('event_data'),
    occurredAt: timestamp('occurred_at').defaultNow(),
  },
  (table) => [
    index('idx_engagement_lead').on(table.leadId),
    index('idx_engagement_type').on(table.eventType),
  ]
);

// ============================================================
// knowledge_base — RAG store of successful outreach exchanges (Phase 4)
// ============================================================
export const knowledgeBase = pgTable(
  'knowledge_base',
  {
    id: varchar('id').primaryKey().notNull(),
    workspaceId: varchar('workspace_id').references(() => workspaces.id),
    leadId: varchar('lead_id').references(() => leads.id),
    campaignId: varchar('campaign_id').references(() => campaigns.id),
    outboundMessage: text('outbound_message').notNull(),
    replyMessage: text('reply_message'),
    sentiment: varchar('sentiment'), // positive | negative | neutral
    industry: varchar('industry'),
    titlePattern: varchar('title_pattern'),
    embeddingText: text('embedding_text'),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => [
    index('idx_kb_sentiment').on(table.sentiment),
    index('idx_kb_industry').on(table.industry),
    index('idx_kb_workspace').on(table.workspaceId),
  ]
);

// ============================================================
// outreach_emails — GBP email records + bounce/click tracking
// ============================================================
export const outreachEmails = pgTable('outreach_emails', {
  id: varchar('id').primaryKey().notNull(),
  workspaceId: varchar('workspace_id').references(() => workspaces.id),
  campaignId: varchar('campaign_id').references(() => campaigns.id),
  leadId: varchar('lead_id')
    .notNull()
    .references(() => leads.id),
  recipientEmail: varchar('recipient_email').notNull(),
  subject: text('subject').notNull(),
  content: text('content').notNull(),
  status: varchar('status').default('sent'), // sent | opened | clicked | replied | bounced | spam
  sentAt: timestamp('sent_at').defaultNow(),
  openedAt: timestamp('opened_at'),
  clickedAt: timestamp('clicked_at'),
  repliedAt: timestamp('replied_at'),
  bouncedAt: timestamp('bounced_at'),
  emailProvider: varchar('email_provider').default('gmail'),
  createdBy: varchar('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// ============================================================
// suppression_list — workspace-global unsubscribe / bounce / spam list (Phase 7)
// ============================================================
export const suppressionList = pgTable(
  'suppression_list',
  {
    id: varchar('id').primaryKey().notNull(),
    workspaceId: varchar('workspace_id').references(() => workspaces.id),
    email: varchar('email'),
    domain: varchar('domain'),
    reason: varchar('reason').notNull(), // unsubscribed | bounced | spam_report | manual
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => [
    index('idx_suppression_workspace').on(table.workspaceId),
    index('idx_suppression_email').on(table.email),
    index('idx_suppression_domain').on(table.domain),
  ]
);

// ============================================================
// audit_log — append-only audit trail (Phase 12)
// ============================================================
export const auditLog = pgTable(
  'audit_log',
  {
    id: varchar('id').primaryKey().notNull(),
    workspaceId: varchar('workspace_id').references(() => workspaces.id),
    userId: varchar('user_id').references(() => users.id),
    action: varchar('action').notNull(),
    entityType: varchar('entity_type'),
    entityId: varchar('entity_id'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => [
    index('idx_audit_workspace').on(table.workspaceId),
    index('idx_audit_action').on(table.action),
    index('idx_audit_entity').on(table.entityType, table.entityId),
  ]
);

// ============================================================
// webhook_endpoints — outbound webhooks (Phase 12)
// ============================================================
export const webhookEndpoints = pgTable('webhook_endpoints', {
  id: varchar('id').primaryKey().notNull(),
  workspaceId: varchar('workspace_id').references(() => workspaces.id),
  url: text('url').notNull(),
  events: jsonb('events').notNull(),
  secret: varchar('secret').notNull(),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
});

// ============================================================
// notifications — in-app notifications (Phase 11)
// ============================================================
export const notifications = pgTable(
  'notifications',
  {
    id: varchar('id').primaryKey().notNull(),
    workspaceId: varchar('workspace_id').references(() => workspaces.id),
    userId: varchar('user_id').references(() => users.id),
    type: varchar('type').notNull(),
    title: varchar('title').notNull(),
    body: text('body'),
    link: varchar('link'),
    readAt: timestamp('read_at'),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => [
    index('idx_notifications_user').on(table.userId),
    index('idx_notifications_read').on(table.readAt),
  ]
);

// ============================================================
// unipile_accounts — per-workspace LinkedIn accounts (Agency plan, Phase 9)
// ============================================================
export const unipileAccounts = pgTable('unipile_accounts', {
  id: varchar('id').primaryKey().notNull(),
  workspaceId: varchar('workspace_id').references(() => workspaces.id),
  accountId: varchar('account_id').notNull(),
  label: varchar('label'),
  dailySendsUsed: integer('daily_sends_used').default(0),
  dailyLimit: integer('daily_limit').default(50),
  createdAt: timestamp('created_at').defaultNow(),
});

// ============================================================
// app_config — key/value workspace config (ported from ClearEdge Leads)
// ============================================================
export const appConfig = pgTable(
  'app_config',
  {
    workspaceId: varchar('workspace_id').references(() => workspaces.id),
    key: varchar('key').notNull(),
    value: text('value').notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [uniqueIndex('uniq_app_config_key').on(table.workspaceId, table.key)]
);

// ============================================================
// Insert schemas (zod validators via drizzle-zod)
// ============================================================
export const insertWorkspaceSchema = createInsertSchema(workspaces).omit({
  createdAt: true,
  updatedAt: true,
});

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

export const insertCampaignSchema = createInsertSchema(campaigns).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertCampaignStepSchema = createInsertSchema(campaignSteps).omit({
  id: true,
  createdAt: true,
});

export const insertCampaignEnrollmentSchema = createInsertSchema(campaignEnrollments).omit({
  id: true,
  enrolledAt: true,
  updatedAt: true,
});

export const insertSendQueueSchema = createInsertSchema(sendQueue).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertOutreachEmailSchema = createInsertSchema(outreachEmails).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertSuppressionSchema = createInsertSchema(suppressionList).omit({
  id: true,
  createdAt: true,
});

export const insertAuditLogSchema = createInsertSchema(auditLog).omit({
  id: true,
  createdAt: true,
});

// ============================================================
// Type exports
// ============================================================
export type Workspace = typeof workspaces.$inferSelect;
export type InsertWorkspace = z.infer<typeof insertWorkspaceSchema>;

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

export type Lead = typeof leads.$inferSelect;
export type InsertLead = z.infer<typeof insertLeadSchema>;

export type GbpProfile = typeof gbpProfiles.$inferSelect;
export type InsertGbpProfile = z.infer<typeof insertGbpProfileSchema>;

export type Campaign = typeof campaigns.$inferSelect;
export type InsertCampaign = z.infer<typeof insertCampaignSchema>;

export type CampaignStep = typeof campaignSteps.$inferSelect;
export type InsertCampaignStep = z.infer<typeof insertCampaignStepSchema>;

export type CampaignEnrollment = typeof campaignEnrollments.$inferSelect;
export type InsertCampaignEnrollment = z.infer<typeof insertCampaignEnrollmentSchema>;

export type SendQueueItem = typeof sendQueue.$inferSelect;
export type InsertSendQueueItem = z.infer<typeof insertSendQueueSchema>;

export type SendLogEntry = typeof sendLog.$inferSelect;
export type EngagementEvent = typeof engagementEvents.$inferSelect;
export type PromptVersion = typeof promptVersions.$inferSelect;

export type OutreachEmail = typeof outreachEmails.$inferSelect;
export type InsertOutreachEmail = z.infer<typeof insertOutreachEmailSchema>;

export type SuppressionEntry = typeof suppressionList.$inferSelect;
export type InsertSuppressionEntry = z.infer<typeof insertSuppressionSchema>;

export type AuditLogEntry = typeof auditLog.$inferSelect;
export type InsertAuditLogEntry = z.infer<typeof insertAuditLogSchema>;

export type WebhookEndpoint = typeof webhookEndpoints.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type UnipileAccount = typeof unipileAccounts.$inferSelect;
export type AppConfigEntry = typeof appConfig.$inferSelect;

export type KnowledgeEntry = typeof knowledgeBase.$inferSelect;
export type InsertKnowledgeEntry = typeof knowledgeBase.$inferInsert;
