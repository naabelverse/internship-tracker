import rateLimit, { type Options } from 'express-rate-limit';
import { isTest } from '@/config/env';
import { ApiError } from '@/utils/ApiError';

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

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
