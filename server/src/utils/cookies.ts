import type { CookieOptions, Response } from 'express';
import { env, isProduction } from '@/config/env';
import { parseDuration } from '@/utils/duration';

export const REFRESH_COOKIE_NAME = 'refresh_token';

/**
 * Scoped to the auth routes so the refresh token is never attached to ordinary
 * API calls, which shrinks the surface for theft via a logging proxy or XSS.
 */
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

/** The two attributes that decide whether a browser will send the cookie at all. */
export interface CookieSitePolicy {
  sameSite: 'strict' | 'none';
  secure: boolean;
}

/**
 * Picks `SameSite` and `Secure` for the refresh cookie from the deployed topology.
 *
 * `SameSite=Strict` is the right answer only while the client and the API share a
 * site. DEPLOYMENT.md puts them on separate hosts — the client on Vercel, the API
 * on Render — and a browser omits a `Strict` cookie from every request a page on
 * another site initiates. `POST /auth/refresh` is exactly such a request, so the
 * cookie would never arrive: the silent refresh 401s, the interceptor hard-logs
 * the user out, and "refreshing the page keeps you logged in" is false in
 * production while remaining true in every test. `SameSite=None` is the only
 * value that travels, and a browser stores `None` only alongside `Secure`.
 *
 * Note that this is a *site* comparison, not an origin one, which is why the
 * end-to-end stack cannot catch it: `localhost:5174` and `localhost:5001` are
 * different origins — enough to have surfaced the missing
 * `Access-Control-Expose-Headers` in Phase 15 — but the same site, because a port
 * is not part of a site. Only a real two-domain deploy exercises this.
 *
 * The rule is deliberately conservative: it relaxes on differing hostnames, so
 * subdomain siblings get `None` where `Strict` would technically have worked, but
 * it never picks a value that silently drops the cookie. It also refuses to relax
 * over plain HTTP, where `Secure` would drop the cookie instead — a cross-site
 * cookie is impossible there under any setting, so the existing behaviour stands
 * and fails visibly rather than mysteriously.
 */
export function refreshCookieSitePolicy(
  clientOrigin: string,
  apiUrl: string,
  production: boolean,
): CookieSitePolicy {
  const crossSite = new URL(clientOrigin).hostname !== new URL(apiUrl).hostname;
  const secureTransport = production || new URL(apiUrl).protocol === 'https:';

  if (crossSite && secureTransport) return { sameSite: 'none', secure: true };

  return { sameSite: 'strict', secure: production };
}

function refreshCookieOptions(): CookieOptions {
  const { sameSite, secure } = refreshCookieSitePolicy(
    env.CLIENT_ORIGIN,
    env.API_URL,
    isProduction,
  );

  return {
    httpOnly: true,
    sameSite,
    secure,
    path: REFRESH_COOKIE_PATH,
    // Host-only unless an operator opted into sharing it across one parent
    // domain's subdomains. `undefined` omits the attribute entirely.
    ...(env.COOKIE_DOMAIN === undefined ? {} : { domain: env.COOKIE_DOMAIN }),
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
