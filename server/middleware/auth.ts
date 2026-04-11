import type { RequestHandler } from 'express';

// API key authentication for machine-to-machine endpoints (n8n webhooks,
// internal cron triggers). If API_KEY is unset, the middleware is a no-op
// so local dev doesn't require a key. Session-based auth for interactive
// users lives in fallbackAuth.ts as `requireAuth`.
export const apiKeyAuth: RequestHandler = (req, res, next) => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) return next();

  const provided = req.headers['x-api-key'];
  if (!provided || provided !== apiKey) {
    return res.status(401).json({ success: false, error: 'Invalid or missing API key' });
  }
  next();
};
