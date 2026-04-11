import 'express-session';
import type { User, Workspace } from '@shared/schema';

declare module 'express-session' {
  interface SessionData {
    user?: User;
  }
}

declare global {
  namespace Express {
    interface Request {
      workspace?: Workspace;
    }
  }
}
