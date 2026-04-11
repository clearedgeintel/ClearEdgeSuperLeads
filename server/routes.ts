import type { Express } from "express";
import { createServer, type Server } from "http";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import cors from "cors";
import { storage } from "./storage";
import { pool } from "./db";
import { googleAuthService } from "./services/googleAuth";
import { aiService } from "./services/aiService";
import { emailService } from "./services/email";
import { placesApiService } from "./services/placesApi";
import { emailDiscoveryService } from "./services/emailDiscovery";
import { hubspotService, extractDomain, parseAddress } from "./services/hubspotService";
import { setupFallbackAuth, requireAuth } from "./fallbackAuth";

import { nanoid } from "nanoid";
import type { PlaceDetails } from "./services/placesApi";
import { aiQueue } from "./lib/backgroundQueue";

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

      // Send email
      const emailResult = await emailService.sendOutreachEmail(
        lead.email,
        emailContent.subject,
        emailContent.content
      );

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

  // Analytics routes
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
