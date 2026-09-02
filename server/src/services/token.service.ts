import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { type Types } from 'mongoose';
import { env } from '@/config/env';
import { RefreshToken, type RefreshTokenDocument, type RevokedReason } from '@/models/RefreshToken';
import { ApiError } from '@/utils/ApiError';
import { parseDuration, parseDurationSeconds } from '@/utils/duration';

const TOKEN_ISSUER = 'internship-tracker';
const ACCESS_TOKEN_TYPE = 'access';

/**
 * How long after a rotation a second presentation of the old token is treated as
 * a benign concurrent duplicate rather than replay. Two requests that race with
 * the same cookie must not cost the user every session; a replay minutes later
 * still trips reuse detection.
 */
export const REFRESH_REUSE_GRACE_MS = 10_000;

export interface AccessTokenPayload {
  sub: string;
  iat: number;
  exp: number;
  /**
   * Issue time in milliseconds. The standard `iat` claim is whole seconds, which
   * leaves a window where a token minted in the same second as a password change
   * survives it. This claim closes that window.
   */
  iatMs: number;
}

export interface SessionContext {
  userAgent?: string;
  ip?: string;
}

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export function signAccessToken(userId: string): string {
  return jwt.sign(
    { sub: userId, type: ACCESS_TOKEN_TYPE, iatMs: Date.now() },
    env.JWT_ACCESS_SECRET,
    { expiresIn: parseDurationSeconds(env.ACCESS_TOKEN_TTL), issuer: TOKEN_ISSUER },
  );
}

/** Verifies signature, issuer and token type. Throws the raw jsonwebtoken error for the caller to map. */
export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer: TOKEN_ISSUER });

  if (
    typeof decoded === 'string' ||
    decoded.type !== ACCESS_TOKEN_TYPE ||
    typeof decoded.sub !== 'string' ||
    typeof decoded.iat !== 'number' ||
    typeof decoded.exp !== 'number' ||
    typeof decoded.iatMs !== 'number'
  ) {
    throw ApiError.unauthorized('Access token is malformed', 'INVALID_ACCESS_TOKEN');
  }

  return { sub: decoded.sub, iat: decoded.iat, exp: decoded.exp, iatMs: decoded.iatMs };
}

/** Opaque, high-entropy refresh token. Never a JWT: it must be revocable server-side. */
function generateRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}

/**
 * HMAC rather than a bare SHA-256 so a leaked database alone cannot be used to
 * match stolen cookies: an attacker also needs JWT_REFRESH_SECRET.
 */
export function hashRefreshToken(token: string): string {
  return createHmac('sha256', env.JWT_REFRESH_SECRET).update(token).digest('hex');
}

async function persistRefreshToken(
  userId: Types.ObjectId,
  family: string,
  context: SessionContext,
): Promise<{ token: string; document: RefreshTokenDocument }> {
  const token = generateRefreshToken();
  const expiresAt = new Date(Date.now() + parseDuration(env.REFRESH_TOKEN_TTL));

  const document = await RefreshToken.create({
    user: userId,
    family,
    tokenHash: hashRefreshToken(token),
    expiresAt,
    userAgent: context.userAgent,
    ip: context.ip,
  });

  return { token, document };
}

/** Starts a brand new token family. Used by register, login and password change. */
export async function createSession(
  userId: Types.ObjectId,
  context: SessionContext,
): Promise<IssuedSession> {
  const { token, document } = await persistRefreshToken(userId, randomUUID(), context);

  return {
    accessToken: signAccessToken(userId.toString()),
    refreshToken: token,
    expiresAt: document.expiresAt,
  };
}

/**
 * Decides what a failed claim means. Reached only when the atomic claim matched
 * nothing, so the token is missing, expired, or already revoked.
 */
async function rejectFailedClaim(tokenHash: string, now: Date): Promise<never> {
  const existing = await RefreshToken.findOne({ tokenHash });

  if (!existing) {
    throw ApiError.unauthorized('Refresh token is not valid', 'INVALID_REFRESH_TOKEN');
  }

  if (existing.expiresAt.getTime() <= now.getTime()) {
    throw ApiError.unauthorized('Refresh token has expired', 'REFRESH_TOKEN_EXPIRED');
  }

  const revokedAt = existing.revokedAt ?? now;
  const wasRotated = existing.revokedReason === 'rotated';
  const withinGrace = now.getTime() - revokedAt.getTime() <= REFRESH_REUSE_GRACE_MS;

  if (wasRotated && withinGrace) {
    // Two requests raced with the same cookie. One of them rotated it; rejecting
    // this one is correct, revoking the user's whole family would not be.
    throw ApiError.unauthorized(
      'Refresh token was already rotated by a concurrent request',
      'REFRESH_TOKEN_RACE',
    );
  }

  await revokeFamily(existing.user, existing.family, 'reuse_detected');

  throw ApiError.unauthorized(
    'Refresh token reuse detected. All sessions have been revoked, please sign in again.',
    'REFRESH_TOKEN_REUSED',
  );
}

export interface RotationResult extends IssuedSession {
  userId: Types.ObjectId;
}

/**
 * Rotates a refresh token. The conditional `findOneAndUpdate` is the whole
 * concurrency story: MongoDB applies it atomically to a single document, so of
 * N simultaneous requests carrying the same token exactly one claims it and the
 * rest fall through to `rejectFailedClaim`.
 */
export async function rotateSession(
  rawToken: string,
  context: SessionContext,
): Promise<RotationResult> {
  const tokenHash = hashRefreshToken(rawToken);
  const now = new Date();

  const claimed = await RefreshToken.findOneAndUpdate(
    { tokenHash, revokedAt: null, expiresAt: { $gt: now } },
    { $set: { revokedAt: now, revokedReason: 'rotated', lastUsedAt: now } },
    { new: true },
  );

  if (!claimed) {
    return rejectFailedClaim(tokenHash, now);
  }

  const { token, document } = await persistRefreshToken(claimed.user, claimed.family, context);

  claimed.replacedBy = document._id;
  await claimed.save();

  return {
    userId: claimed.user,
    accessToken: signAccessToken(claimed.user.toString()),
    refreshToken: token,
    expiresAt: document.expiresAt,
  };
}

/** Revokes one live token. Returns false when it was already revoked or unknown. */
export async function revokeToken(rawToken: string, reason: RevokedReason): Promise<boolean> {
  const result = await RefreshToken.updateOne(
    { tokenHash: hashRefreshToken(rawToken), revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: reason } },
  );

  return result.modifiedCount > 0;
}

/** One indexed write that kills every live token descended from a single login. */
export async function revokeFamily(
  userId: Types.ObjectId,
  family: string,
  reason: RevokedReason,
): Promise<number> {
  const result = await RefreshToken.updateMany(
    { user: userId, family, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: reason } },
  );

  return result.modifiedCount;
}

export async function revokeAllForUser(
  userId: Types.ObjectId,
  reason: RevokedReason,
): Promise<number> {
  const result = await RefreshToken.updateMany(
    { user: userId, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: reason } },
  );

  return result.modifiedCount;
}
