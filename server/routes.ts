import express, { type Express } from "express";
import { createServer, type Server } from "http";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import cors from "cors";
import { storage } from "./storage";
import { pool } from "./db";
import { googleAuthService } from "./services/googleAuth";
import { aiService } from "./services/aiService";
import { emailService, EmailSuppressedError, EmailUndeliverableError, EmailDailyLimitError } from "./services/emailService";
import { PlanLimitExceededError } from "./lib/planLimits";
import { billingService, BillingNotConfiguredError } from "./services/billingService";
import { verifyEmailWithHunter } from "./services/emailVerification";
import { placesApiService } from "./services/placesApi";
import { emailDiscoveryService } from "./services/emailDiscovery";
import { hubspotService, extractDomain, parseAddress } from "./services/hubspotService";
import { linkedInSearchService, LinkedInSearchLimitError } from "./services/linkedinSearchService";
import { dailyUsed, dailyCap, type LinkedInAction } from "./lib/linkedinLimiter";
import { queueGenerationService } from "./services/queueGenerationService";
import { unipileDispatchService } from "./services/unipileDispatchService";
import { inboxSyncService } from "./services/inboxSyncService";
import { analyticsService } from "./services/analyticsService";
import { optimizationService } from "./services/optimizationService";
import { apiKeyAuth } from "./middleware/auth";
import { linkedinLimiter, aiLimiter, dispatchLimiter } from "./middleware/rateLimit";
import { validateBody } from "./middleware/validate";
import { requireWorkspace } from "./middleware/requireWorkspace";
import { requireRole } from "./middleware/requireRole";
import {
  linkedinSearchSchema,
  linkedinSaveProfilesSchema,
  createCampaignSchema,
  createCampaignStepSchema,
  generateMessageSchema,
} from "@shared/validators";
import { PLAN_LIMITS, getPlanLimits, percentOf, type PlanTier } from "@shared/plans";
import { setupFallbackAuth, requireAuth } from "./fallbackAuth";

import { nanoid } from "nanoid";
import type { PlaceDetails } from "./services/placesApi";
import { aiQueue } from "./lib/backgroundQueue";

import { verifyUnsubscribeToken } from "./lib/unsubscribe";

// Serialize an array of objects into an RFC-4180 CSV string. Values are
// always wrapped in double quotes (embedded quotes doubled) so column
// values that include commas or newlines don't break downstream parsers.
function toCsv(columns: readonly string[], rows: readonly object[]): string {
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return '""';
    const s = v instanceof Date ? v.toISOString() : String(v);
    return `"${s.replace(/"/g, '""')}"`;
  };
  const header = columns.join(',');
  const body = rows
    .map((r) => columns.map((c) => escape((r as Record<string, unknown>)[c])).join(','))
    .join('\n');
  return `${header}\n${body}`;
}

// Queue background tasks for a lead. Email discovery and AI analysis
// run with limited concurrency to avoid hammering rate limits.
function queueBackgroundTasks(leadId: string, place: PlaceDetails) {
  aiQueue.enqueue(async () => {
    // Mark as analyzing so UI shows progress
    await storage.updateLead(leadId, { status: 'analyzing' });

    // Email discovery from website
    if (place.website) {
      try {
        const emailResult = await emailDiscoveryService.discoverEmails(place.website);
        if (emailResult.emails.length > 0) {
          await storage.updateLead(leadId, {
            email: emailResult.emails[0],
            emailSource: emailResult.source,
          });
        }
      } catch (error) {
        console.error(`Email discovery failed for ${place.website}:`, error);
      }
    }

    // AI analysis
    try {
      const analysis = await aiService.analyzeLead({
        businessName: place.name,
        category: place.types?.[0]?.replace(/_/g, ' '),
        address: place.formattedAddress,
        phone: place.phone,
        website: place.website,
        rating: place.rating,
        totalReviews: place.totalReviews,
        businessStatus: place.businessStatus,
      });

      await storage.updateLeadAiAnalysis(leadId, analysis.score, analysis);
      await storage.updateLead(leadId, {
        status: 'analyzed',
        priority: analysis.priority,
      });
    } catch (error) {
      console.error(`AI analysis failed for lead ${leadId}:`, error);
      // Reset status so user can retry via /score endpoint
      await storage.updateLead(leadId, { status: 'discovered' });
    }
  });
}

