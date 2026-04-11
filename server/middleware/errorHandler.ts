import type { ErrorRequestHandler } from 'express';

type StatusError = Error & { status?: number };

// Centralized error handler. Mounted last via app.use(errorHandler) in
// server/index.ts once Phase 2 migrates the inline try/catch blocks.
// Logs structurally via console.error for now; replaced with pino in
// Phase 6's structured-logger pass.
export const errorHandler: ErrorRequestHandler = (err: StatusError, _req, res, _next) => {
  console.error('[unhandled]', { message: err.message, stack: err.stack });

  const status = err.status ?? 500;
  const message = status === 500 ? 'Internal server error' : err.message;
  res.status(status).json({ success: false, error: message });
};
