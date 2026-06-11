import express, { type Request, Response, NextFunction } from "express";
import helmet from "helmet";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { startScheduler } from "./jobs/scheduler";

// Fail loud in production if SESSION_SECRET is unset. Session cookies AND the
// HMAC-signed unsubscribe/invite tokens fall back to a hardcoded dev secret
// otherwise — which would make those tokens forgeable. Dev keeps the fallback.
if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  throw new Error(
    'SESSION_SECRET must be set in production — it signs sessions and unsubscribe/invite tokens.',
  );
}

// Process-level safety net. Third-party libraries (nodemailer, pg pools,
// fetch streams) occasionally emit async errors that bypass our route-
// level try/catch. Log them loudly but keep the server up — crashing the
// whole process on an SMTP credential misconfig is hostile in dev and
// unacceptable in prod.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

const app = express();

// Security headers. CSP is disabled because the SPA (and Vite dev HMR) rely on
// inline scripts/styles that a default policy would block; the other protections
// (HSTS, X-Content-Type-Options, frameguard, referrer policy, etc.) all apply.
// crossOriginEmbedderPolicy is off so the client can load third-party assets
// (Stripe, tracking pixels) without COEP failures.
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }),
);
// Note: CORS is mounted in registerRoutes() (server/routes.ts) — don't add a
// second cors() here or origins get double Access-Control-Allow-Origin headers.

// Signature-verified webhooks (Stripe, Resend) need the raw, unparsed body and
// mount their own express.raw() parser in registerRoutes(). Skip the global
// JSON parser for those exact paths — otherwise it consumes the stream first,
// req.body becomes a parsed object, and HMAC/signature verification fails on a
// re-stringified body. (Calendly/Cal.com webhooks use parsed JSON, so only the
// signature-verified raw paths are excluded here.)
const RAW_BODY_PATHS = new Set(['/api/webhooks/stripe', '/api/webhooks/resend']);
const jsonParser = express.json();
app.use((req, res, next) => {
  if (RAW_BODY_PATHS.has(req.path)) return next();
  jsonParser(req, res, next);
});
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    console.error('[express] unhandled route error', err);
    if (!res.headersSent) {
      res.status(status).json({ message });
    }
    // Don't re-throw — Express has no upstream error handler; re-throwing
    // just produces an unhandledRejection and risks crashing the process.
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = parseInt(process.env.PORT || '5000');
  server.listen({
    port,
    host: "0.0.0.0",
  }, () => {
    log(`serving on port ${port}`);
    startScheduler();
  });
})();
