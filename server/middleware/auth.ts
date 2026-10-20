import type { RequestHandler } from 'express';

// API key authentication for machine-to-machine endpoints (n8n webhooks,
// internal cron triggers). If API_KEY is unset, the middleware is a no-op
// so local dev doesn't require a key. Session-based auth for interactive
// users lives in fallbackAuth.ts as `requireAuth`.
//
// In production a missing API_KEY would leave those endpoints open, so we
// fail closed: importing this module throws and the server refuses to start.
export function assertApiKeyConfigured(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === 'production' && !env.API_KEY) {
    throw new Error(
      'API_KEY must be set in production. apiKeyAuth guards the cron/webhook endpoints ' +
        'and refuses to run open. Set API_KEY in the environment (see .env.example).',
    );
  }
}

assertApiKeyConfigured();

export const apiKeyAuth: RequestHandler = (req, res, next) => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) return next();

  const provided = req.headers['x-api-key'];
  if (!provided || provided !== apiKey) {
    return res.status(401).json({ success: false, error: 'Invalid or missing API key' });
  }
  next();
};
