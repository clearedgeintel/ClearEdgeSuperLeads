// Rate-limit middleware factories. Keeps the Express-facing knobs in
// one place so routes just import a named limiter instead of bespoke
// config blocks. Three tiers:
//
//   linkedinLimiter   — LinkedIn search + save (Unipile-backed, Phase 3)
//   aiLimiter         — Claude-backed generation/analysis endpoints
//   dispatchLimiter   — Queue dispatch + inbox sync (heavy Unipile + DB)
//
// The in-memory store is fine for single-instance deploys. Phase 9
// multi-instance scaling should swap the store for Redis.

import rateLimit from 'express-rate-limit';

export const linkedinLimiter = rateLimit({
  windowMs: 60_000, // 1 minute
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many LinkedIn requests. Try again in a minute.' },
});

export const aiLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many AI requests. Try again in a minute.' },
});

export const dispatchLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Dispatch rate limit hit. Try again in a minute.' },
});
