import type { User } from '@/types/user';

/**
 * Mirrors `VERIFICATION_GRACE_MS` in `server/src/services/accountLifecycle.service.ts`.
 *
 * Duplicated deliberately, and advisory only. The server's 403 is the real gate;
 * this exists so the banner can warn before a write is refused rather than after.
 * If the two ever disagree the API wins, and `EMAIL_UNVERIFIED` coming back from
 * a write is surfaced on its own terms.
 */
export const VERIFICATION_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/** The last three days are when a warning starts being worth interrupting for. */
const URGENT_WITHIN_MS = 3 * 24 * 60 * 60 * 1000;

export type VerificationState = 'verified' | 'grace' | 'urgent' | 'expired';

/**
 * How much of the grace period is left, from the two fields `/auth/me` actually
 * returns: `emailVerified` and `createdAt`. Nothing here reads a field the
 * server does not send.
 */
export function verificationState(user: User | null, now = Date.now()): VerificationState {
  if (!user || user.emailVerified) return 'verified';

  const remaining = Date.parse(user.createdAt) + VERIFICATION_GRACE_MS - now;

  if (remaining <= 0) return 'expired';
  if (remaining <= URGENT_WITHIN_MS) return 'urgent';

  return 'grace';
}

/** Whole days left, rounded up, so "1 day left" never shows while hours remain. */
export function daysRemaining(user: User, now = Date.now()): number {
  const remaining = Date.parse(user.createdAt) + VERIFICATION_GRACE_MS - now;

  return Math.max(0, Math.ceil(remaining / (24 * 60 * 60 * 1000)));
}
