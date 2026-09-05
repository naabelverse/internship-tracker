import type { Request } from 'express';
import rateLimit, { MemoryStore, type Options } from 'express-rate-limit';
import { isTest } from '@/config/env';
import { ApiError } from '@/utils/ApiError';

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

/** SPEC section 5: 5 attempts / 15 min on the credential endpoints. */
export const AUTH_ATTEMPT_LIMIT = 5;

/**
 * Builds a limiter that reports exhaustion through the central error handler,
 * so a throttled client gets the same error envelope as every other failure.
 */
export function createRateLimiter(options: Partial<Options> & { limit: number }) {
  return rateLimit({
    windowMs: FIFTEEN_MINUTES_MS,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => isTest,
    handler: (_req, _res, next) => {
      next(ApiError.tooManyRequests('Too many requests, please try again later.'));
    },
    ...options,
  });
}

/** Blanket limit for the whole API (SPEC section 7): 200 requests / 15 minutes. */
export const globalRateLimiter = createRateLimiter({ limit: 200 });

const authStores: MemoryStore[] = [];

/**
 * Auth limiters are deliberately active during tests, because "5 attempts then
 * 429" is behaviour worth proving. Each keeps its own store so a suite can wipe
 * the counters between cases.
 */
function createAuthLimiter(code: string, message: string, extra: Partial<Options> = {}) {
  const store = new MemoryStore();
  authStores.push(store);

  return rateLimit({
    windowMs: FIFTEEN_MINUTES_MS,
    limit: AUTH_ATTEMPT_LIMIT,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    store,
    handler: (_req, _res, next) => {
      next(ApiError.tooManyRequests(message, code));
    },
    ...extra,
  });
}

/** Normalised so `Ada@Example.COM ` and `ada@example.com` share one counter. */
function emailKey(req: Request): string {
  const body: unknown = req.body;
  const email = (body as { email?: unknown } | undefined)?.email;

  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

const emailLimiterExtras: Partial<Options> = {
  keyGenerator: emailKey,
  // Without an email there is nothing to key on; the IP limiter still applies.
  skip: (req) => emailKey(req).length === 0,
};

export const loginIpLimiter = createAuthLimiter(
  'RATE_LIMITED_IP',
  'Too many sign-in attempts from this network. Try again in 15 minutes.',
);

export const loginEmailLimiter = createAuthLimiter(
  'RATE_LIMITED_EMAIL',
  'Too many sign-in attempts for this account. Try again in 15 minutes.',
  emailLimiterExtras,
);

export const registerIpLimiter = createAuthLimiter(
  'RATE_LIMITED_IP',
  'Too many sign-up attempts from this network. Try again in 15 minutes.',
);

export const registerEmailLimiter = createAuthLimiter(
  'RATE_LIMITED_EMAIL',
  'Too many sign-up attempts for this email. Try again in 15 minutes.',
  emailLimiterExtras,
);

export const forgotPasswordIpLimiter = createAuthLimiter(
  'RATE_LIMITED_IP',
  'Too many reset requests from this network. Try again in 15 minutes.',
);

export const forgotPasswordEmailLimiter = createAuthLimiter(
  'RATE_LIMITED_EMAIL',
  'Too many reset requests for this account. Try again in 15 minutes.',
  emailLimiterExtras,
);

export const resetPasswordIpLimiter = createAuthLimiter(
  'RATE_LIMITED_IP',
  'Too many reset attempts from this network. Try again in 15 minutes.',
);

/**
 * "Try the demo" needs no credential, so it is the one sign-in route where an
 * attempt costs the caller nothing at all. Keyed by IP and capped like the
 * others, so it cannot be used to mint refresh tokens in bulk.
 */
export const demoLoginIpLimiter = createAuthLimiter(
  'RATE_LIMITED_IP',
  'Too many demo sign-ins from this network. Try again in 15 minutes.',
);

/**
 * SPEC section 5: 3 per hour, per account rather than per IP, so a shared
 * network cannot exhaust one user's budget. Keyed on the authenticated id
 * because the route carries no email in its body.
 */
export const resendVerificationLimiter = (() => {
  const store = new MemoryStore();
  authStores.push(store);

  return rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 3,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    store,
    keyGenerator: (req) => (req as { user?: { id?: string } }).user?.id ?? req.ip ?? '',
    handler: (_req, _res, next) => {
      next(
        ApiError.tooManyRequests(
          'You have asked for a confirmation link three times in the last hour. Try again later.',
          'RATE_LIMITED_ACCOUNT',
        ),
      );
    },
  });
})();

/**
 * SPEC section 12 asks for a stricter limit on the upload and export endpoints
 * than the blanket one, because both are far more expensive per request than a
 * read: an upload writes to object storage, and an export reads every document
 * the account owns and serialises the lot.
 *
 * Keyed by account rather than by IP, so one user on a university network cannot
 * spend everybody else's budget. They fall back to the IP only if they somehow
 * run unauthenticated, which no route mounts them to do.
 */
const accountStores: MemoryStore[] = [];

function createAccountLimiter(limit: number, windowMs: number, message: string, code: string) {
  const store = new MemoryStore();
  accountStores.push(store);

  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    store,
    skip: () => isTest,
    keyGenerator: (req) => (req as { user?: { id?: string } }).user?.id ?? req.ip ?? '',
    handler: (_req, _res, next) => {
      next(ApiError.tooManyRequests(message, code));
    },
  });
}

/** Uploads: 30 files in 15 minutes is far more than any real session needs. */
export const uploadLimiter = createAccountLimiter(
  30,
  FIFTEEN_MINUTES_MS,
  'Too many uploads in a short time. Try again in a few minutes.',
  'RATE_LIMITED_UPLOAD',
);

/**
 * Exports: 5 an hour. A full account export reads every document the user owns,
 * and nobody legitimately needs a sixth copy of it within the hour.
 */
export const exportLimiter = createAccountLimiter(
  5,
  60 * 60 * 1000,
  'You have requested several exports recently. Try again in an hour.',
  'RATE_LIMITED_EXPORT',
);

/** Clears every auth counter. Used by tests so one case cannot throttle the next. */
export function resetAuthRateLimiters(): void {
  for (const store of authStores) store.resetAll();
  for (const store of accountStores) store.resetAll();
}
