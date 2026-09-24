import { format, parseISO } from 'date-fns';
import { getApiError } from '@/api/errors';

/** What a correct password on a closed account gets back from login instead of a session. */
export interface PendingDeletion {
  /** The end of the restore window, as an ISO instant. */
  purgeAt: string;
  /** Single use, valid for 10 minutes, exchanged at POST /auth/restore. */
  restoreToken: string;
}

/**
 * The restore prompt carried by a login failure, or null for any other failure.
 * The server only sends it after the password was verified, so its presence is
 * the whole signal: there is no "maybe closed" state to guess at.
 */
export function readPendingDeletion(error: unknown): PendingDeletion | null {
  const body = getApiError(error);
  if (body?.code !== 'ACCOUNT_PENDING_DELETION') return null;

  const details = body.errors as Partial<PendingDeletion> | undefined;
  if (typeof details?.purgeAt !== 'string' || typeof details.restoreToken !== 'string') {
    return null;
  }

  return { purgeAt: details.purgeAt, restoreToken: details.restoreToken };
}

/** The purge date as a person reads a deadline, e.g. "24 October 2026", on their own clock. */
export function formatPurgeDate(purgeAt: string): string {
  return format(parseISO(purgeAt), 'd MMMM yyyy');
}
