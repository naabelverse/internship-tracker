import type { UserDocument } from '@/models/User';

declare global {
  namespace Express {
    interface Request {
      /** Correlation id assigned by the requestId middleware and echoed as X-Request-Id. */
      id: string;
      /** Set by `requireAuth`. Read it through `getAuthenticatedUser`, never directly. */
      user?: UserDocument;
    }
  }
}

export {};
