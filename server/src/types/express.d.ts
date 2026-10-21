import type { UserDocument } from '@/models/User';

declare global {
  namespace Express {
    /**
     * `@types/passport` declares `Request.user` as `Express.User`, so the account
     * document is attached by widening that interface rather than by declaring
     * `user` a second time. Set by `requireAuth`; read it through
     * `getAuthenticatedUser`, never directly.
     */
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- an interface is the only way to merge into Passport's declaration
    interface User extends UserDocument {}

    interface Request {
      /** Correlation id assigned by the requestId middleware and echoed as X-Request-Id. */
      id: string;
    }
  }
}

export {};
