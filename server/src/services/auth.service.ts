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
  const existing = await User.findOne({ email: input.email });

  if (existing) {
    throw ApiError.conflict('An account with that email already exists', 'EMAIL_IN_USE');
  }

  const user = await User.create({
    name: input.name,
    email: input.email,
    password: input.password,
    timezone: input.timezone ?? 'UTC',
    acceptedTermsAt: new Date(),
    lastLoginAt: new Date(),
  });

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

export async function updateMe(
  userId: Types.ObjectId,
  input: UpdateMeInput,
): Promise<UserDocument> {
  const user = await User.findOneAndUpdate(
    { _id: userId, deletedAt: null },
    { $set: input },
    { new: true, runValidators: true },
  );

  if (!user) {
    throw ApiError.notFound('Account not found', 'USER_NOT_FOUND');
  }

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

  const session = await createSession(user._id, context);

  return { user, session };
}
