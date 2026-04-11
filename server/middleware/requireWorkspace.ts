import type { RequestHandler } from 'express';
import { storage } from '../storage';

// Workspace resolver stub. Reads the session user, loads their workspace,
// and attaches it to req.workspace. In Phase 1 this is non-blocking — if
// no workspace exists the request continues with req.workspace undefined.
// Phase 9 promotes this to a hard 403 gate on every tenant-scoped route.
export const requireWorkspace: RequestHandler = async (req, res, next) => {
  const user = req.session?.user;
  if (!user) return next();

  if (!user.workspaceId) return next();

  try {
    const workspace = await storage.getWorkspace(user.workspaceId);
    if (workspace) req.workspace = workspace;
    next();
  } catch (err) {
    console.error('[requireWorkspace] lookup failed', err);
    next();
  }
};
