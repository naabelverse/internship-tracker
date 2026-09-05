import * as Sentry from '@sentry/node';
import type { Express } from 'express';
import { APP_VERSION } from '@/config/app-info';
import { env } from '@/config/env';
import { logger, redactSecrets } from '@/config/logger';

/**
 * Error reporting, and only when it is asked for.
 *
 * Everything here is gated on `SENTRY_DSN`. With the variable unset - which is
 * the default, and what CI and every local checkout run with - nothing is
 * initialised, no network call is made and `isSentryEnabled()` is false, so the
 * app behaves exactly as it did before this file existed.
 */
export function isSentryEnabled(): boolean {
  return typeof env.SENTRY_DSN === 'string' && env.SENTRY_DSN.length > 0;
}

/**
 * Scrubs a payload on its way out.
 *
 * `sendDefaultPii: false` already stops the SDK attaching headers, cookies and
 * bodies on its own, but an event we captured ourselves can still carry whatever
 * context the call site passed. Running it through the same `redactSecrets` the
 * logger uses means there is one list of forbidden keys in this codebase, not
 * two that drift.
 */
function scrub(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  if (event.request) {
    delete event.request.cookies;
    delete event.request.data;
    delete event.request.headers;
  }

  if (event.extra) event.extra = redactSecrets(event.extra) as typeof event.extra;
  if (event.contexts) event.contexts = redactSecrets(event.contexts) as typeof event.contexts;

  // The user id is useful for "how many people hit this"; the address is not
  // worth shipping to a third party to answer it.
  if (event.user) event.user = { id: event.user.id };

  return event;
}

/**
 * Initialises Sentry when a DSN is configured. Called from `index.ts` before the
 * app is built, because the SDK instruments modules as they load.
 */
export function initSentry(): void {
  if (!isSentryEnabled()) return;

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    release: APP_VERSION,
    // Off unless asked for: traces are billed per event and this is a free-tier
    // deployment. Errors are the point.
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
    sendDefaultPii: false,
    beforeSend: scrub,
  });

  logger.info('Sentry error reporting enabled', {
    environment: env.NODE_ENV,
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
  });
}

/**
 * Attaches Sentry's Express error handler.
 *
 * Mounted before this application's own `errorHandler` so the report is captured
 * with the request still in scope, and so the response the client sees is still
 * this API's envelope rather than anything Sentry writes. A no-op when no DSN is
 * set, which keeps `app.ts` free of a conditional.
 */
export function attachSentryErrorHandler(app: Express): void {
  if (!isSentryEnabled()) return;

  Sentry.setupExpressErrorHandler(app, {
    // 4xx are answers, not faults. Reporting them would bury the real failures
    // under every mistyped password and every 404.
    shouldHandleError: (error) => {
      const status = (error as { statusCode?: number }).statusCode ?? 500;
      return status >= 500;
    },
  });
}

/** Flushes buffered events during shutdown, so the last crash is not lost. */
export async function flushSentry(timeoutMs = 2_000): Promise<void> {
  if (!isSentryEnabled()) return;

  try {
    await Sentry.close(timeoutMs);
  } catch {
    // A failed flush must never turn a clean shutdown into a hung one.
  }
}
