import 'express-session';
import type { User } from '@shared/schema';

declare module 'express-session' {
  interface SessionData {
    user?: User;
  }
}
