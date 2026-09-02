import type { Request, RequestHandler } from 'express';
import { TokenExpiredError } from 'jsonwebtoken';
import { Types } from 'mongoose';
import { User, type UserDocument } from '@/models/User';
import { verifyAccessToken, type AccessTokenPayload } from '@/services/token.service';
import { ApiError } from '@/utils/ApiError';
import { asyncHandler } from '@/utils/asyncHandler';

const BEARER_PREFIX = 'Bearer ';

function readAccessToken(token: string): AccessTokenPayload {
  try {
    return verifyAccessToken(token);
  } catch (error) {
    if (error instanceof ApiError) throw error;

    if (error instanceof TokenExpiredError) {
      throw ApiError.unauthorized('Access token has expired', 'ACCESS_TOKEN_EXPIRED');
    }

    throw ApiError.unauthorized('Access token is not valid', 'INVALID_ACCESS_TOKEN');
  }
}

/**
 * A token minted before the last password change is dead, even though its
 * signature is still valid and it has not expired. Compared in milliseconds so
 * a change in the same second as the token still invalidates it.
 */
function issuedBeforePasswordChange(user: UserDocument, issuedAtMs: number): boolean {
  if (!user.passwordChangedAt) return false;

  return user.passwordChangedAt.getTime() > issuedAtMs;
}

export const requireAuth: RequestHandler = asyncHandler(async (req, _res, next) => {
  const header = req.get('authorization');

  if (header === undefined || !header.startsWith(BEARER_PREFIX)) {
    throw ApiError.unauthorized('Authentication required', 'UNAUTHENTICATED');
  }

  const payload = readAccessToken(header.slice(BEARER_PREFIX.length).trim());

  if (!Types.ObjectId.isValid(payload.sub)) {
    throw ApiError.unauthorized('Access token is not valid', 'INVALID_ACCESS_TOKEN');
  }

  const user = await User.findOne({ _id: payload.sub, deletedAt: null });

  if (!user) {
    throw ApiError.unauthorized('Account no longer exists', 'UNAUTHENTICATED');
  }

  if (issuedBeforePasswordChange(user, payload.iatMs)) {
    throw ApiError.unauthorized(
      'Session ended because the password was changed',
      'TOKEN_INVALIDATED',
    );
  }

  req.user = user;
  next();
});

/**
 * Reads the user attached by `requireAuth`. Exists so protected controllers get a
 * non-optional document without a non-null assertion.
 */
export function getAuthenticatedUser(req: Request): UserDocument {
  if (!req.user) {
    throw ApiError.unauthorized('Authentication required', 'UNAUTHENTICATED');
  }

  return req.user;
}
