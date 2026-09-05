import { clientEnv } from '@/lib/env';
import { logger } from '@/lib/logger';

/**
 * Optional browser error reporting.
 *
 * The SDK is behind a dynamic import, not a static one, and that is the whole
 * design. `scripts/checkBundle.mjs` enforces SPEC section 12's landing budget by
 * walking the *static* import closure, so a statically imported Sentry would be
 * roughly 30 KB gzipped on the critical path of a page most visitors bounce off.
 * Behind a dynamic import it is its own chunk, and with no DSN configured that
 * chunk is never requested at all.
 *
 * Failure here is swallowed on purpose. A blocked CDN, an ad blocker eating the
 * request or a malformed DSN must not stop the application rendering: error
 * reporting going missing is a monitoring gap, not an outage.
 */
export async function initSentry(): Promise<void> {
  const dsn = clientEnv.sentryDsn;

  if (!dsn) return;

  try {
    const Sentry = await import('@sentry/react');

    Sentry.init({
      dsn,
      environment: import.meta.env.MODE,
      // Errors only. Traces are billed per event and this is a free-tier
      // deployment; the server side makes the same choice for the same reason.
      tracesSampleRate: 0,
      sendDefaultPii: false,
      beforeSend: (event) => {
        // The address is the one piece of PII this app reliably holds, and a
        // user id answers "how many people hit this" just as well.
        if (event.user) event.user = { id: event.user.id };
        delete event.request?.cookies;
        return event;
      },
    });
  } catch (error) {
    logger.warn('Sentry could not be initialised; errors will not be reported', error);
  }
}

/**
 * Reports an error already handled by the UI, so a caught failure that the user
 * saw as a toast or an error panel is still visible in the dashboard. A no-op
 * when Sentry was never initialised.
 */
export async function reportError(
  error: unknown,
  context?: Record<string, unknown>,
): Promise<void> {
  if (!clientEnv.sentryDsn) return;

  try {
    const Sentry = await import('@sentry/react');
    Sentry.captureException(error, context ? { extra: context } : undefined);
  } catch {
    // Reporting an error must never itself throw into the caller.
  }
}
