import type { CookieOptions, Response } from 'express';
import { env, isProduction } from '@/config/env';
import { parseDuration } from '@/utils/duration';

export const REFRESH_COOKIE_NAME = 'refresh_token';

/**
 * Scoped to the auth routes so the refresh token is never attached to ordinary
 * API calls, which shrinks the surface for theft via a logging proxy or XSS.
 */
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

function refreshCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: isProduction,
    path: REFRESH_COOKIE_PATH,
  };
}

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    ...refreshCookieOptions(),
    maxAge: parseDuration(env.REFRESH_TOKEN_TTL),
  });
}

/** Must use the same name, path and flags as `setRefreshCookie` or the browser keeps the cookie. */
export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions());
}
