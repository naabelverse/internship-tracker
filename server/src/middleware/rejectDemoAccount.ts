import type { NextFunction, Request, Response } from 'express';
import { getAuthenticatedUser } from '@/middleware/requireAuth';
import { ApiError } from '@/utils/ApiError';

/**
 * SPEC section 12: the shared demo account blocks destructive actions.
 *
 * This is a server-side guard rather than a hidden button, because the demo
 * credentials are published in the README and `POST /auth/demo` hands a session
 * to anyone who asks — so a demo caller can always reach the API directly.
 * Hiding the control in the UI would protect nothing.
 *
 * The refusal is deliberately explicit about *why*, so the client can surface it
 * as a toast without having to recognise which endpoint it came from.
 */
export const DEMO_READONLY_CODE = 'DEMO_ACCOUNT_READONLY';

const DEMO_READONLY_MESSAGE =
  'The demo account is shared and resets every night, so this action is disabled here. Create your own free account to try it.';

export interface RejectDemoOptions {
  /**
   * Narrows the guard to part of an endpoint. `PATCH /auth/me` needs this: the
   * preferences stay open so the demo can show theme and timezone changes,
   * while the address and the profile card are shared by every visitor.
   */
  when?: (req: Request) => boolean;
}

export function rejectDemoAccount(options: RejectDemoOptions = {}) {
  return function guard(req: Request, _res: Response, next: NextFunction): void {
    const user = getAuthenticatedUser(req);

    if (!user.isDemo) {
      next();
      return;
    }

    if (options.when && !options.when(req)) {
      next();
      return;
    }

    next(ApiError.forbidden(DEMO_READONLY_MESSAGE, DEMO_READONLY_CODE));
  };
}

/**
 * Fields every visitor of the shared demo sees as "the account": its address
 * (a change would be a takeover of the shared login) and the profile card. The
 * avatar is drawn in the top bar for everyone signed in to the demo, so an open
 * profile would let one visitor show the next an image or name of their choosing.
 */
const SHARED_PROFILE_FIELDS = [
  'email',
  'name',
  'university',
  'gradYear',
  'avatarUrl',
  'targetRoles',
] as const;

/** True when a profile patch touches what the demo's visitors share. */
export function changesSharedProfile(req: Request): boolean {
  const body = (req.body ?? {}) as Record<string, unknown>;
  return SHARED_PROFILE_FIELDS.some((field) => body[field] !== undefined);
}
