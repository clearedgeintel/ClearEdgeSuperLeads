import 'express-session';
import type { User, Workspace } from '@shared/schema';

declare module 'express-session' {
  interface SessionData {
    user?: User;
    // Set when an un-logged-in invitee hits /accept-invite/:token, consumed
    // after Google OAuth completes to place them in the invited workspace.
    pendingInviteId?: string;
  }
}

declare global {
  namespace Express {
    interface Request {
      workspace?: Workspace;
    }
  }
}
