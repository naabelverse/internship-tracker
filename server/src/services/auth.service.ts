import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { Types } from 'mongoose';
import {
  ACCOUNT_LOCK_MS,
  BCRYPT_ROUNDS,
  MAX_FAILED_LOGIN_ATTEMPTS,
  User,
  type UserDocument,
} from '@/models/User';
import type {
  ChangePasswordInput,
  LoginInput,
  RegisterInput,
  UpdateMeInput,
} from '@/schemas/auth.schema';
import { issueVerification } from '@/services/accountLifecycle.service';
import { findDemoAccount } from '@/services/demoAccount.service';
import { sendMail } from '@/services/mailer.service';
import { assertHumanSignup } from '@/services/signupGuard.service';
import {
  createSession,
  revokeAllForUser,
  revokeToken,
  type IssuedSession,
  type SessionContext,
} from '@/services/token.service';
import { ApiError } from '@/utils/ApiError';

export interface AuthResult {
  user: UserDocument;
  session: IssuedSession;
}

let dummyPasswordHash: string | undefined;

/**
 * A throwaway hash compared against when no account matches, so a missing email
 * costs the same time as a wrong password and cannot be probed for enumeration.
 * Built on first miss rather than at import so boot stays fast.
 */
function getDummyPasswordHash(): string {
  dummyPasswordHash ??= bcrypt.hashSync(randomBytes(16).toString('hex'), BCRYPT_ROUNDS);
  return dummyPasswordHash;
}

export async function register(input: RegisterInput, context: SessionContext): Promise<AuthResult> {
  // Before the existence check, so a rejected signup costs one synchronous pass
  // and never touches the database or the mail queue.
  assertHumanSignup(input);

  const existing = await User.findOne({ email: input.email });

  if (existing) {
    throw ApiError.conflict('An account with that email already exists', 'EMAIL_IN_USE');
  }

  const user = new User({
    name: input.name,
    email: input.email,
    password: input.password,
    timezone: input.timezone ?? 'UTC',
    acceptedTermsAt: new Date(),
    lastLoginAt: new Date(),
  });

  issueVerification(user, user.email);
  await user.save();

  const session = await createSession(user._id, context);

  return { user, session };
}

export async function login(input: LoginInput, context: SessionContext): Promise<AuthResult> {
  const user = await User.findOne({ email: input.email, deletedAt: null }).select('+password');

  if (!user) {
    await bcrypt.compare(input.password, getDummyPasswordHash());
    throw ApiError.unauthorized('Email or password is incorrect', 'INVALID_CREDENTIALS');
  }

  const now = new Date();

  if (user.lockedUntil && user.lockedUntil.getTime() > now.getTime()) {
    throw new ApiError(
      423,
      'Too many failed attempts. This account is temporarily locked, try again later.',
      'ACCOUNT_LOCKED',
      { lockedUntil: user.lockedUntil.toISOString() },
    );
  }

  if (!(await user.comparePassword(input.password))) {
    user.failedLoginAttempts += 1;

    if (user.failedLoginAttempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
      user.lockedUntil = new Date(now.getTime() + ACCOUNT_LOCK_MS);
    }

    await user.save();
    throw ApiError.unauthorized('Email or password is incorrect', 'INVALID_CREDENTIALS');
  }

  user.failedLoginAttempts = 0;
  user.lockedUntil = undefined;
  user.lastLoginAt = now;
  await user.save();

  const session = await createSession(user._id, context);

  return { user, session };
}

/**
 * Signs a visitor into the shared demo account, for SPEC section 12's
 * "Try the demo" button.
 *
 * Three properties make this safe to expose unauthenticated, and all three are
 * structural rather than checks somebody could forget:
 *
 * 1. It takes no input. There is no parameter for a caller to point at another
 *    account — the identity comes from `env.DEMO_EMAIL`, a server-side value.
 * 2. It only ever *finds*. No branch here constructs a `User`, so it cannot mint
 *    accounts or bypass registration; an unseeded deployment gets a 404 rather
 *    than a helpfully created account.
 * 3. `isDemo: true` is part of the query (see `findDemoAccount`), so somebody who
 *    registered the demo address before it was seeded cannot be logged into
 *    through this route.
 *
 * Escalation is closed off separately by `rejectDemoAccount`, which refuses the
 * password change, the email change and the deletion — so a demo session cannot
 * be turned into an account of one's own.
 */
export async function loginAsDemo(context: SessionContext): Promise<AuthResult> {
  const user = await findDemoAccount();

  if (!user) {
    throw ApiError.notFound(
      'The demo account is not available on this deployment.',
      'DEMO_UNAVAILABLE',
    );
  }

  user.lastLoginAt = new Date();
  await user.save();

  const session = await createSession(user._id, context);

  return { user, session };
}

export async function logout(rawRefreshToken: string | undefined): Promise<void> {
  if (rawRefreshToken) {
    await revokeToken(rawRefreshToken, 'logout');
  }
}

export async function logoutAll(userId: Types.ObjectId): Promise<number> {
  return revokeAllForUser(userId, 'logout_all');
}

export async function getMe(userId: Types.ObjectId): Promise<UserDocument> {
  const user = await User.findOne({ _id: userId, deletedAt: null });

  if (!user) {
    throw ApiError.notFound('Account not found', 'USER_NOT_FOUND');
  }

  return user;
}

/**
 * Applies a profile patch. A new email address is the one field that does not
 * take effect here: it is parked on `pendingEmail` and confirmed through the
 * ordinary verification flow, so the address the user can still log in with
 * stays the one they have already proven.
 */
export async function updateMe(
  userId: Types.ObjectId,
  input: UpdateMeInput,
): Promise<UserDocument> {
  const { email, ...profile } = input;

  const user = await User.findOne({ _id: userId, deletedAt: null });

  if (!user) {
    throw ApiError.notFound('Account not found', 'USER_NOT_FOUND');
  }

  if (email !== undefined && email !== user.email) {
    const taken = await User.findOne({ _id: { $ne: user._id }, email });

    if (taken) {
      throw ApiError.conflict('An account with that email already exists', 'EMAIL_IN_USE');
    }

    user.pendingEmail = email;
    issueVerification(user, email);
  }

  user.set(profile);
  await user.save();

  return user;
}

/**
 * Changes the password, invalidates every access token issued beforehand via
 * `passwordChangedAt`, revokes every refresh token, and hands the caller a fresh
 * session so the device that made the change stays signed in.
 */
export async function changePassword(
  userId: Types.ObjectId,
  input: ChangePasswordInput,
  context: SessionContext,
): Promise<AuthResult> {
  const user = await User.findOne({ _id: userId, deletedAt: null }).select('+password');

  if (!user) {
    throw ApiError.notFound('Account not found', 'USER_NOT_FOUND');
  }

  if (!(await user.comparePassword(input.currentPassword))) {
    throw ApiError.unauthorized('Current password is incorrect', 'INVALID_CREDENTIALS');
  }

  user.password = input.newPassword;
  user.passwordChangedAt = new Date();
  await user.save();

  await revokeAllForUser(user._id, 'password_changed');

  // Phase 11 sent this only after a reset, which left the deliberate change —
  // the one an attacker holding a live session would make — entirely silent.
  sendMail({
    to: user.email,
    message: { kind: 'password_changed', data: { name: user.name, via: 'settings' } },
  });

  const session = await createSession(user._id, context);

  return { user, session };
}
