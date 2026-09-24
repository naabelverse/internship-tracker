import { logger } from '@/config/logger';
import { PURGE_AFTER_MS } from '@/jobs/purgeDeletedUsersJob';
import { Reminder } from '@/models/Reminder';
import { User, type UserDocument } from '@/models/User';
import type { AuthResult } from '@/services/auth.service';
import { sendMail } from '@/services/mailer.service';
import { createSession, type SessionContext } from '@/services/token.service';
import { ApiError } from '@/utils/ApiError';
import { hashSingleUseToken, issueSingleUseToken } from '@/utils/singleUseToken';

/**
 * How long the restore prompt stays answerable after the password was checked.
 * Long enough to read the dialog, short enough that a token lifted from the
 * response is worth little.
 */
export const RESTORE_TOKEN_TTL_MS = 10 * 60 * 1000;

/** The instant the purge job may remove an account closed at `deletedAt`. */
export function purgeAtFor(deletedAt: Date): Date {
  return new Date(deletedAt.getTime() + PURGE_AFTER_MS);
}

/**
 * Restorable strictly before the purge instant. The purge job uses the same
 * boundary, so there is no moment at which an account is both restorable and
 * eligible for deletion.
 */
export function isWithinRestoreWindow(deletedAt: Date, now: Date): boolean {
  return purgeAtFor(deletedAt).getTime() > now.getTime();
}

function windowEnded(): ApiError {
  return new ApiError(
    410,
    'This account was closed more than 30 days ago and can no longer be restored.',
    'ACCOUNT_PURGED',
  );
}

/**
 * What a correct password on a closed account gets instead of a session.
 *
 * Only reached after the password has been verified, so the distinct answer
 * tells an attacker nothing that a successful sign-in would not: a wrong
 * password on a closed account still gets the ordinary 401. Inside the window
 * the answer carries a single-use token that `restoreAccount` exchanges for a
 * session; no session is created here. The user is always saved, because the
 * caller has just reset the failed-attempt counters on it.
 */
export async function answerClosedAccount(user: UserDocument, now: Date): Promise<ApiError> {
  const deletedAt = user.deletedAt as Date;

  if (!isWithinRestoreWindow(deletedAt, now)) {
    user.restoreTokenHash = undefined;
    user.restoreTokenExpires = undefined;
    await user.save();
    return windowEnded();
  }

  const { token, tokenHash, expiresAt } = issueSingleUseToken(RESTORE_TOKEN_TTL_MS);
  user.restoreTokenHash = tokenHash;
  user.restoreTokenExpires = expiresAt;
  await user.save();

  return ApiError.conflict(
    'This account is closed and scheduled for deletion.',
    'ACCOUNT_PENDING_DELETION',
    { purgeAt: purgeAtFor(deletedAt).toISOString(), restoreToken: token },
  );
}

/**
 * Explains a restore token that could not be claimed, clearing it so it cannot
 * be tried again. Only runs on the failure path; a good token never gets here.
 */
async function rejectRestore(tokenHash: string, now: Date): Promise<ApiError> {
  const user = await User.findOne({ restoreTokenHash: tokenHash }).select('+restoreTokenHash');

  if (!user?.deletedAt) {
    return ApiError.badRequest(
      'This restore request is not valid. Sign in again to restore the account.',
      'INVALID_TOKEN',
    );
  }

  const expired = !user.restoreTokenExpires || user.restoreTokenExpires.getTime() <= now.getTime();
  user.restoreTokenHash = undefined;
  user.restoreTokenExpires = undefined;
  await user.save();

  if (!isWithinRestoreWindow(user.deletedAt, now)) return windowEnded();

  return expired
    ? ApiError.badRequest(
        'This restore request has expired. Sign in again to restore the account.',
        'TOKEN_EXPIRED',
      )
    : ApiError.badRequest(
        'This restore request is not valid. Sign in again to restore the account.',
        'INVALID_TOKEN',
      );
}

/**
 * Reopens a closed account and signs it in.
 *
 * The claim is one conditional update: the token, its expiry and the 30 day
 * window are all checked by the same write that clears them, so two requests
 * racing with one token cannot both succeed. Nothing else about the account was
 * changed when it closed, so clearing `deletedAt` is the whole reversal.
 *
 * Sessions revoked at closure stay revoked; only the one created here is live.
 * Reminders that came due while the account was closed are marked sent rather
 * than delivered, so the next digest is not a backlog of dates already past.
 */
export async function restoreAccount(
  token: string,
  context: SessionContext,
  now: Date = new Date(),
): Promise<AuthResult> {
  const tokenHash = hashSingleUseToken(token);

  const claimed = await User.findOneAndUpdate(
    {
      restoreTokenHash: tokenHash,
      restoreTokenExpires: { $gt: now },
      deletedAt: { $ne: null, $gt: new Date(now.getTime() - PURGE_AFTER_MS) },
    },
    {
      $unset: { deletedAt: 1, restoreTokenHash: 1, restoreTokenExpires: 1 },
      $set: { lastLoginAt: now },
    },
    // The document as it was, because the closure time is what bounds the
    // reminders to skip.
    { new: false },
  );

  if (!claimed?.deletedAt) throw await rejectRestore(tokenHash, now);

  const closedAt = claimed.deletedAt;
  const user = (await User.findById(claimed._id)) as UserDocument;

  const skipped = await Reminder.updateMany(
    { user: user._id, sent: false, dueAt: { $gte: closedAt, $lte: now } },
    { $set: { sent: true } },
  );

  const session = await createSession(user._id, context);

  sendMail({ to: user.email, message: { kind: 'account_restored', data: { name: user.name } } });

  logger.info('Account restored', {
    userId: user._id.toString(),
    skippedReminders: skipped.modifiedCount,
  });

  return { user, session };
}
