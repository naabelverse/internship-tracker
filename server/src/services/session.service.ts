import type { Types } from 'mongoose';
import { RefreshToken } from '@/models/RefreshToken';
import { hashRefreshToken } from '@/services/token.service';
import { ApiError } from '@/utils/ApiError';

export interface SessionSummary {
  id: string;
  userAgent?: string;
  ip?: string;
  lastUsedAt?: Date;
  createdAt: Date;
  expiresAt: Date;
  /** True for the token the request itself arrived with. */
  current: boolean;
}

/**
 * The signed in devices, read straight off the refresh tokens Phase 2 already
 * keeps. There is deliberately no second notion of a session: "active" here means
 * exactly what it means to `rotateSession`, a token that is unrevoked and unexpired.
 */
export async function listSessions(
  userId: Types.ObjectId,
  currentRawToken: string | undefined,
): Promise<SessionSummary[]> {
  const currentHash = currentRawToken ? hashRefreshToken(currentRawToken) : undefined;

  const tokens = await RefreshToken.find({
    user: userId,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  }).sort({ createdAt: -1 });

  return tokens.map((token) => ({
    id: token._id.toString(),
    userAgent: token.userAgent,
    ip: token.ip,
    lastUsedAt: token.lastUsedAt,
    createdAt: token.createdAt,
    expiresAt: token.expiresAt,
    current: currentHash !== undefined && token.tokenHash === currentHash,
  }));
}

/**
 * Revokes one session and only that one.
 *
 * Scoped by `user` as well as `_id`, so another account's session id is reported
 * as not found rather than forbidden - the same rule the applications layer
 * follows, and the reason a session id cannot be probed for existence.
 */
export async function revokeSession(userId: Types.ObjectId, sessionId: string): Promise<void> {
  const revoked = await RefreshToken.findOneAndUpdate(
    { _id: sessionId, user: userId, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: 'session_revoked' } },
  );

  if (!revoked) {
    throw ApiError.notFound('Session not found', 'SESSION_NOT_FOUND');
  }
}
