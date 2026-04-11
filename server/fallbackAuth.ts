import type { Express, RequestHandler } from "express";
import { storage } from "./storage";
import { nanoid } from "nanoid";

// Fallback authentication for testing without Google OAuth
export function setupFallbackAuth(app: Express) {
  // Demo login route that creates a test user
  app.post('/api/auth/demo-login', async (req, res) => {
    try {
      // Create or get demo user
      const demoUser = await storage.upsertUser({
        id: 'demo-user-1',
        email: 'demo@gbpconsulting.com',
        firstName: 'Demo',
        lastName: 'User',
        profileImageUrl: null,
        googleAccessToken: null,
        googleRefreshToken: null,
        tokenExpiresAt: null,
      });

      // Store user in session
      req.session.user = demoUser;

      res.json({ success: true, user: demoUser });
    } catch (error: any) {
      console.error('Demo login error:', error);
      res.status(500).json({ message: "Demo login failed" });
    }
  });

  // Check if user is authenticated
  app.get('/api/auth/user', (req, res) => {
    const user = req.session.user;
    if (!user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    
    // Don't send sensitive token data to frontend
    const { googleAccessToken, googleRefreshToken, ...safeUser } = user;
    res.json(safeUser);
  });

  // Logout
  app.post('/api/auth/logout', (req, res) => {
    req.session?.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: "Logout failed" });
      }
      res.json({ message: "Logged out successfully" });
    });
  });
}

// Authentication middleware for protected routes
export const requireAuth: RequestHandler = async (req, res, next) => {
  if (!req.session?.user) {
    return res.status(401).json({ message: "Authentication required" });
  }
  next();
};