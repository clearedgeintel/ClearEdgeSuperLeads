// Role-based access control. Phase 9 adds two roles to users.role:
//   admin  — full workspace management (invite/remove members, change
//            plan, delete campaigns, GDPR-delete leads)
//   member — read/write on their own leads + campaigns, no member
//            management, no billing changes
//
// `requireRole('admin')` mounts alongside requireAuth on destructive
// operations. The role is read straight off the session user so we
// don't hit the DB for every check; Phase 12 audit log captures role
// changes so the session role stays fresh after a promotion.

import type { RequestHandler } from 'express';

export type Role = 'admin' | 'member';

export function requireRole(minRole: Role): RequestHandler {
  return (req, res, next) => {
    const user = req.session?.user;
    if (!user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    const userRole = (user.role as Role | undefined) ?? 'member';
    // admin satisfies both 'admin' and 'member'; member only satisfies 'member'.
    if (minRole === 'admin' && userRole !== 'admin') {
      return res
        .status(403)
        .json({ success: false, error: 'Admin role required for this action' });
    }
    next();
  };
}
