import type { Types } from 'mongoose';
import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { PURGE_AFTER_MS } from '@/jobs/purgeDeletedUsersJob';
import { User, type UserDocument } from '@/models/User';
import { sendMail } from '@/services/mailer.service';
import { revokeAllForUser } from '@/services/token.service';
import { ApiError } from '@/utils/ApiError';
import {
  EMAIL_VERIFICATION_TTL_MS,
  PASSWORD_RESET_TTL_MS,
  hashSingleUseToken,
  issueSingleUseToken,
} from '@/utils/singleUseToken';

/** SPEC section 5: unverified accounts keep full access for this long. */
export const VERIFICATION_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_MINUTE = 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

function verificationLink(token: string): string {
  return `${env.APP_URL}/verify-email?token=${token}`;
}

function resetLink(token: string): string {
  return `${env.APP_URL}/reset-password?token=${token}`;
}

/**
 * Stamps a fresh verification token on the user and mails it. The plaintext
 * token exists only as a local and inside the message body; the document keeps
 * the digest.
 */
export function issueVerification(user: UserDocument, address: string): void {
  const { token, tokenHash, expiresAt } = issueSingleUseToken(EMAIL_VERIFICATION_TTL_MS);

  user.emailVerificationTokenHash = tokenHash;
  user.emailVerificationExpires = expiresAt;

  sendMail({
    to: address,
    message: {
      kind: 'verify_email',
      data: {
        name: user.name,
        verifyUrl: verificationLink(token),
        expiresInHours: EMAIL_VERIFICATION_TTL_MS / MS_PER_HOUR,
        // A pending address means this is an email change, not a new account, so
        // the message is a confirmation rather than a welcome.
        isNewAccount: !user.pendingEmail,
      },
    },
  });
}

/**
 * Confirms an address. A pending address takes over the account here rather than
 * at request time, which is what keeps the old address usable for login until
 * the new one is proven.
 */
export async function verifyEmail(token: string): Promise<UserDocument> {
  const user = await User.findOne({
    emailVerificationTokenHash: hashSingleUseToken(token),
  }).select('+emailVerificationTokenHash');

  if (!user) {
    throw ApiError.badRequest('That verification link is not valid', 'INVALID_TOKEN');
  }

  if (!user.emailVerificationExpires || user.emailVerificationExpires.getTime() <= Date.now()) {
    throw ApiError.badRequest('That verification link has expired', 'TOKEN_EXPIRED');
  }

  if (user.pendingEmail) {
    user.email = user.pendingEmail;
    user.pendingEmail = undefined;
  }

  user.emailVerified = true;
  user.emailVerificationTokenHash = undefined;
  user.emailVerificationExpires = undefined;
  await user.save();

  return user;
}

export async function resendVerification(userId: Types.ObjectId): Promise<void> {
  const user = await User.findOne({ _id: userId, deletedAt: null });

  if (!user) {
    throw ApiError.notFound('Account not found', 'USER_NOT_FOUND');
  }

  if (user.emailVerified && !user.pendingEmail) {
    throw ApiError.badRequest('That address is already confirmed', 'ALREADY_VERIFIED');
  }

  issueVerification(user, user.pendingEmail ?? user.email);
  await user.save();
}

/**
 * Issues a reset token when the address belongs to a live account, and does
 * nothing at all when it does not.
 *
 * The caller has already answered the request by the time this runs. That is
 * deliberate: it is the only part of the flow whose cost depends on whether the
 * account exists, so moving it behind the response removes the difference from
 * anything a client can measure. See `forgotPassword` in the controller.
 */
export async function startPasswordReset(email: string): Promise<void> {
  const user = await User.findOne({ email, deletedAt: null });

  if (!user) return;

  const { token, tokenHash, expiresAt } = issueSingleUseToken(PASSWORD_RESET_TTL_MS);

  user.passwordResetTokenHash = tokenHash;
  user.passwordResetExpires = expiresAt;
  await user.save();

  sendMail({
    to: user.email,
    message: {
      kind: 'password_reset',
      data: {
        name: user.name,
        resetUrl: resetLink(token),
        expiresInMinutes: PASSWORD_RESET_TTL_MS / MS_PER_MINUTE,
      },
    },
  });
}

/**
 * Consumes a reset token and takes every session with it, through the same
 * `revokeAllForUser` a password change uses. `passwordChangedAt` invalidates the
 * access tokens that were already minted, so nothing issued before the reset
 * survives it.
 */
export async function resetPassword(token: string, password: string): Promise<UserDocument> {
  const user = await User.findOne({
    passwordResetTokenHash: hashSingleUseToken(token),
  }).select('+passwordResetTokenHash +password');

  if (!user) {
    throw ApiError.badRequest('That reset link is not valid', 'INVALID_TOKEN');
  }

  if (!user.passwordResetExpires || user.passwordResetExpires.getTime() <= Date.now()) {
    throw ApiError.badRequest('That reset link has expired', 'TOKEN_EXPIRED');
  }

  user.password = password;
  user.passwordChangedAt = new Date();
  user.passwordResetTokenHash = undefined;
  user.passwordResetExpires = undefined;
  user.failedLoginAttempts = 0;
  user.lockedUntil = undefined;
  await user.save();

  await revokeAllForUser(user._id, 'password_reset');

  sendMail({
    to: user.email,
    message: { kind: 'password_changed', data: { name: user.name, via: 'reset' } },
  });

  return user;
}

/**
 * Soft deletes the account. The document stays for 30 days so the purge job can
 * remove it and its data together; `requireAuth` and `login` both already refuse
 * a user with `deletedAt` set, so access ends immediately.
 */
export async function deleteAccount(userId: Types.ObjectId, password: string): Promise<void> {
  const user = await User.findOne({ _id: userId, deletedAt: null }).select('+password');

  if (!user) {
    throw ApiError.notFound('Account not found', 'USER_NOT_FOUND');
  }

  if (!(await user.comparePassword(password))) {
    throw ApiError.unauthorized('Password is incorrect', 'INVALID_CREDENTIALS');
  }

  user.deletedAt = new Date();
  await user.save();

  await revokeAllForUser(user._id, 'account_deleted');

  sendMail({
    to: user.email,
    message: {
      kind: 'account_deleted',
      data: { name: user.name, purgeDays: PURGE_AFTER_MS / MS_PER_DAY },
    },
  });

  logger.info('Account soft deleted', { userId: user._id.toString() });
}
