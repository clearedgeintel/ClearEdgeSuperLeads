// Structured logger — Phase 6 final-pass replacement for console.*.
// Uses pino for JSON output in production and pino-pretty in dev. Log
// level defaults to 'info'; set LOG_LEVEL=debug locally to see the
// chatter from retry.ts and linkedinLimiter.humanDelay.
//
// Callers pass a structured object as the first arg and a message as
// the second — pino is opinionated about this shape:
//
//     logger.info({ leadId, campaignId }, 'generated message');
//
// (not logger.info('generated message', { leadId })).

import pino from 'pino';

const isProd = process.env.NODE_ENV === 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: isProd
    ? undefined
    : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname',
        },
      },
});
