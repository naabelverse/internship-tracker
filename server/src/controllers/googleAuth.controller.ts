import type { RequestHandler, Response } from 'express';
import { env } from '@/config/env';
import {
  GOOGLE_STRATEGY,
  clearGoogleStateCookie,
  googleAuthEnabled,
  passport,
} from '@/config/googleAuth';
import { logger } from '@/config/logger';
import { sessionContext } from '@/controllers/auth.controller';
import {
  signInWithGoogle,
  type GoogleIdentity,
  type GoogleIntent,
  type GoogleSignInRequest,
} from '@/services/googleAuth.service';
import { setRefreshCookie } from '@/utils/cookies';

/**
 * Both routes are browser navigations, not API calls, so every answer is a
 * redirect into the client: a JSON error envelope would be a blank page of JSON
 * to the person who clicked "Continue with Google". The client reads `?oauth=`
 * and shows the matching message beside the form the visitor came from.
 */
function redirectWithError(res: Response, intent: GoogleIntent, code: string): void {
  const target = new URL(intent === 'register' ? '/register' : '/login', env.APP_URL);
  target.searchParams.set('oauth', code);
  res.redirect(target.toString());
}

/** Sends the visitor to Google. The query is validated by the route. */
export const startGoogleSignIn: RequestHandler = (req, res, next) => {
  const request = req.query as unknown as GoogleSignInRequest;

  if (!googleAuthEnabled) {
    redirectWithError(res, request.intent, 'GOOGLE_UNAVAILABLE');
    return;
  }

  // `state` as an object is what passport-oauth2 hands to the store; the
  // typings only know the legacy string form.
  passport.authenticate(GOOGLE_STRATEGY, {
    session: false,
    state: request as unknown as string,
  })(req, res, next);
};

interface GoogleCallbackInfo {
  state?: GoogleSignInRequest;
  message?: string;
}

/**
 * Where Google returns the browser. On success the refresh cookie is set and the
 * visitor lands on the dashboard, whose ordinary cold-start refresh turns that
 * cookie into a session; no token ever travels in a URL.
 */
export const finishGoogleSignIn: RequestHandler = (req, res, next) => {
  clearGoogleStateCookie(res);

  if (!googleAuthEnabled) {
    redirectWithError(res, 'login', 'GOOGLE_UNAVAILABLE');
    return;
  }

  passport.authenticate(
    GOOGLE_STRATEGY,
    { session: false },
    (error: unknown, identity: GoogleIdentity | false, info?: GoogleCallbackInfo) => {
      const request = info?.state;

      if (error || !identity || !request) {
        const cancelled = req.query.error === 'access_denied';
        logger.warn('Google sign-in did not complete', {
          reason: error instanceof Error ? error.message : (info?.message ?? 'no identity'),
          cancelled,
        });
        redirectWithError(res, 'login', cancelled ? 'GOOGLE_CANCELLED' : 'GOOGLE_FAILED');
        return;
      }

      signInWithGoogle(identity, request, sessionContext(req)).then((outcome) => {
        if (!outcome.ok) {
          redirectWithError(res, request.intent, outcome.code);
          return;
        }

        setRefreshCookie(res, outcome.session.refreshToken);
        res.redirect(new URL('/dashboard', env.APP_URL).toString());
      }, next);
    },
  )(req, res, next);
};