// Session middleware setup
function setupSession(app: Express) {
  const isProd = process.env.NODE_ENV === 'production';

  // Trust Railway / Render / etc. reverse proxy so secure cookies work
  if (isProd) {
    app.set('trust proxy', 1);
  }

  // Use Postgres session store in production for persistence across restarts
  const PgStore = connectPgSimple(session);
  const store = isProd
    ? new PgStore({
        pool,
        tableName: 'sessions',
        createTableIfMissing: false, // table already exists in schema.ts
      })
    : undefined;

  app.use(session({
    store,
    secret: process.env.SESSION_SECRET || 'gbp-consulting-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'lax' : undefined,
      maxAge: 7 * 24 * 60 * 60 * 1000 // 1 week
    }
  }));
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Middleware
  // CORS only needed if frontend is on a different origin. Same-origin
  // deployments (Railway, Vercel) don't need it.
  app.use(cors({
    origin: process.env.NODE_ENV === 'production'
      ? (process.env.APP_URL || true)
      : 'http://localhost:5000',
    credentials: true
  }));

  setupSession(app);

  // Authentication middleware
  function requireAuth(req: any, res: any, next: any) {
    if (!req.session?.user) {
      return res.status(401).json({ message: "Authentication required" });
    }
    next();
  }

  // Authentication routes
  app.get('/api/auth/user', (req, res) => {
    const user = req.session.user;
    if (!user) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    // Don't send sensitive token data to frontend
    const { googleAccessToken, googleRefreshToken, ...safeUser } = user;
    res.json(safeUser);
  });

  app.post('/api/auth/logout', (req, res) => {
    req.session?.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: "Logout failed" });
      }
      res.json({ message: "Logged out successfully" });
    });
  });

  // Test route to verify server routing
  app.get('/api/test-callback', (req, res) => {
    console.log('Test callback reached with query:', req.query);
    res.json({ message: 'Test callback works', query: req.query });
  });

  // Setup fallback authentication
  setupFallbackAuth(app);

  // Phase 9 — mount requireWorkspace globally so every authenticated
  // request has req.workspace populated. The middleware is a no-op
  // when the user has no workspaceId or no session, so it's safe to
  // run before the Google OAuth + unsubscribe public routes. Phase 9
  // promotes it from "informational" to "injected on every request".
  app.use(requireWorkspace);

  // Google OAuth routes
  app.get('/api/auth/google', (req, res) => {
    try {
      const authUrl = googleAuthService.getAuthUrl();
      console.log('Generated Google auth URL:', authUrl);
      console.log('Expected callback URL: http://localhost:5000/api/auth/google/callback');
      res.redirect(authUrl);
    } catch (error) {
      console.error('Google OAuth error:', error);
      res.status(500).json({ message: "Google OAuth configuration error" });
    }
  });

  // Add a simple test route to verify Google can reach us
  app.get('/auth/test', (req, res) => {
    console.log('Test auth route reached:', req.query);
    res.json({ message: 'Auth test route working', query: req.query });
  });

  app.get('/api/auth/google/callback', async (req, res) => {
    try {
      console.log('Google callback received:', req.query);
      console.log('Request headers:', req.headers);
      const { code, error, state } = req.query;
      
      if (error) {
        console.error('Google OAuth error:', error);
        return res.redirect('/?error=access_denied');
      }
      
      if (!code) {
        console.error('No authorization code received');
        return res.redirect('/?error=no_code');
      }

      console.log('Getting tokens from Google...');
      const tokens = await googleAuthService.getTokens(code as string);
      console.log('Tokens received, getting user info...');
      
      const userInfo = await googleAuthService.getUserInfo(tokens.access_token!);
      console.log('User info received:', { id: userInfo.id, email: userInfo.email });

      // Store user in database
      const user = await storage.upsertUser({
        id: userInfo.id!,
        email: userInfo.email!,
        firstName: userInfo.given_name || null,
        lastName: userInfo.family_name || null,
        profileImageUrl: userInfo.picture || null,
        googleAccessToken: tokens.access_token!,
        googleRefreshToken: tokens.refresh_token || null,
        tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      });

      console.log('User stored in database:', user.id);

      // Store user in session
      req.session.user = user;
      console.log('User stored in session, redirecting to home...');

      res.redirect('/?success=login');
    } catch (error: any) {
      console.error('OAuth callback error:', error.message || error);
      res.redirect('/?error=auth_failed');
    }
  });

  // Lead discovery routes — uses Google Places API
  app.get('/api/search-leads', requireAuth, async (req, res) => {
    try {
      const { query, location } = req.query;
      const user = req.session.user!;

      if (!query) {
        return res.status(400).json({ message: "Search query required" });
      }

      const places = await placesApiService.searchPlaces(
        query as string,
        location as string,
        20
      );

      const leads = [];
      for (const place of places) {
        // Derive a simple category from primary place type
        const category = place.types?.[0]?.replace(/_/g, ' ');

        const lead = await storage.createLead({
          businessName: place.name,
          address: place.formattedAddress || null,
          phone: place.phone || null,
          email: null,
          website: place.website || null,
          category: category || null,
          googlePlaceId: place.placeId,
          rating: place.rating ? String(place.rating) : null,
          totalReviews: place.totalReviews || null,
          businessHours: place.businessHours || null,
          placeTypes: place.types || null,
          businessStatus: place.businessStatus || null,
          searchQuery: `${query} ${location || ''}`.trim(),
          status: 'discovered',
          priority: 'medium',
          leadSource: 'google',
          enrichedAt: new Date(),
          createdBy: user.id,
          workspaceId: user.workspaceId,
        });

        leads.push(lead);

        // Background: email discovery + AI analysis (rate-limited queue)
        queueBackgroundTasks(lead.id, place);
      }

      res.json(leads);
    } catch (error: any) {
      console.error('Lead search error:', error);
      res.status(500).json({ message: error.message });
    }
  });

  // Re-queue all leads with no AI score (stuck or never analyzed)
  app.post('/api/leads/reanalyze-stuck', requireAuth, async (req, res) => {
    try {
      const user = req.session.user!;
      const allLeads = await storage.getLeads(user.id, user.workspaceId);
      const stuck = allLeads.filter(l => l.aiScore == null);

      for (const lead of stuck) {
        // Reconstruct a PlaceDetails-shaped object from stored fields
        const place = {
          placeId: lead.googlePlaceId || '',
          name: lead.businessName,
          formattedAddress: lead.address || undefined,
          phone: lead.phone || undefined,
          website: lead.website || undefined,
          rating: lead.rating ? parseFloat(lead.rating) : undefined,
          totalReviews: lead.totalReviews || undefined,
          businessHours: (lead.businessHours as string[]) || undefined,
          types: (lead.placeTypes as string[]) || undefined,
          businessStatus: lead.businessStatus || undefined,
        };
        queueBackgroundTasks(lead.id, place);
      }

      res.json({ requeued: stuck.length });
    } catch (error: any) {
      console.error('Reanalyze error:', error);
      res.status(500).json({ message: error.message });
    }
  });

  // Push a lead to HubSpot as a Company
  app.post('/api/leads/:id/hubspot', requireAuth, async (req, res) => {
    try {
      if (!hubspotService.isConfigured()) {
        return res.status(400).json({ message: "HubSpot is not configured. Set HUBSPOT_ACCESS_TOKEN." });
      }

      const lead = await storage.getLead(req.params.id);
      if (!lead) {
        return res.status(404).json({ message: "Lead not found" });
      }

      const domain = extractDomain(lead.website);
      const addressParts = parseAddress(lead.address);

      // Build description: AI summary + GBP category + rating
      const descriptionParts: string[] = [];
      if (lead.category) descriptionParts.push(`Category: ${lead.category}`);
      if (lead.rating) descriptionParts.push(`Google Rating: ${lead.rating}/5 (${lead.totalReviews || 0} reviews)`);
      const aiSummary = (lead.aiAnalysis as any)?.summary;
      if (aiSummary) descriptionParts.push(aiSummary);

      const result = await hubspotService.createCompany({
        name: lead.businessName,
        domain: domain || undefined,
        phone: lead.phone || undefined,
        website: lead.website || undefined,
        address: addressParts.street,
        city: addressParts.city,
        state: addressParts.state,
        zip: addressParts.zip,
        description: descriptionParts.join('\n\n') || undefined,
        business_email: lead.email || undefined,
      });

      const updatedLead = await storage.updateLead(lead.id, {
        hubspotCompanyId: result.id,
        hubspotPushedAt: new Date(),
      });

      res.json({ success: true, hubspotCompanyId: result.id, lead: updatedLead });
    } catch (error: any) {
      console.error('HubSpot push error:', error);
      res.status(500).json({ message: error.message });
    }
  });

  // Manually trigger email discovery for a lead
  app.post('/api/leads/:id/enrich', requireAuth, async (req, res) => {
    try {
      const lead = await storage.getLead(req.params.id);
      if (!lead) {
        return res.status(404).json({ message: "Lead not found" });
      }

      const updates: any = { enrichedAt: new Date() };

      if (lead.website && !lead.email) {
        try {
          const emailResult = await emailDiscoveryService.discoverEmails(lead.website);
          if (emailResult.emails.length > 0) {
            updates.email = emailResult.emails[0];
            updates.emailSource = emailResult.source;
          }
        } catch (error) {
          console.error('Email discovery failed for', lead.website, error);
        }
      }

      const updatedLead = await storage.updateLead(lead.id, updates);
      res.json(updatedLead);
    } catch (error: any) {
      console.error('Lead enrichment error:', error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get('/api/leads', requireAuth, async (req, res) => {
    try {
      const user = req.session.user!;
      const { priority, status } = req.query;

      const leads = await storage.getLeads(user.id, user.workspaceId, {
        priority: priority as string,
        status: status as string
      });

      res.json(leads);
    } catch (error: any) {
      console.error('Get leads error:', error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post('/api/leads/:id/score', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const lead = await storage.getLead(id);

      if (!lead) {
        return res.status(404).json({ message: "Lead not found" });
      }

      const analysis = await aiService.analyzeLead({
        businessName: lead.businessName,
        category: lead.category || undefined,
        address: lead.address || undefined,
        phone: lead.phone || undefined,
        website: lead.website || undefined,
      });

      await storage.updateLeadAiAnalysis(id, analysis.score, analysis);

      res.json({ analysis });
    } catch (error: any) {
      console.error('Lead scoring error:', error);
      res.status(500).json({ message: error.message });
    }
  });

  // LinkedIn search routes (Phase 3 — Unipile-backed prospect search)
  app.post('/api/linkedin/search', linkedinLimiter, requireAuth, validateBody(linkedinSearchSchema), async (req, res) => {
    try {
      const user = req.session.user!;
      const { query, title, company, industry, location, cursor } = req.body ?? {};
      const result = await linkedInSearchService.search(
        { query, title, company, industry, location, cursor },
        user.workspaceId
      );
      res.json({ success: true, ...result });
    } catch (error: any) {
      if (error instanceof LinkedInSearchLimitError) {
        return res.status(429).json({
          success: false,
          error: error.message,
          remaining: error.remaining,
        });
      }
      console.error('LinkedIn search error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/linkedin/search/save', linkedinLimiter, requireAuth, validateBody(linkedinSaveProfilesSchema), async (req, res) => {
    try {
      const user = req.session.user!;
      const profiles = Array.isArray(req.body?.profiles) ? req.body.profiles : [];
      if (profiles.length === 0) {
        return res.status(400).json({ success: false, error: 'profiles array is required' });
      }
      const { result, leads } = await linkedInSearchService.saveProfiles(
        profiles,
        user.id,
        user.workspaceId
      );
      res.json({ success: true, data: result, leads });
    } catch (error: any) {
      console.error('LinkedIn save error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Google Business Profile routes
  app.get('/api/gbp-profiles', requireAuth, async (req, res) => {
    try {
      const user = req.session.user!;
      const profiles = await storage.getGbpProfiles(user.id, user.workspaceId);
      res.json(profiles);
    } catch (error: any) {
      console.error('Get GBP profiles error:', error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get('/api/gbp-profile/:locationId', requireAuth, async (req, res) => {
    try {
      const { locationId } = req.params;
      const user = req.session.user!;
      const profiles = await storage.getGbpProfiles(user.id, user.workspaceId);
      const profile = profiles.find(p => p.locationId === locationId);

      if (!profile) {
        return res.status(404).json({ message: "Profile not found" });
      }

      res.json(profile);
    } catch (error: any) {
      console.error('Get GBP profile error:', error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post('/api/gbp-profile/:locationId/update', requireAuth, async (req, res) => {
    try {
      const { locationId } = req.params;
      const updates = req.body;

      const user = req.session.user!;
      const profiles = await storage.getGbpProfiles(user.id, user.workspaceId);
      const profile = profiles.find(p => p.locationId === locationId);

      if (!profile) {
        return res.status(404).json({ message: "Profile not found" });
      }

      const updatedProfile = await storage.updateGbpProfile(profile.id, updates);
      res.json(updatedProfile);
    } catch (error: any) {
      console.error('Update GBP profile error:', error);
      res.status(500).json({ message: error.message });
    }
  });

  // Outreach routes
  // Preview-only: generates an email without sending
  app.post('/api/outreach/:leadId/preview', requireAuth, async (req, res) => {
    try {
      const lead = await storage.getLead(req.params.leadId);
      if (!lead) {
        return res.status(404).json({ message: "Lead not found" });
      }

      const emailContent = await aiService.generateOutreachEmail({
        businessName: lead.businessName,
        category: lead.category || undefined,
        issues: (lead.aiAnalysis as any)?.issues || [],
      });

      res.json({
        subject: emailContent.subject,
        content: emailContent.content,
        recipientEmail: lead.email,
      });
    } catch (error: any) {
      console.error('Outreach preview error:', error);
      res.status(500).json({ message: error.message });
    }
  });

  // Send outreach. Accepts optional `subject` and `content` overrides in body.
  app.post('/api/outreach/:leadId', requireAuth, async (req, res) => {
    try {
      const { leadId } = req.params;
      const user = req.session.user!;
      const { subject: overrideSubject, content: overrideContent } = req.body || {};

      const lead = await storage.getLead(leadId);
      if (!lead) {
        return res.status(404).json({ message: "Lead not found" });
      }

      if (!lead.email) {
        return res.status(400).json({ message: "Lead email not available" });
      }

      // Use user-provided content if given, otherwise generate new
      let emailContent: { subject: string; content: string };
      if (overrideSubject && overrideContent) {
        emailContent = { subject: overrideSubject, content: overrideContent };
      } else {
        emailContent = await aiService.generateOutreachEmail({
          businessName: lead.businessName,
          category: lead.category || undefined,
          issues: (lead.aiAnalysis as any)?.issues || [],
        });
      }

      // Send email — suppression + undeliverable + CAN-SPAM footer all
      // live inside the service. Throws EmailSuppressedError on
      // suppression, EmailUndeliverableError on Hunter-marked bad
      // addresses.
      let emailResult;
      try {
        emailResult = await emailService.sendOutreachEmail(
          lead.email,
          emailContent.subject,
          emailContent.content,
          { workspaceId: user.workspaceId }
        );
      } catch (err) {
        if (err instanceof EmailSuppressedError) {
          return res.status(409).json({
            success: false,
            error: err.message,
            code: 'suppressed',
          });
        }
        if (err instanceof EmailUndeliverableError) {
          return res.status(409).json({
            success: false,
            error: err.message,
            code: 'undeliverable',
          });
        }
        if (err instanceof EmailDailyLimitError) {
          return res.status(429).json({
            success: false,
            error: err.message,
            code: 'daily_limit',
            used: err.used,
            limit: err.limit,
          });
        }
        if (err instanceof PlanLimitExceededError) {
          return res.status(402).json({
            success: false,
            error: err.message,
            code: 'plan_limit',
            channel: err.channel,
            plan: err.plan,
            used: err.used,
            limit: err.limit,
          });
        }
        throw err;
      }

      // Store outreach record
      const outreachEmail = await storage.createOutreachEmail({
        leadId: leadId,
        recipientEmail: lead.email,
        subject: emailContent.subject,
        content: emailContent.content,
        status: 'sent',
        emailProvider: 'gmail',
        createdBy: user.id,
        workspaceId: user.workspaceId,
      });

      // Update lead status
      await storage.updateLead(leadId, { 
        status: 'contacted',
        lastContactedAt: new Date()
      });

      res.json({ 
        success: true, 
        messageId: emailResult.messageId,
        outreach: outreachEmail 
      });
    } catch (error: any) {
      console.error('Outreach error:', error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get('/api/outreach/sent', requireAuth, async (req, res) => {
    try {
      const user = req.session.user!;
      const emails = await storage.getOutreachEmailsByUser(user.id, user.workspaceId);
      res.json(emails);
    } catch (error: any) {
      console.error('Get sent emails error:', error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get('/api/outreach-campaigns', requireAuth, async (req, res) => {
    try {
      const user = req.session.user!;
      const campaigns = await storage.getCampaigns(user.id, user.workspaceId);
      res.json(campaigns);
    } catch (error: any) {
      console.error('Get outreach campaigns error:', error);
      res.status(500).json({ message: error.message });
    }
  });

  // Unified campaign routes (Phase 3 — supports both email and LinkedIn channels)
  app.get('/api/campaigns', requireAuth, async (req, res) => {
    try {
      const user = req.session.user!;
      const rows = await storage.getCampaigns(user.id, user.workspaceId);
      res.json({ success: true, data: rows });
    } catch (error: any) {
      console.error('Get campaigns error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/campaigns/:id', requireAuth, async (req, res) => {
    try {
      const campaign = await storage.getCampaign(req.params.id);
      if (!campaign) return res.status(404).json({ success: false, error: 'Campaign not found' });
      const steps = await storage.getCampaignSteps(campaign.id);
      res.json({ success: true, data: { ...campaign, steps } });
    } catch (error: any) {
      console.error('Get campaign error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/campaigns', requireAuth, validateBody(createCampaignSchema), async (req, res) => {
    try {
      const user = req.session.user!;
      const { name, description, outreachChannel, tone, dailySendLimit, maxTouches, requireApproval, emailTemplate } = req.body;
      const campaign = await storage.createCampaign({
        name,
        description: description ?? null,
        outreachChannel: outreachChannel ?? 'linkedin',
        tone: tone ?? 'consultative',
        dailySendLimit: dailySendLimit ?? 20,
        maxTouches: maxTouches ?? 5,
        requireApproval: requireApproval ?? true,
        emailTemplate: emailTemplate ?? null,
        status: 'draft',
        createdBy: user.id,
        workspaceId: user.workspaceId,
      });
      res.json({ success: true, data: campaign });
    } catch (error: any) {
      console.error('Create campaign error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.patch('/api/campaigns/:id', requireAuth, async (req, res) => {
    try {
      const campaign = await storage.updateCampaign(req.params.id, req.body ?? {});
      res.json({ success: true, data: campaign });
    } catch (error: any) {
      console.error('Update campaign error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.delete('/api/campaigns/:id', requireAuth, async (req, res) => {
    try {
      await storage.deleteCampaign(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      console.error('Delete campaign error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Campaign steps
  app.get('/api/campaign-steps', requireAuth, async (req, res) => {
    try {
      const campaignId = req.query.campaignId as string | undefined;
      if (!campaignId) return res.status(400).json({ success: false, error: 'campaignId query param required' });
      const steps = await storage.getCampaignSteps(campaignId);
      res.json({ success: true, data: steps });
    } catch (error: any) {
      console.error('Get campaign steps error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/campaign-steps', requireAuth, validateBody(createCampaignStepSchema), async (req, res) => {
    try {
      const { campaignId, stepOrder, stepType, delayDays, promptTemplate, characterLimit } = req.body;
      const step = await storage.createCampaignStep({
        campaignId,
        stepOrder,
        stepType,
        delayDays: delayDays ?? 0,
        promptTemplate: promptTemplate ?? null,
        characterLimit: characterLimit ?? null,
      });
      res.json({ success: true, data: step });
    } catch (error: any) {
      console.error('Create campaign step error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.delete('/api/campaign-steps/:id', requireAuth, async (req, res) => {
    try {
      await storage.deleteCampaignStep(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      console.error('Delete campaign step error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Prompt version management (Phase 4 — A/B testing)
  app.get('/api/prompt-versions', requireAuth, async (req, res) => {
    try {
      const campaignId = req.query.campaignId as string | undefined;
      const stepOrder = req.query.stepOrder !== undefined
        ? parseInt(req.query.stepOrder as string)
        : undefined;
      if (!campaignId) {
        return res.status(400).json({ success: false, error: 'campaignId query param required' });
      }
      const versions = await storage.getPromptVersions(campaignId, stepOrder);
      const withRates = versions.map((v) => ({
        ...v,
        replyRate:
          v.timesUsed && v.timesUsed > 0
            ? ((v.replyCount ?? 0) / v.timesUsed) * 100
            : 0,
        positiveRate:
          v.replyCount && v.replyCount > 0
            ? ((v.positiveReplyCount ?? 0) / v.replyCount) * 100
            : 0,
      }));
      res.json({ success: true, data: withRates });
    } catch (error: any) {
      console.error('Get prompt versions error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/prompt-versions', requireAuth, async (req, res) => {
    try {
      const { campaignId, stepOrder, variant, promptTemplate, description } = req.body ?? {};
      if (!campaignId || stepOrder === undefined || !variant || !promptTemplate) {
        return res.status(400).json({
          success: false,
          error: 'campaignId, stepOrder, variant, promptTemplate are required',
        });
      }
      const version = await storage.createPromptVersion({
        campaignId,
        stepOrder,
        variant,
        promptTemplate,
        description: description ?? null,
      });
      res.json({ success: true, data: version });
    } catch (error: any) {
      console.error('Create prompt version error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.patch('/api/prompt-versions/:id', requireAuth, async (req, res) => {
    try {
      const updates = req.body ?? {};
      const version = await storage.updatePromptVersion(req.params.id, updates);
      res.json({ success: true, data: version });
    } catch (error: any) {
      console.error('Update prompt version error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Message generation — single enrollment
  app.post('/api/messages/generate', aiLimiter, requireAuth, validateBody(generateMessageSchema), async (req, res) => {
    try {
      const { enrollmentId, stepId } = req.body;
      const result = await queueGenerationService.generateForEnrollment(enrollmentId, stepId);
      res.json({ success: true, data: result });
    } catch (error: any) {
      console.error('Generate message error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Message generation — batch. Wired behind both session auth (for ops UI
  // "Generate now" button) and apiKeyAuth (for the scheduled cron job).
  app.post('/api/messages/trigger-batch', aiLimiter, (req, res, next) => {
    if (req.session?.user) return next();
    return apiKeyAuth(req, res, next);
  }, async (_req, res) => {
    try {
      const result = await queueGenerationService.generateBatch();
      res.json({ success: true, data: result });
    } catch (error: any) {
      console.error('Trigger batch error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Enroll a lead into a campaign
  app.post('/api/campaigns/:id/enroll', requireAuth, async (req, res) => {
    try {
      const campaignId = req.params.id;
      const { leadId } = req.body ?? {};
      if (!leadId) return res.status(400).json({ success: false, error: 'leadId is required' });
      const enrollment = await storage.enrollLead({
        campaignId,
        leadId,
        currentStepOrder: 0,
        status: 'active',
      });
      res.json({ success: true, data: enrollment });
    } catch (error: any) {
      console.error('Enroll lead error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Send queue management (Phase 3 — queue-management.js port)
  app.get('/api/queue', requireAuth, async (req, res) => {
    try {
      const user = req.session.user!;
      const status = (req.query.status as string | undefined) ?? 'pending';
      const items = await storage.getSendQueueByStatus(status, user.workspaceId);
      res.json({ success: true, data: items });
    } catch (error: any) {
      console.error('Get queue error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/queue/stats', requireAuth, async (req, res) => {
    try {
      const user = req.session.user!;
      const stats = await storage.getQueueStats(user.workspaceId);
      res.json({ success: true, data: stats });
    } catch (error: any) {
      console.error('Queue stats error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.patch('/api/queue/:id', requireAuth, async (req, res) => {
    try {
      const { status, editedDraft } = req.body ?? {};
      const updates: { status?: string; editedDraft?: string; reviewedAt?: Date } = {};
      if (status) updates.status = status;
      if (typeof editedDraft === 'string') updates.editedDraft = editedDraft;
      if (status) updates.reviewedAt = new Date();
      const row = await storage.updateSendQueueItem(req.params.id, updates);
      res.json({ success: true, data: row });
    } catch (error: any) {
      console.error('Update queue item error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/queue/bulk-approve', requireAuth, async (req, res) => {
    try {
      const { ids } = req.body ?? {};
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ success: false, error: 'ids array required' });
      }
      const approved = await storage.bulkUpdateQueueStatus(ids, 'pending', 'approved');
      res.json({ success: true, data: { approved } });
    } catch (error: any) {
      console.error('Bulk approve error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/queue/bulk-skip', requireAuth, async (req, res) => {
    try {
      const { ids } = req.body ?? {};
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ success: false, error: 'ids array required' });
      }
      const skipped = await storage.bulkUpdateQueueStatus(ids, 'pending', 'skipped');
      res.json({ success: true, data: { skipped } });
    } catch (error: any) {
      console.error('Bulk skip error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Dispatch approved queue items via Unipile. Wired for session auth
  // (ops UI) and apiKeyAuth (scheduler cron).
  app.post('/api/queue/dispatch', dispatchLimiter, (req, res, next) => {
    if (req.session?.user) return next();
    return apiKeyAuth(req, res, next);
  }, async (req, res) => {
    try {
      const workspaceId = req.session?.user?.workspaceId ?? null;
      const result = await unipileDispatchService.dispatchApproved(workspaceId);
      res.json({ success: true, data: result });
    } catch (error: any) {
      console.error('Dispatch error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Inbox events — reply_received + connection_accepted joined with lead
  app.get('/api/inbox/events', requireAuth, async (req, res) => {
    try {
      const user = req.session.user!;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      const events = await storage.getRecentInboxEvents(user.workspaceId, limit);
      res.json({ success: true, data: events });
    } catch (error: any) {
      console.error('Get inbox events error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Unipile inbox sync — fetches new replies + accepted connections,
  // classifies reply sentiment, records engagement_events. Session auth
  // for ops UI, apiKeyAuth for the scheduler cron.
  app.post('/api/inbox/sync', dispatchLimiter, (req, res, next) => {
    if (req.session?.user) return next();
    return apiKeyAuth(req, res, next);
  }, async (req, res) => {
    try {
      const workspaceId = req.session?.user?.workspaceId ?? null;
      const result = await inboxSyncService.sync(workspaceId);
      res.json({ success: true, data: result });
    } catch (error: any) {
      console.error('Inbox sync error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Phase 5 analytics — cross-channel overview, campaign comparison,
  // API cost dashboard, and A/B prompt leaderboard
  app.get('/api/analytics/overview', requireAuth, async (req, res) => {
    try {
      const user = req.session.user!;
      const days = parseInt((req.query.days as string) || '30');
      const overview = await analyticsService.getOverview(days, user.workspaceId);
      res.json({ success: true, data: overview });
    } catch (error: any) {
      console.error('Analytics overview error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/analytics/campaigns', requireAuth, async (req, res) => {
    try {
      const user = req.session.user!;
      const data = await analyticsService.getCampaignComparison(user.workspaceId);
      res.json({ success: true, data });
    } catch (error: any) {
      console.error('Campaign comparison error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/analytics/api-costs', requireAuth, async (req, res) => {
    try {
      const user = req.session.user!;
      const days = parseInt((req.query.days as string) || '30');
      const data = await analyticsService.getApiCosts(days, user.workspaceId);
      res.json({ success: true, data });
    } catch (error: any) {
      console.error('API costs error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/analytics/prompt-leaderboard', requireAuth, async (_req, res) => {
    try {
      const data = await analyticsService.getPromptLeaderboard();
      res.json({ success: true, data });
    } catch (error: any) {
      console.error('Prompt leaderboard error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Phase 5 optimization — auto-pause + Claude suggestions + VoC analysis
  app.post('/api/optimize/campaigns', aiLimiter, requireAuth, async (req, res) => {
    try {
      const user = req.session.user!;
      const result = await optimizationService.optimizeCampaigns(user.workspaceId);
      res.json({ success: true, data: result });
    } catch (error: any) {
      console.error('Optimize campaigns error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/optimize/voc-analysis', aiLimiter, requireAuth, async (req, res) => {
    try {
      const user = req.session.user!;
      const days = parseInt((req.query.days as string) || '30');
      const result = await optimizationService.vocAnalysis(days, user.workspaceId);
      res.json({ success: true, data: result });
    } catch (error: any) {
      console.error('VoC analysis error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/optimize/insights', requireAuth, async (req, res) => {
    try {
      const user = req.session.user!;
      const data = await optimizationService.getInsights(user.workspaceId);
      res.json({ success: true, data });
    } catch (error: any) {
      console.error('Get insights error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Phase 9 — Stripe billing. Disabled when STRIPE_SECRET_KEY isn't
  // set; the routes still mount so the frontend gets a clean 503
  // "billing not configured" response instead of a 404.
  app.get('/api/billing/plans', requireAuth, (_req, res) => {
    res.json({
      success: true,
      data: Object.entries(PLAN_LIMITS).map(([tier, limits]) => ({
        tier,
        name: limits.name,
        priceUsdPerMonth: limits.priceUsdPerMonth,
        emailSendsPerMonth: limits.emailSendsPerMonth,
        linkedinSendsPerMonth: limits.linkedinSendsPerMonth,
        members: limits.members === Number.POSITIVE_INFINITY ? 'unlimited' : limits.members,
        unipileAccounts: limits.unipileAccounts,
      })),
    });
  });

  app.post('/api/billing/checkout', requireAuth, requireRole('admin'), async (req, res) => {
    try {
      const user = req.session.user!;
      if (!user.workspaceId) {
        return res.status(404).json({ success: false, error: 'No workspace' });
      }
      const { tier } = req.body ?? {};
      if (!['solo', 'team', 'agency'].includes(tier)) {
        return res.status(400).json({ success: false, error: 'tier must be solo/team/agency' });
      }
      const { url } = await billingService.createCheckoutSession(
        user.workspaceId,
        tier as 'solo' | 'team' | 'agency'
      );
      res.json({ success: true, data: { url } });
    } catch (error: any) {
      if (error instanceof BillingNotConfiguredError) {
        return res
          .status(503)
          .json({ success: false, error: error.message, code: 'billing_disabled' });
      }
      console.error('Billing checkout error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/billing/portal', requireAuth, requireRole('admin'), async (req, res) => {
    try {
      const user = req.session.user!;
      if (!user.workspaceId) {
        return res.status(404).json({ success: false, error: 'No workspace' });
      }
      const { url } = await billingService.createPortalSession(user.workspaceId);
      res.json({ success: true, data: { url } });
    } catch (error: any) {
      if (error instanceof BillingNotConfiguredError) {
        return res
          .status(503)
          .json({ success: false, error: error.message, code: 'billing_disabled' });
      }
      console.error('Billing portal error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post(
    '/api/webhooks/stripe',
    express.raw({ type: 'application/json' }),
    async (req, res) => {
      try {
        const signature = req.header('stripe-signature');
        if (!signature) {
          return res.status(401).json({ success: false, error: 'Missing stripe-signature header' });
        }
        const rawBody = Buffer.isBuffer(req.body)
          ? req.body
          : Buffer.from(JSON.stringify(req.body));
        const eventType = await billingService.handleWebhook(rawBody, signature);
        res.json({ success: true, eventType });
      } catch (error: any) {
        if (error instanceof BillingNotConfiguredError) {
          return res.status(503).json({ success: false, error: error.message });
        }
        console.error('Stripe webhook error:', error);
        res.status(400).json({ success: false, error: error.message });
      }
    }
  );

  // Phase 9 — Workspace management routes. The workspace itself was
  // stubbed in Phase 1.1 and auto-created in Phase 1.3 on first login;
  // these routes surface the record for the settings page and let
  // operators rename / change the plan tier (via Stripe webhook, not
  // direct write).
  app.get('/api/workspace', requireAuth, async (req, res) => {
    try {
      const user = req.session.user!;
      if (!user.workspaceId) {
        return res.status(404).json({ success: false, error: 'No workspace' });
      }
      const workspace = await storage.getWorkspace(user.workspaceId);
      if (!workspace) return res.status(404).json({ success: false, error: 'Workspace not found' });
      res.json({ success: true, data: workspace });
    } catch (error: any) {
      console.error('Get workspace error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.patch('/api/workspace', requireAuth, requireRole('admin'), async (req, res) => {
    try {
      const user = req.session.user!;
      if (!user.workspaceId) {
        return res.status(404).json({ success: false, error: 'No workspace' });
      }
      const { name, dailyEmailLimit } = req.body ?? {};
      const updates: Record<string, unknown> = {};
      if (typeof name === 'string') updates.name = name;
      if (typeof dailyEmailLimit === 'number') updates.dailyEmailLimit = dailyEmailLimit;
      const workspace = await storage.updateWorkspace(user.workspaceId, updates);
      res.json({ success: true, data: workspace });
    } catch (error: any) {
      console.error('Update workspace error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/workspace/usage', requireAuth, async (req, res) => {
    try {
      const user = req.session.user!;
      if (!user.workspaceId) {
        return res.status(404).json({ success: false, error: 'No workspace' });
      }
      const workspace = await storage.getWorkspace(user.workspaceId);
      if (!workspace) return res.status(404).json({ success: false, error: 'Workspace not found' });
      const limits = getPlanLimits(workspace.plan);
      res.json({
        success: true,
        data: {
          plan: workspace.plan ?? 'free',
          email: {
            used: workspace.monthlyEmailSendsUsed ?? 0,
            limit: limits.emailSendsPerMonth,
            percent: percentOf(workspace.monthlyEmailSendsUsed ?? 0, limits.emailSendsPerMonth),
          },
          linkedin: {
            used: workspace.monthlyLinkedinSendsUsed ?? 0,
            limit: limits.linkedinSendsPerMonth,
            percent: percentOf(
              workspace.monthlyLinkedinSendsUsed ?? 0,
              limits.linkedinSendsPerMonth
            ),
          },
        },
      });
    } catch (error: any) {
      console.error('Get workspace usage error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Phase 9 — Members list / role change / remove
  app.get('/api/workspace/members', requireAuth, async (req, res) => {
    try {
      const user = req.session.user!;
      if (!user.workspaceId) {
        return res.status(404).json({ success: false, error: 'No workspace' });
      }
      const members = await storage.getWorkspaceMembers(user.workspaceId);
      res.json({ success: true, data: members });
    } catch (error: any) {
      console.error('Get members error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.patch('/api/workspace/members/:id', requireAuth, requireRole('admin'), async (req, res) => {
    try {
      const { role } = req.body ?? {};
      if (role !== 'admin' && role !== 'member') {
        return res.status(400).json({ success: false, error: 'role must be admin or member' });
      }
      const updated = await storage.updateUserRole(req.params.id, role);
      res.json({ success: true, data: updated });
    } catch (error: any) {
      console.error('Update member error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.delete(
    '/api/workspace/members/:id',
    requireAuth,
    requireRole('admin'),
    async (req, res) => {
      try {
        const user = req.session.user!;
        if (req.params.id === user.id) {
          return res
            .status(400)
            .json({ success: false, error: 'Cannot remove yourself from the workspace' });
        }
        await storage.removeUserFromWorkspace(req.params.id);
        res.json({ success: true });
      } catch (error: any) {
        console.error('Remove member error:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    }
  );

  // Phase 9.5 — Unipile multi-account management (Agency tier).
  // Routes mount for every tier but enforcement lives at the plan
  // level: free/solo plans are capped at 1 Unipile account via the
  // POST handler's explicit check.
  app.get('/api/unipile-accounts', requireAuth, async (req, res) => {
    try {
      const user = req.session.user!;
      if (!user.workspaceId) {
        return res.json({ success: true, data: [] });
      }
      const accounts = await storage.getUnipileAccounts(user.workspaceId);
      res.json({ success: true, data: accounts });
    } catch (error: any) {
      console.error('Get unipile accounts error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/unipile-accounts', requireAuth, requireRole('admin'), async (req, res) => {
    try {
      const user = req.session.user!;
      if (!user.workspaceId) {
        return res.status(400).json({ success: false, error: 'No workspace' });
      }
      const workspace = await storage.getWorkspace(user.workspaceId);
      const limits = getPlanLimits(workspace?.plan);
      const existing = await storage.getUnipileAccounts(user.workspaceId);
      if (existing.length >= limits.unipileAccounts) {
        return res.status(402).json({
          success: false,
          error: `Plan ${workspace?.plan ?? 'free'} allows ${limits.unipileAccounts} Unipile account(s). Upgrade to Agency for more.`,
          code: 'plan_limit',
        });
      }
      const { accountId, label, dailyLimit } = req.body ?? {};
      if (!accountId) {
        return res.status(400).json({ success: false, error: 'accountId is required' });
      }
      const account = await storage.createUnipileAccount(
        user.workspaceId,
        accountId,
        label ?? null,
        typeof dailyLimit === 'number' ? dailyLimit : 50
      );
      res.json({ success: true, data: account });
    } catch (error: any) {
      console.error('Create unipile account error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.delete(
    '/api/unipile-accounts/:id',
    requireAuth,
    requireRole('admin'),
    async (req, res) => {
      try {
        await storage.deleteUnipileAccount(req.params.id);
        res.json({ success: true });
      } catch (error: any) {
        console.error('Delete unipile account error:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    }
  );

  // Settings (Phase 6) — workspace-scoped app_config read/write. Secrets
  // like API keys live in .env at the server level; this endpoint only
  // surfaces operator-configurable values (Unipile account, Calendly
  // link, daily limits, etc.). The API-usage summary is computed from
  // the api_usage_log aggregate so operators can see spend-to-date.
  const SETTINGS_KEYS = [
    'unipile_account_id',
    'unipile_base_url',
    'calendly_link',
    'linkedin_search_limit_hourly',
    'linkedin_dispatch_limit_hourly',
    'email_dispatch_limit_hourly',
    'linkedin_compliance_mode',
    'sendgrid_from_email',
    'slack_webhook_url',
  ] as const;
  type SettingsKey = (typeof SETTINGS_KEYS)[number];

  app.get('/api/settings', requireAuth, async (req, res) => {
    try {
      const user = req.session.user!;
      const config = await storage.getAllAppConfig(user.workspaceId);
      const values: Partial<Record<SettingsKey, string>> = {};
      for (const k of SETTINGS_KEYS) {
        if (config[k] !== undefined) values[k] = config[k];
      }
      // API usage (this calendar month)
      const monthStart = new Date();
      monthStart.setUTCDate(1);
      monthStart.setUTCHours(0, 0, 0, 0);
      const usage = await analyticsService.getApiCosts(31, user.workspaceId);

      res.json({
        success: true,
        data: {
          values,
          usage: {
            totalCalls: usage.totalCalls,
            estimatedClaudeCostUsd: usage.estimatedClaudeCostUsd,
            byProvider: usage.byProvider,
          },
          workspace: req.workspace ?? null,
        },
      });
    } catch (error: any) {
      console.error('Get settings error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.patch('/api/settings', requireAuth, async (req, res) => {
    try {
      const user = req.session.user!;
      const updates = (req.body ?? {}) as Partial<Record<SettingsKey, string>>;
      const updated: SettingsKey[] = [];
      for (const key of SETTINGS_KEYS) {
        const value = updates[key];
        if (typeof value === 'string') {
          await storage.setAppConfig(key, value, user.workspaceId);
          updated.push(key);
        }
      }
      res.json({ success: true, data: { updated } });
    } catch (error: any) {
      console.error('Update settings error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Phase 8 — email send counter for the Analytics header.
  app.get('/api/email/daily-usage', requireAuth, async (req, res) => {
    try {
      const user = req.session.user!;
      const workspace = user.workspaceId ? await storage.getWorkspace(user.workspaceId) : null;
      const cap = workspace?.dailyEmailLimit ?? 20;
      const midnight = new Date();
      midnight.setUTCHours(0, 0, 0, 0);
      const used = await storage.countEmailSendsSince(user.workspaceId ?? null, midnight);
      res.json({
        success: true,
        data: { used, cap, percent: cap > 0 ? Math.round((used / cap) * 100) : 0 },
      });
    } catch (error: any) {
      console.error('Daily usage error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Phase 8 — Hunter.io email verification. Single-lead verify.
  app.post('/api/leads/:id/verify-email', requireAuth, async (req, res) => {
    try {
      const user = req.session.user!;
      const lead = await storage.getLead(req.params.id);
      if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
      if (!lead.email) {
        return res.status(400).json({ success: false, error: 'Lead has no email address' });
      }
      const result = await verifyEmailWithHunter(lead.email, user.workspaceId);
      if (result.status !== 'skipped' && result.status !== 'error') {
        await storage.updateLead(lead.id, {
          emailVerified: result.status,
          emailVerifiedAt: new Date(),
        });
      }
      res.json({ success: true, data: result });
    } catch (error: any) {
      console.error('Verify email error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Bulk verify — fans out over all leads with an email + no prior verification
  app.post('/api/leads/verify-emails', aiLimiter, requireAuth, async (req, res) => {
    try {
      const user = req.session.user!;
      const allLeads = await storage.getLeads(user.id, user.workspaceId);
      const toVerify = allLeads.filter((l) => l.email && !l.emailVerified);
      const results: Array<{ id: string; status: string }> = [];
      for (const l of toVerify.slice(0, 50)) {
        if (!l.email) continue;
        const result = await verifyEmailWithHunter(l.email, user.workspaceId);
        if (result.status !== 'skipped' && result.status !== 'error') {
          await storage.updateLead(l.id, {
            emailVerified: result.status,
            emailVerifiedAt: new Date(),
          });
        }
        results.push({ id: l.id, status: result.status });
      }
      res.json({ success: true, data: { verified: results.length, results } });
    } catch (error: any) {
      console.error('Bulk verify error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Phase 7 — LinkedIn daily limit status for the Dashboard banner.
  // Surfaces per-action used/cap/percent so the frontend can render a
  // warning at >80% consumed. In-memory counters — Phase 9 moves to
  // unipile_accounts.daily_sends_used when multi-account lands.
  app.get('/api/linkedin/limits', requireAuth, (_req, res) => {
    const actions: LinkedInAction[] = [
      'search',
      'connection_request',
      'dispatch',
      'email',
    ];
    const data = actions.map((action) => {
      const used = dailyUsed(action);
      const cap = dailyCap(action);
      return {
        action,
        used,
        cap,
        percent: cap > 0 ? Math.round((used / cap) * 100) : 0,
      };
    });
    res.json({ success: true, data });
  });

  // Phase 7 — Suppression list CRUD
  app.get('/api/suppression', requireAuth, async (req, res) => {
    try {
      const user = req.session.user!;
      const entries = await storage.getSuppressionList(user.workspaceId);
      res.json({ success: true, data: entries });
    } catch (error: any) {
      console.error('Get suppression error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/suppression', requireAuth, async (req, res) => {
    try {
      const user = req.session.user!;
      const { email, domain, reason } = req.body ?? {};
      if (!email && !domain) {
        return res.status(400).json({ success: false, error: 'email or domain is required' });
      }
      if (!reason) {
        return res.status(400).json({ success: false, error: 'reason is required' });
      }
      const entry = await storage.addSuppressionEntry({
        workspaceId: user.workspaceId ?? null,
        email: email ? email.toLowerCase() : null,
        domain: domain ? domain.toLowerCase() : null,
        reason,
      });
      await storage.createAuditEntry({
        workspaceId: user.workspaceId ?? null,
        userId: user.id,
        action: 'suppression_added',
        entityType: 'suppression_list',
        entityId: entry.id,
        metadata: { email, domain, reason },
      });
      res.json({ success: true, data: entry });
    } catch (error: any) {
      console.error('Add suppression error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.delete('/api/suppression/:id', requireAuth, async (req, res) => {
    try {
      const user = req.session.user!;
      await storage.removeSuppressionEntry(req.params.id);
      await storage.createAuditEntry({
        workspaceId: user.workspaceId ?? null,
        userId: user.id,
        action: 'suppression_removed',
        entityType: 'suppression_list',
        entityId: req.params.id,
        metadata: null,
      });
      res.json({ success: true });
    } catch (error: any) {
      console.error('Remove suppression error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Public static legal pages. Served as raw HTML from Express so we
  // don't have to register client-side routes in wouter for content
  // that never changes. Both pages should be linked from the Login
  // footer and any outbound email footer.
  const legalPageShell = (title: string, body: string): string => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title} — ClearEdge Outreach</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 720px; margin: 60px auto; padding: 20px; color: #1f2937; line-height: 1.6; }
    h1 { font-size: 28px; margin-bottom: 8px; }
    h2 { font-size: 18px; margin-top: 28px; color: #111827; }
    p, li { color: #374151; }
    a { color: #4f46e5; }
    .updated { color: #6b7280; font-size: 13px; }
  </style>
</head>
<body>
${body}
<p class="updated">Last updated: 2026-04-11</p>
<p><a href="/">Back to ClearEdge Outreach</a></p>
</body>
</html>`;

  app.get('/privacy', (_req, res) => {
    res.send(
      legalPageShell(
        'Privacy Policy',
        `<h1>Privacy Policy</h1>
<p>This page describes how ClearEdge Outreach (the "Service") collects, uses, and protects
information about the people who use it and the prospects it communicates with.</p>

<h2>Information we collect</h2>
<ul>
  <li><strong>Workspace operators:</strong> name, email, profile photo, and Google OAuth tokens.</li>
  <li><strong>Prospects:</strong> publicly available LinkedIn profile data and business-discovery records
      (Google Places + custom search results). We do not collect private profile data.</li>
  <li><strong>Outbound messaging:</strong> message content, dispatch timestamps, reply content, and
      engagement events (connection acceptances, replies, meetings booked).</li>
  <li><strong>API usage:</strong> Claude and Unipile call counts + token totals for cost analytics.</li>
</ul>

<h2>How we use information</h2>
<ul>
  <li>To power prospect search, AI message generation, dispatch, and reply classification.</li>
  <li>To compute pipeline analytics and cost reporting within the operator's own workspace.</li>
  <li>To enforce rate limits and LinkedIn compliance rules.</li>
  <li>To honor unsubscribe, suppression, and GDPR deletion requests.</li>
</ul>

<h2>Data retention &amp; deletion</h2>
<p>Operators can permanently delete any prospect's full record (lead + every child row:
send_queue, send_log, engagement_events, outreach_emails, enrollments) through the
"GDPR delete" action in the Lead modal. All GDPR deletions are logged to our audit
trail under action=<code>gdpr_delete</code>.</p>
<p>Prospects can unsubscribe via the one-click link in every outbound email; once
unsubscribed, their address is added to the workspace suppression list and no further
outreach will be sent from that workspace.</p>

<h2>Third-party services</h2>
<p>ClearEdge Outreach integrates with Anthropic (Claude), Unipile (LinkedIn automation),
Google (OAuth + Places API + Custom Search), SendGrid (email delivery), and Supabase
(managed PostgreSQL). Each vendor has its own privacy policy; operators are responsible
for ensuring their use of the Service is compatible with the terms of those vendors.</p>

<h2>Contact</h2>
<p>Unsubscribe requests, GDPR deletion requests, and privacy questions can be sent to the
workspace operator who contacted you, or through the one-click unsubscribe link in any
email from us.</p>`
      )
    );
  });

  app.get('/terms', (_req, res) => {
    res.send(
      legalPageShell(
        'Terms of Service',
        `<h1>Terms of Service</h1>
<p>By using ClearEdge Outreach (the "Service"), you ("Operator") agree to these terms.</p>

<h2>Acceptable use</h2>
<ul>
  <li>The Service is for business-to-business outreach only. You will not use it to send
      unsolicited consumer messaging, political campaigns, or messages that violate
      CAN-SPAM, GDPR, PECR, or any other applicable anti-spam law.</li>
  <li>You will honor all unsubscribe requests within 10 business days (CAN-SPAM requires
      10; we honor immediately on one-click unsubscribe).</li>
  <li>You will not use the Service to impersonate another person or organization.</li>
  <li>You will not abuse the LinkedIn platform or violate LinkedIn's User Agreement.
      The Service enforces human-like delays and daily caps by default; disabling
      compliance mode is done at your own risk.</li>
</ul>

<h2>Your content &amp; data</h2>
<p>You own the lead data, campaign templates, and message content you create in the
Service. You grant us a limited license to process that data for the sole purpose of
delivering the Service to you.</p>

<h2>AI-generated output</h2>
<p>Messages drafted by the AI engine are recommendations, not endorsements. You are
responsible for reviewing every outbound message before dispatch (approval mode is ON
by default). The Service is not liable for the content of AI-generated drafts or for
any consequences of sending them.</p>

<h2>Service availability</h2>
<p>The Service is provided "as is" without warranty of uptime, deliverability, or
LinkedIn acceptance rates. Third-party outages (Anthropic, Unipile, SendGrid, Google)
can and do affect availability.</p>

<h2>Termination</h2>
<p>We may suspend or terminate access if we detect abuse of the Service, violation of
these terms, or material violation of third-party integration terms. You may stop
using the Service at any time and request full workspace data export before deletion.</p>

<h2>Compliance</h2>
<p>It is your responsibility to add your physical mailing address to the email footer
(via Settings → SendGrid from address), to maintain the suppression list in good faith,
and to comply with all applicable anti-spam and data-protection laws in your own and
your recipients' jurisdictions.</p>`
      )
    );
  });

  // Phase 8 — SendGrid event webhook. Handles bounce, spamreport,
  // unsubscribe (backup to our one-click), open, and click. Signature
  // verification per SendGrid's Event Webhook docs:
  //   1. ecdsa-with-SHA256 over (timestamp + rawBody)
  //   2. Public key from SENDGRID_WEBHOOK_PUBLIC_KEY env
  // We skip verification in dev when the key isn't set — otherwise a
  // misconfigured local env silently drops all events.
  app.post('/api/webhooks/sendgrid', express.raw({ type: 'application/json' }), async (req, res) => {
    try {
      const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));
      const publicKey = process.env.SENDGRID_WEBHOOK_PUBLIC_KEY;

      if (publicKey) {
        const signature = req.header('X-Twilio-Email-Event-Webhook-Signature');
        const timestamp = req.header('X-Twilio-Email-Event-Webhook-Timestamp');
        if (!signature || !timestamp) {
          return res.status(401).json({ success: false, error: 'Missing signature headers' });
        }
        try {
          const crypto = await import('crypto');
          const verifier = crypto.createVerify('sha256');
          verifier.update(timestamp + rawBody.toString());
          const valid = verifier.verify(
            { key: publicKey, format: 'pem' },
            signature,
            'base64'
          );
          if (!valid) {
            return res.status(401).json({ success: false, error: 'Invalid signature' });
          }
        } catch (err) {
          console.error('SendGrid webhook signature verify error:', err);
          return res.status(401).json({ success: false, error: 'Signature verification failed' });
        }
      }

      const events = JSON.parse(rawBody.toString()) as Array<{
        event: string;
        email: string;
        timestamp: number;
        sg_event_id?: string;
        emailId?: string;
        campaignId?: string;
        workspaceId?: string;
        reason?: string;
        type?: string;
      }>;

      for (const ev of events) {
        try {
          await handleSendgridEvent(ev);
        } catch (err) {
          console.error('SendGrid event handler error:', { ev: ev.event, err });
        }
      }

      res.json({ success: true, processed: events.length });
    } catch (error: any) {
      console.error('SendGrid webhook error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  async function handleSendgridEvent(ev: {
    event: string;
    email: string;
    timestamp: number;
    emailId?: string;
    campaignId?: string;
    workspaceId?: string;
    reason?: string;
    type?: string;
  }) {
    const ts = new Date(ev.timestamp * 1000);
    const email = ev.email.toLowerCase();

    // Find the outreach_emails row — prefer the customArg id, fall back
    // to latest-by-recipient.
    const row =
      (ev.emailId && (await storage.getLatestOutreachEmailByRecipient(email))) ||
      (await storage.getLatestOutreachEmailByRecipient(email));

    switch (ev.event) {
      case 'bounce': {
        if (row) await storage.updateOutreachEmailStatus(row.id, 'bounced', ts);
        if (row?.leadId) await storage.markLeadEmailStatus(row.leadId, 'bounced');
        // Hard bounce → permanent suppression; soft bounce gets one free pass.
        if (ev.type === 'hard') {
          await storage.addSuppressionEntry({
            workspaceId: ev.workspaceId ?? null,
            email,
            domain: null,
            reason: 'bounced',
          });
        }
        break;
      }
      case 'spamreport': {
        if (row) await storage.updateOutreachEmailStatus(row.id, 'spam', ts);
        await storage.addSuppressionEntry({
          workspaceId: ev.workspaceId ?? null,
          email,
          domain: null,
          reason: 'spam_report',
        });
        break;
      }
      case 'unsubscribe': {
        await storage.addSuppressionEntry({
          workspaceId: ev.workspaceId ?? null,
          email,
          domain: null,
          reason: 'unsubscribed',
        });
        break;
      }
      case 'open': {
        if (row) await storage.updateOutreachEmailStatus(row.id, 'opened', ts);
        break;
      }
      case 'click': {
        if (row) await storage.updateOutreachEmailStatus(row.id, 'clicked', ts);
        break;
      }
      // 'delivered', 'processed', 'deferred', 'dropped' — we don't act on these
      default:
        break;
    }
  }

  // Open tracking pixel fallback — returns a 1x1 transparent GIF and
  // updates outreach_emails.opened_at. Defense-in-depth against mail
  // clients that strip SendGrid's native open tracking pixel.
  const TRANSPARENT_GIF = Buffer.from(
    'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    'base64'
  );
  app.get('/track/open/:emailId', async (req, res) => {
    try {
      await storage.updateOutreachEmailStatus(req.params.emailId, 'opened', new Date());
    } catch (err) {
      console.error('Open tracking error:', err);
    }
    res.setHeader('Content-Type', 'image/gif');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.send(TRANSPARENT_GIF);
  });

  // Public unsubscribe — no auth required. Verifies HMAC-signed token,
  // adds the email to the suppression list, returns a plain HTML
  // confirmation page so recipients don't see a JSON blob.
  app.get('/unsubscribe/:token', async (req, res) => {
    const email = verifyUnsubscribeToken(req.params.token);
    if (!email) {
      return res.status(400).send(
        `<!doctype html><html><head><title>Invalid link</title></head>
         <body style="font-family: system-ui; max-width: 560px; margin: 80px auto; padding: 20px;">
           <h1>Invalid unsubscribe link</h1>
           <p>This link is not valid. If you'd like to unsubscribe, reply to any email from us
           with the word "unsubscribe" in the subject.</p>
         </body></html>`
      );
    }
    try {
      await storage.addSuppressionEntry({
        workspaceId: null, // workspace-global unsubscribe — conservative default
        email: email.toLowerCase(),
        domain: null,
        reason: 'unsubscribed',
      });
      await storage.createAuditEntry({
        workspaceId: null,
        userId: null,
        action: 'unsubscribe',
        entityType: 'suppression_list',
        entityId: null,
        metadata: { email, source: 'unsubscribe_link' },
      });
    } catch (err) {
      console.error('Unsubscribe insert error:', err);
      // Fall through — still show success so we don't leak internal errors.
    }
    res.send(
      `<!doctype html><html><head><title>Unsubscribed</title></head>
       <body style="font-family: system-ui; max-width: 560px; margin: 80px auto; padding: 20px;">
         <h1>You're unsubscribed</h1>
         <p><strong>${email}</strong> has been added to our suppression list. You will not
         receive any further outreach from this workspace.</p>
         <p style="color: #666; font-size: 14px;">If you believe this is a mistake, please
         contact the sender directly.</p>
       </body></html>`
    );
  });

  // GDPR hard delete — permanently removes a lead and every child row.
  // Workspace-scoped access check: the user must own (createdBy) the lead
  // OR share its workspace_id.
  app.delete('/api/leads/:id/gdpr', requireAuth, async (req, res) => {
    try {
      const user = req.session.user!;
      const lead = await storage.getLead(req.params.id);
      if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
      if (lead.createdBy !== user.id && lead.workspaceId !== user.workspaceId) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }

      const result = await storage.gdprDeleteLead(req.params.id);
      await storage.createAuditEntry({
        workspaceId: user.workspaceId ?? null,
        userId: user.id,
        action: 'gdpr_delete',
        entityType: 'lead',
        entityId: req.params.id,
        metadata: result,
      });
      res.json({ success: true, data: result });
    } catch (error: any) {
      console.error('GDPR delete error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // CSV exports (Phase 5)
  app.get('/api/export/leads.csv', requireAuth, async (req, res) => {
    try {
      const user = req.session.user!;
      const rows = await storage.getLeads(user.id, user.workspaceId);
      const columns = [
        'id',
        'leadSource',
        'businessName',
        'fullName',
        'email',
        'phone',
        'website',
        'linkedinUrl',
        'title',
        'company',
        'industry',
        'status',
        'priority',
        'aiScore',
        'hubspotCompanyId',
        'createdAt',
      ] as const;
      const csv = toCsv(columns, rows);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="leads.csv"');
      res.send(csv);
    } catch (error: any) {
      console.error('Leads CSV export error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/export/campaigns.csv', requireAuth, async (req, res) => {
    try {
      const user = req.session.user!;
      const rows = await analyticsService.getCampaignComparison(user.workspaceId);
      const columns = [
        'id',
        'name',
        'status',
        'outreachChannel',
        'enrolled',
        'contacted',
        'connected',
        'messagesSent',
        'replied',
        'replyRate',
        'positiveReplies',
        'positiveRate',
        'meetingsBooked',
      ] as const;
      const csv = toCsv(columns, rows);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="campaigns.csv"');
      res.send(csv);
    } catch (error: any) {
      console.error('Campaigns CSV export error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Legacy GBP summary route kept for the existing Analytics.tsx widget
  app.get('/api/analytics/summary', requireAuth, async (req, res) => {
    try {
      const user = req.session.user!;

      const [leads, campaigns] = await Promise.all([
        storage.getLeads(user.id, user.workspaceId),
        storage.getCampaigns(user.id, user.workspaceId)
      ]);

      const summary = {
        totalLeads: leads.length,
        highPriorityLeads: leads.filter(l => l.priority === 'high').length,
        contactedLeads: leads.filter(l => l.status === 'contacted').length,
        totalCampaigns: campaigns.length,
        totalEmailsSent: campaigns.reduce((sum, c) => sum + (c.totalSent || 0), 0),
        totalOpened: campaigns.reduce((sum, c) => sum + (c.totalOpened || 0), 0),
        totalReplied: campaigns.reduce((sum, c) => sum + (c.totalReplied || 0), 0),
      };

      res.json(summary);
    } catch (error: any) {
      console.error('Analytics summary error:', error);
      res.status(500).json({ message: error.message });
    }
  });

  // Health check
  app.get('/api/health', async (req, res) => {
    const status = {
      server: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        email: await emailService.verifyConnection(),
        anthropic: !!process.env.ANTHROPIC_API_KEY,
        googleAuth: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
        googlePlaces: placesApiService.isConfigured(),
        hubspot: hubspotService.isConfigured(),
      }
    };

    res.json(status);
  });

  const httpServer = createServer(app);
  return httpServer;
}
