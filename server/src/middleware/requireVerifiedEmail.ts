import type { NextFunction, Request, Response } from 'express';
import { getAuthenticatedUser } from '@/middleware/requireAuth';
import { VERIFICATION_GRACE_MS } from '@/services/accountLifecycle.service';
import { ApiError } from '@/utils/ApiError';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * SPEC section 5: an unverified account has full use of the app for seven days,
 * after which writes are refused with `EMAIL_UNVERIFIED` and the client shows a
 * banner with a resend button. Reads stay open for ever, so nobody is locked out
 * of their own data, and login is never gated on verification at all.
 */
export function requireVerifiedEmail(req: Request, _res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const user = getAuthenticatedUser(req);

  if (user.emailVerified) {
    next();
    return;
  }

  if (Date.now() - user.createdAt.getTime() < VERIFICATION_GRACE_MS) {
    next();
    return;
  }

  next(
    ApiError.forbidden(
      'Confirm your email address to keep making changes. Check your inbox, or ask for a new link.',
      'EMAIL_UNVERIFIED',
    ),
  );
}
