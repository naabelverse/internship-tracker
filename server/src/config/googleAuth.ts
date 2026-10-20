import { randomBytes } from 'node:crypto';
import type { CookieOptions, Request, Response } from 'express';
import passport from 'passport';
import { Strategy as GoogleStrategy, type Profile } from 'passport-google-oauth20';
import type { StateStore } from 'passport-oauth2';
import { z } from 'zod';
import { env, isProduction } from '@/config/env';
import {
  GOOGLE_INTENTS,
  type GoogleIdentity,
  type GoogleSignInRequest,
} from '@/services/googleAuth.service';

export const GOOGLE_STRATEGY = 'google';

/** Both credentials are present; `envSchemaWithGoogle` refuses exactly one. */
export const googleAuthEnabled = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

const STATE_COOKIE_NAME = 'google_oauth_state';
/** Covers the start route that sets it and the callback that reads it, and nothing else. */
const STATE_COOKIE_PATH = '/api/v1/auth/google';
/** Long enough to pick an account and consent, short enough that a stale tab cannot finish. */
const STATE_TTL_MS = 10 * 60 * 1000;

const storedStateSchema = z.object({
  handle: z.string().min(1),
  verifier: z.string().min(1),
  request: z.object({
    intent: z.enum(GOOGLE_INTENTS),
    timezone: z.string().optional(),
  }),
});

/**
 * `Lax`, not the refresh cookie's `None`: Google returns the browser to the
 * callback with a top-level GET, which is exactly what `Lax` still sends, and a
 * cookie no cross-site subrequest can carry is the safer default.
 */
function stateCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction || new URL(env.API_URL).protocol === 'https:',
    path: STATE_COOKIE_PATH,
  };
}

/** Single use: the callback clears it whatever the outcome, cancelled sign-ins included. */
export function clearGoogleStateCookie(res: Response): void {
  res.clearCookie(STATE_COOKIE_NAME, stateCookieOptions());
}

function readStoredState(req: Request): z.infer<typeof storedStateSchema> | undefined {
  const raw = (req.cookies as Record<string, unknown> | undefined)?.[STATE_COOKIE_NAME];
  if (typeof raw !== 'string') return undefined;

  try {
    const parsed = storedStateSchema.safeParse(
      JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')),
    );
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Keeps the OAuth `state` handle and the PKCE verifier in a short-lived httpOnly
 * cookie, so the API stays stateless and needs no `express-session`.
 *
 * The handle sent to Google must come back matching the cookie, which ties the
 * callback to the browser that started the flow: a callback URL planted in
 * someone else's browser carries a handle their cookie does not hold, so a
 * login-CSRF into the planter's account fails here. The cookie needs no
 * signature for that, because forging one only lets a browser attack itself.
 *
 * The method arities are load-bearing: passport-oauth2 picks the PKCE calling
 * convention by `store.length === 5` and `verify.length === 3`.
 */
class CookieStateStore {
  store(
    req: Request,
    verifier: string,
    request: GoogleSignInRequest,
    _meta: unknown,
    callback: (error: Error | null, handle?: string) => void,
  ): void {
    const handle = randomBytes(24).toString('base64url');
    const value = Buffer.from(JSON.stringify({ handle, verifier, request })).toString('base64url');

    req.res?.cookie(STATE_COOKIE_NAME, value, { ...stateCookieOptions(), maxAge: STATE_TTL_MS });
    callback(null, handle);
  }

  verify(
    req: Request,
    providedHandle: string,
    callback: (error: Error | null, verifier: string | false, request?: unknown) => void,
  ): void {
    const stored = readStoredState(req);

    if (!stored || stored.handle !== providedHandle) {
      callback(null, false, { message: 'The Google sign-in state did not match.' });
      return;
    }

    callback(null, stored.verifier, stored.request);
  }
}

function toIdentity(profile: Profile): GoogleIdentity {
  const primary = profile.emails?.[0];

  return {
    googleId: profile.id,
    email: primary?.value ?? '',
    emailVerified: primary?.verified === true,
    name: profile.displayName,
  };
}

if (googleAuthEnabled) {
  passport.use(
    GOOGLE_STRATEGY,
    new GoogleStrategy(
      {
        clientID: env.GOOGLE_CLIENT_ID ?? '',
        clientSecret: env.GOOGLE_CLIENT_SECRET ?? '',
        callbackURL: `${env.API_URL}${STATE_COOKIE_PATH}/callback`,
        scope: ['openid', 'email', 'profile'],
        state: true,
        pkce: true,
        // The typings only describe the pre-PKCE store signatures; see CookieStateStore.
        store: new CookieStateStore() as unknown as StateStore,
      },
      // Google's own tokens are not kept: the app issues its own session, and
      // asks Google for nothing after sign-in. Passport types its user slot as
      // the account document app-wide; here it carries the identity the
      // callback turns into an account, and `finishGoogleSignIn` reads it so.
      (_accessToken, _refreshToken, profile, done) => {
        done(null, toIdentity(profile) as unknown as Express.User);
      },
    ),
  );
}

export { passport };
